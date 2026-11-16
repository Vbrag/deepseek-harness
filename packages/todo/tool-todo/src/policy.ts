/** Effect-owned continuation policy for portable todo snapshots. */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import { ToolArgsError } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import type { TodoDisposition, TodoItem, TodoListPurpose, TodoPolicyView } from './types.ts'

interface PolicyState {
  readonly current: TodoPolicyView | null
  readonly hasList: boolean
  readonly inheritedEventCount: number
}

const policySchema = z.object({
  purpose: z.enum(['current-task', 'proposal', 'legacy']),
  disposition: z.enum(['active', 'paused', 'waiting', 'limit']),
  completedHighWater: z.number().int().nonnegative(),
  repairAttempts: z.number().int().nonnegative(),
  reason: z.string().optional(),
}).strict().transform(({ reason, ...policy }): TodoPolicyView => reason === undefined ? policy : { ...policy, reason })

const todosSchema = z.array(z.object({
  content: z.string(), status: z.enum(['pending', 'in_progress', 'completed']),
})).nullable()

declare module '@deepseek-ai/cordis' {
  interface Context {
    todoPolicy: TodoPolicyService
  }
}

/** Owns durable list classification, human continuation, and no-progress accounting. */
export class TodoPolicyService extends Service {
  static inject = ['sessionProjections']
  private handle!: ProjectionHandle<PolicyState>
  private todos!: ProjectionHandle<TodoItem[] | null>

  constructor(ctx: Context) {
    super(ctx, 'todoPolicy')
  }

  protected async [Service.init](): Promise<void> {
    this.todos = await this.ctx.sessionProjections.register({
      key: 'todos', stateVersion: 3, stateSchema: todosSchema,
      init: () => null,
      apply: (state, event) => event.type === 'todo/write' ? event.data.todos : state,
      wire: { viewSchema: todosSchema, view: state => state, summary: false },
    })
    this.handle = await this.ctx.sessionProjections.register({
      key: 'todoPolicy', stateVersion: 1,
      stateSchema: z.object({ current: policySchema.nullable(), hasList: z.boolean(),
        inheritedEventCount: z.number().int().nonnegative() }).strict(),
      init: (_header, inheritedEventCount) => ({ current: null, hasList: false, inheritedEventCount }),
      apply: (state: PolicyState, event): PolicyState => {
        if (event.seq < state.inheritedEventCount) return state
        if (event.type === 'todo/policy') return { ...state, current: policySchema.parse(event.data) }
        if (event.type === 'turn/end' && state.current?.purpose === 'current-task'
          && state.current.disposition === 'active'
          && ['aborted', 'error', 'max-tokens'].includes(event.data.reason.kind)) {
          return { ...state, current: { ...state.current, disposition: 'paused',
            reason: event.data.reason.kind === 'aborted' ? 'cancelled' : event.data.reason.kind } }
        }
        if (event.type !== 'todo/write') return state
        if (event.data.todos.length === 0) return { ...state, hasList: false }
        const completed = event.data.todos.filter(todo => todo.status === 'completed').length
        const current: TodoPolicyView = state.current ?? {
          purpose: 'legacy', disposition: 'active', completedHighWater: 0, repairAttempts: 0,
        }
        if (completed > current.completedHighWater) {
          return { ...state, hasList: true, current: { ...current, completedHighWater: completed, repairAttempts: 0 } }
        }
        return state.hasList && state.current !== null ? state : { ...state, hasList: true, current }
      },
      wire: { viewSchema: policySchema.nullable(), view: state => state.hasList ? state.current : null },
    })
  }

  /**
   * Read the current complete list without exposing projection-owned values.
   * @param session - Session owning the list.
   * @returns detached items, or an empty list before creation and after clearing.
   */
  listOf(session: Session): TodoItem[] {
    return this.todos.stateOf(session)?.map(todo => ({ ...todo })) ?? []
  }

  /**
   * Read a detached current list policy.
   * @param session - Session owning the list.
   * @returns its policy, or undefined for an absent or empty list.
   */
  viewOf(session: Session): TodoPolicyView | undefined {
    const state = this.handle.stateOf(session)
    return state.hasList && state.current !== null ? { ...state.current } : undefined
  }

