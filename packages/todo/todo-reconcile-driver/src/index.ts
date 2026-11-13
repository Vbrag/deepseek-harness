/**
 * Same-session resume to-do reconciliation over public agent, session, goal,
 * and session-projection services. On a resumed or freshly started session
 * that carries a persisted non-empty to-do list and a current goal, it issues
 * one model prompt asking the model to reconcile the list statuses via
 * `todo_write` — instead of asking the human to re-derive the plan.
 * @module @deepseek-ai/dsh-todo-reconcile-driver
 */

import { isDeepStrictEqual } from 'node:util'
import { FiberState } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { GoalView } from '@deepseek-ai/dsh-goal'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, MessageId, MessageSource, UserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo'
import type {} from '@deepseek-ai/dsh-subagent'
import { renderTodoReconcilePrompt } from './prompt.ts'

export { renderTodoReconcilePrompt } from './prompt.ts'

export const name = 'todo-reconcile-driver'
export const inject = ['agents', 'goals', 'sessions', 'sessionProjections']

/** Message attribution for one admitted resume-reconcile prompt. */
export interface TodoReconcileMessageSource {
  readonly kind: 'todo-reconcile'
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'todo-reconcile': TodoReconcileMessageSource
  }
}

/** The single admitted resume-reconcile prompt for one agent lifecycle. */
interface ReconcileAttempt {
  readonly messageId: MessageId
  readonly content: ContentBlock[]
  phase: 'queued' | 'claimed' | 'admitted'
  cancelled: boolean
  stale: boolean
}

/** Serialized process-local scheduling state for one exact Agent lifecycle. */
interface DriverState {
  readonly agent: Agent
  attempt: ReconcileAttempt | undefined
  pending: boolean
  competingQueued: boolean
  needsCheckpoint: boolean
  requested: boolean
  run: Promise<void> | undefined
  stopping: boolean
}

/** Whether a source identifies the driver's own reserved reconcile prompt. */
function isReconcileSource(source: MessageSource): source is TodoReconcileMessageSource {
  return source.kind === 'todo-reconcile'
}

/** Whether the queued message matches the driver's own reservation. */
function isOwnAttempt(content: readonly ContentBlock[], source: MessageSource, attempt: ReconcileAttempt): boolean {
  return isReconcileSource(source) && isDeepStrictEqual(content, attempt.content)
}

/** Human-readable unexpected values for logs. */
function renderThrown(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

/** Install one-shot resume reconciliation and its race fences. */
export function apply(ctx: Context): void {
  const states = new Map<Agent, DriverState>()
  // Releases drivers still joining subagents when the plugin unloads.
  const unloading = Promise.withResolvers<void>()

  /** Create state for an exact currently live agent. */
  function stateFor(agent: Agent): DriverState {
    const existing = states.get(agent)
    if (existing !== undefined) return existing
    const state: DriverState = {
      agent,
      attempt: undefined,
      pending: false,
      competingQueued: false,
      needsCheckpoint: false,
      requested: false,
      run: undefined,
      stopping: false,
    }
    states.set(agent, state)
    return state
  }

  /** The persisted whole to-do list for one session, or undefined when absent. */
  function currentTodos(session: Session): TodoItem[] | undefined {
    try {
      const snapshot = ctx.sessionProjections.snapshot(session)
      const value: unknown = snapshot.values['todos']
      return Array.isArray(value) ? (value as TodoItem[]) : undefined
    } catch (error: unknown) {
      ctx.logger.warn(`todo-reconcile-driver: could not read todos for "${session.id}": ${renderThrown(error)}`)
      return undefined
    }
  }

  /** Read only when the exact Agent remains live. */
  function currentGoal(state: DriverState): GoalView | undefined {
    if (ctx.agents.get(state.agent.id) !== state.agent) return undefined
    return ctx.goals.get(state.agent)
  }

  /** Whether a session resume may issue one reconcile prompt. */
  function reconciliationDue(todos: TodoItem[] | undefined, goal: GoalView | undefined): boolean {
    return (todos !== undefined && todos.length > 0) && goal !== undefined
  }

  /** Whether this exact lifecycle is quiescent with no competing prompt. */
  function readyToDrive(state: DriverState): boolean {
    return ctx.fiber.state === FiberState.ACTIVE
      && !state.stopping
      && ctx.agents.get(state.agent.id) === state.agent
      && state.agent.status === 'idle'
      && !state.competingQueued
  }

  /** Recheck every condition that an awaited checkpoint may have changed. */
  function readyAfterCheckpoint(state: DriverState): boolean {
    return readyToDrive(state) && !state.needsCheckpoint
  }

  /** Process admitted reconciliation at quiescence. */
  async function drive(state: DriverState): Promise<void> {
    const { agent } = state
    if (!readyToDrive(state)) return

    if (state.needsCheckpoint) {
      state.needsCheckpoint = false
      try {
        await ctx.sessions.flush(agent.session)
      } catch (error: unknown) {
        ctx.logger.warn(`todo-reconcile-driver: durability checkpoint failed for agent "${agent.id}": ${renderThrown(error)}`)
        disarm(state)
        return
      }
      if (!readyAfterCheckpoint(state)) return
    }

    const attempt = state.attempt
    if (attempt !== undefined) {
      // A reservation already queued is the only admission we make; never
      // enqueue a second reconcile in this lifecycle.
      state.attempt = undefined
      state.pending = false
      return
    }

    if (!state.pending) return
    // Prefer the latest durable goal and the currently projected list.
    const goal = currentGoal(state)
    const todos = currentTodos(agent.session)
    if (todos === undefined || todos.length === 0 || goal === undefined) {
      state.pending = false
      return
    }
    // A reconcile started while descendants progress would only wait for them.
    const subagents = ctx.get('subagents')
    if (subagents !== undefined) {
      await Promise.race([subagents.waitForTreeWork(agent), unloading.promise])
      if (!readyAfterCheckpoint(state)) return
    }

    state.pending = false
    const content = renderTodoReconcilePrompt(todos, goal)
    const message = createUserMessage({ content, source: { kind: 'todo-reconcile' } })
    const reservation: ReconcileAttempt = {
      messageId: message.id,
      content,
      phase: 'queued',
      cancelled: false,
      stale: false,
    }
    state.attempt = reservation
    try {
      agent.followup(message)
    } catch (error: unknown) {
      state.attempt = undefined
      ctx.logger.warn(`todo-reconcile-driver: could not queue reconcile prompt for agent "${agent.id}": ${renderThrown(error)}`)
    }
  }

  /** Remove the driver's automatic authority for this lifecycle. */
  function disarm(state: DriverState): void {
    state.pending = false
  }

  /** Coalesce triggers onto one agent-local serialized driver. */
  function requestDrive(state: DriverState): void {
    /* v8 ignore next -- teardown may race a final trigger after synchronously closing the step fence */
    if (state.stopping) return
    state.requested = true
    if (state.run !== undefined) return
    let run: Promise<void>
    try {
      run = ctx.agents.withoutInitiator(async () => {
        while (state.requested && !state.stopping) {
          state.requested = false
          try {
            await drive(state)
          } catch (error: unknown) {
            ctx.logger.warn(`todo-reconcile-driver: driver failed for agent "${state.agent.id}": ${renderThrown(error)}`)
            disarm(state)
          }
        }
      })
    } catch (error: unknown) {
      ctx.logger.warn(`todo-reconcile-driver: could not start driver for agent "${state.agent.id}": ${renderThrown(error)}`)
      disarm(state)
      return
    }
    state.run = run
    const retire = (): void => {
      state.run = undefined
      if (state.requested && !state.stopping) requestDrive(state)
    }
    void run.then(retire, (error: unknown) => {
      ctx.logger.warn(`todo-reconcile-driver: driver task rejected for agent "${state.agent.id}": ${renderThrown(error)}`)
      disarm(state)
      retire()
    })
  }

  // One composite effect keeps the step fence installed until this
  // plugin's own scheduling tasks settle.
  ctx.effect(function* () {
    ctx.on('agent/error', ({ agent }) => {
      disarm(stateFor(agent))
    })

    ctx.on('agent/disposed', ({ agent }) => { states.delete(agent) })
    ctx.on('agent/created', ({ agent, source }) => {
      const state = stateFor(agent)
      state.attempt = undefined
      state.competingQueued = false
      state.needsCheckpoint = false
      // A fresh resume/startup may reconcile a persisted list; `clear` and
      // `compact` must not re-trigger.
      if (source === 'resume' || source === 'startup') {
        const goal = currentGoal(state)
        const todos = currentTodos(agent.session)
        if (reconciliationDue(todos, goal)) {
          state.pending = true
          requestDrive(state)
        }
      }
    })
    ctx.on('agent/status', ({ agent, status }) => {
      const state = stateFor(agent)
      if (status === 'idle') {
        state.competingQueued = false
        const attempt = state.attempt
        // A reservation still queued when the agent reaches idle cannot run:
        // withdraw it so human input queued behind it is not stranded.
        if (attempt !== undefined && (attempt.phase === 'queued' || attempt.cancelled)) {
          state.attempt = undefined
          try {
            if (attempt.phase === 'queued') agent.inbox.remove(attempt.messageId)
          } catch (error: unknown) {
            ctx.logger.warn(`todo-reconcile-driver: could not settle reconcile prompt for agent "${agent.id}": ${renderThrown(error)}`)
          }
        }
        requestDrive(state)
      }
    })

    ctx.on('agent/inbox/inserted', ({ agent, message }) => {
      if (!agent.inbox.nextTurn.some(candidate => candidate.id === message.id)) return
      const state = stateFor(agent)
      const attempt = state.attempt
      if (attempt !== undefined && isOwnAttempt(message.content, message.source, attempt)) return
      state.competingQueued = true
      if (attempt?.phase === 'queued') attempt.stale = true
    })
    ctx.on('agent/inbox/claimed', ({ agent, message }) => {
      const state = stateFor(agent)
      const attempt = state.attempt
      if (attempt !== undefined && isOwnAttempt(message.content, message.source, attempt)) {
        attempt.phase = 'claimed'
      }
    })
    ctx.on('agent/inbox/discarded', ({ agent, message }) => {
      const state = stateFor(agent)
      const attempt = state.attempt
      if (attempt !== undefined && isOwnAttempt(message.content, message.source, attempt)) {
        attempt.cancelled = true
      }
    })

    ctx.on('session/event', (session: Session, event: SessionEvent) => {
      const agent = ctx.agents.get(session.id)
      if (agent === undefined || agent.session !== session) return
      const state = stateFor(agent)
      if (event.type === 'user/message') {
        const source = event.data.source
        if (isReconcileSource(source) && state.attempt !== undefined
          && event.data.id === state.attempt.messageId) {
          state.attempt.phase = 'admitted'
        }
      }
    })

    /** Fail closed unless the queued prompt is still the driver's own. */
    function validReservation(state: DriverState, content: readonly ContentBlock[], source: MessageSource): boolean {
      const attempt = state.attempt
      return ctx.fiber.state === FiberState.ACTIVE
        && !state.stopping && attempt !== undefined && attempt.phase === 'claimed'
        && !attempt.stale && isOwnAttempt(content, source, attempt)
    }

    ctx.on('agent/pre-step', async ({ agent, messages, signal }, next): Promise<PreStepDecision> => {
      const submitted = messages.find((message): message is UserMessage & { source: TodoReconcileMessageSource } =>
        isReconcileSource(message.source))
      if (submitted === undefined) return next()
      const { content, source } = submitted
      const state = stateFor(agent)
      let valid = false
      try {
        valid = validReservation(state, content, source)
      } catch (error: unknown) {
        ctx.logger.warn(`todo-reconcile-driver: pre-step check failed for agent "${agent.id}": ${renderThrown(error)}`)
        disarm(state)
      }
      if (!valid) {
        state.attempt = undefined
        return { kind: 'reject' }
      }
      let decision: PreStepDecision
      try {
        decision = await next()
      } catch (error: unknown) {
        if (signal.aborted) throw error
        // A throwing downstream hook drops the whole step proposal. Clear the
        // reservation before the balanced no-step turn returns to idle.
        state.attempt = undefined
        requestDrive(state)
        throw error
      }
      if (signal.aborted) return decision
      if (decision.kind === 'reject') {
        state.attempt = undefined
        return decision
      }
      try {
        valid = validReservation(state, content, source)
      } catch (error: unknown) {
        ctx.logger.warn(`todo-reconcile-driver: post-decision check failed for agent "${agent.id}": ${renderThrown(error)}`)
        disarm(state)
        valid = false
      }
      if (!valid) {
        state.attempt = undefined
        return { kind: 'reject' }
      }
      return { ...decision, startsRequestSeries: true }
    })

    // Loading a lifecycle driver over existing agents never inherits hidden
    // automatic authority from an earlier producer instance.
    for (const agent of ctx.agents.list()) {
      disarm(stateFor(agent))
    }

    // Yielded after listener registration, so this close runs first and the
    // composite effect removes listeners only after its promise settles.
    yield async () => {
      unloading.resolve()
      const waits: Promise<void>[] = []
      for (const state of states.values()) {
        state.stopping = true
        disarm(state)
        const attempt = state.attempt
        if (attempt !== undefined) {
          attempt.stale = true
          /* v8 ignore next -- followup reserves the live agent before publishing a queued attempt */
          if (state.agent.status === 'running') {
            state.agent.cancel({ kind: 'parent' })
            waits.push(state.agent.whenIdle())
          }
        }
        if (state.run !== undefined) waits.push(state.run)
      }
      await Promise.allSettled(waits)
      states.clear()
    }
  }, 'todo-reconcile-driver lifecycle')
}