  /**
   * Write a validated whole list and its model-supplied classification.
   * @param agent - owner of the list.
   * @param todos - canonical complete replacement list.
   * @param purpose - classification for a new list; updates retain the recorded purpose.
   * @param disposition - explicit active, paused, or waiting choice.
   * @param reason - explanation required by the tool for a suspended list.
   */
  writeList(agent: Agent, todos: TodoItem[], purpose?: TodoListPurpose,
    disposition?: Exclude<TodoDisposition, 'limit'>, reason?: string): void {
    const previous = this.handle.stateOf(agent.session).current
    if (previous !== null && previous.disposition !== 'active' && disposition === 'active') {
      throw new ToolArgsError(['a suspended list requires the human Continue action before reactivation'])
    }
    if (purpose !== undefined || disposition !== undefined) {
      const policy: TodoPolicyView = {
        purpose: purpose ?? previous?.purpose ?? 'legacy',
        disposition: disposition ?? previous?.disposition ?? 'active',
        completedHighWater: previous?.completedHighWater ?? 0,
        repairAttempts: previous?.repairAttempts ?? 0,
        ...reason === undefined ? {} : { reason },
      }
      agent.session.append([['todo/policy', policy], ['todo/write', { todos }]])
      return
    }
    agent.session.append('todo/write', { todos })
  }

  /**
   * Authorize a list after an explicit human Continue action; this does not queue work.
   * @param agent - exact live owner selected by the human.
   * @returns the reset execution policy.
   */
  continueTask(agent: Agent): Promise<TodoPolicyView> {
    const todos = this.listOf(agent.session)
    const current: TodoPolicyView = {
      purpose: 'current-task', disposition: 'active', repairAttempts: 0,
      completedHighWater: todos.filter(todo => todo.status === 'completed').length,
    }
    this.commit(agent.session, current)
    return Promise.resolve(current)
  }

  /**
   * Recover existing execution authority without granting approval or resetting repair accounting.
   * @param agent - live owner of the authorized unfinished list.
   * @returns whether current-task execution is active after recovery.
   */
  recoverAuthorizedTask(agent: Agent): boolean {
    this.ctx.fiber.assertActive()
    const current = this.viewOf(agent.session)
    if (current?.purpose !== 'current-task' || !['active', 'limit'].includes(current.disposition)
      || !this.listOf(agent.session).some(todo => todo.status !== 'completed')) return false
    if (current.disposition === 'limit') this.commit(agent.session, { ...current, disposition: 'active' })
    return true
  }

  /**
   * Suspend a list without removing its unfinished items.
   * @param agent - owner selected by the caller.
   * @param disposition - explicit pause or wait choice.
   * @param reason - explanation retained with that choice.
   * @returns the updated policy, or undefined when no list exists.
   */
  suspend(agent: Agent, disposition: 'paused' | 'waiting', reason: string): Promise<TodoPolicyView | undefined> {
    const current = this.viewOf(agent.session)
    if (current === undefined) return Promise.resolve(undefined)
    const next = { ...current, disposition, reason }
    this.commit(agent.session, next)
    return Promise.resolve(next)
  }

  /**
   * Record one persisted repair attempt immediately before steering.
   * @param agent - current execution owner.
   * @returns the updated policy, or undefined when the list has disappeared.
   */
  recordRepair(agent: Agent): TodoPolicyView | undefined {
    const current = this.viewOf(agent.session)
    if (current === undefined) return undefined
    const next = { ...current, repairAttempts: current.repairAttempts + 1 }
    this.commit(agent.session, next)
    return next
  }

  /**
   * Record the historical automatic-stop marker without discarding repair accounting.
   * @param agent - current execution owner.
   */
  markLimit(agent: Agent): void {
    const current = this.viewOf(agent.session)
    if (current !== undefined) this.commit(agent.session, { ...current, disposition: 'limit' })
  }

  private commit(session: Session, view: TodoPolicyView): void {
    session.append('todo/policy', view)
  }
}
