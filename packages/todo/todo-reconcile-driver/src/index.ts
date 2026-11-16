/** Same-turn repair of prematurely finished current tasks, with durable recovery handoffs. */

import { setImmediate as nextImmediate } from 'node:timers/promises'
import { FiberState, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { emitAgentEvent, type Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, HarnessError } from '@deepseek-ai/dsh-llm'
import type { TodoItem, TodoPolicyView, TodoPolicyService } from '@deepseek-ai/dsh-tool-todo'
import type {} from '@deepseek-ai/dsh-goal'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-work-handoff'
import type {} from '@deepseek-ai/dsh-plan-mode'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-project-context'

export { renderTodoReconcilePrompt } from './prompt.ts'
export type { TodoReconcileMessageSource } from '@deepseek-ai/dsh-tool-todo'
export const name = 'todo-reconcile-driver'
export const inject = ['agents', 'goals', 'sessions', 'workHandoffs']

/** Configurable recovery-reminder threshold without a new completed-item high-water mark. */
export interface Config {
  /** Repairs without net completion before stronger recovery guidance; defaults to three and never stops work. */
  maxNoProgressRepairs?: number
}

/** Deployment validation for the recovery-reminder threshold. */
export const Config: z<Config> = z.object({ maxNoProgressRepairs: z.number().min(1).step(1).default(3) })

/** Wait for a service-owned operation or the owning turn and plugin to stop. */
async function waitFor(task: Promise<unknown>, signal: AbortSignal): Promise<void> {
  let onAbort: () => void = () => {}
  const aborted = new Promise<void>((resolve) => { onAbort = resolve })
  if (signal.aborted) onAbort()
  else signal.addEventListener('abort', onAbort, { once: true })
  try {
    await Promise.race([task, aborted])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/**
 * Install current-task continuation through the stopping extension point.
 * @param ctx - owners of the list, execution, and recovery handoff.
 * @param config - deployment's recovery-reminder threshold.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const maxNoProgressRepairs = config.maxNoProgressRepairs ?? 3
  const unloading = new AbortController()
  const pending = new Set<Promise<void>>()
  const recovering = new Set<Agent>()

  function policyOf(agent: Agent): TodoPolicyService | undefined {
    return agent.ctx.get('agentPresets')?.serviceFor(agent, 'todoPolicy') ?? agent.ctx.get('todoPolicy')
  }

  function todosOf(agent: Agent): TodoItem[] {
    return policyOf(agent)?.listOf(agent.session) ?? []
  }

  function live(agent: Agent, signal: AbortSignal): boolean {
    return !signal.aborted && ctx.fiber.state === FiberState.ACTIVE && ctx.agents.get(agent.id) === agent
  }

  function executionPolicy(agent: Agent): TodoPolicyView | undefined {
    if (ctx.get('projectContext')?.activeOf(agent)) return undefined
    const goal = ctx.goals.get(agent)
    // Goal continuation and explicit suspension remain owned by the goal service and driver.
    if (goal !== undefined && goal.phase !== 'complete') return undefined
    if (!todosOf(agent).some(todo => todo.status !== 'completed')) return undefined
    return policyOf(agent)?.viewOf(agent.session)
  }

  async function checkpoint(agent: Agent, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return
    await waitFor(ctx.sessions.flush(agent.session).then((saved) => {
      if (!saved && !signal.aborted) {
        throw new HarnessError('Cannot continue unfinished work because its Session checkpoint was not saved. '
          + 'Configure durable Session storage, then choose Continue.', 'TODO_DURABILITY_REQUIRED')
      }
    }), signal)
  }

  async function capture(agent: Agent,
    reason: 'todo-limit' | 'paused' | 'waiting' | 'legacy-confirmation', signal: AbortSignal): Promise<void> {
    if (!live(agent, signal)) return
    await ctx.workHandoffs.capture(agent, { reason, todos: todosOf(agent), signal,
      todoRepairs: { attempts: policyOf(agent)?.viewOf(agent.session)?.repairAttempts ?? 0, limit: maxNoProgressRepairs } })
  }

  async function suspendAndCapture(agent: Agent, signal: AbortSignal): Promise<void> {
    let policy = executionPolicy(agent)
    if (!live(agent, signal) || policy === undefined || policy.purpose === 'proposal') return
    if (policy.purpose === 'legacy') return capture(agent, 'legacy-confirmation', signal)
    if (policy.disposition === 'active') {
      await policyOf(agent)?.suspend(agent, 'paused', 'Execution stopped before the current task finished')
    }
    if (!live(agent, signal)) return
    policy = executionPolicy(agent)
    if (policy === undefined || policy.purpose === 'proposal') return
    return capture(agent, policy.disposition === 'limit' ? 'todo-limit'
      : policy.disposition === 'waiting' ? 'waiting' : 'paused', signal)
  }

  async function repair(agent: Agent, turnSignal: AbortSignal): Promise<void> {
    const signal = AbortSignal.any([turnSignal, unloading.signal])
    if (!live(agent, signal)) return
    let policy = executionPolicy(agent)
    if (policy === undefined || policy.purpose === 'proposal') return
    await checkpoint(agent, signal)
    if (!live(agent, signal)) return
    const subagents = ctx.get('subagents')
    if (subagents !== undefined) {
      await waitFor(subagents.waitForTreeWork(agent), signal)
      if (!live(agent, signal)) return
    }
    await checkpoint(agent, signal)
    if (!live(agent, signal)) return
    policy = executionPolicy(agent)
    if (policy === undefined || policy.purpose === 'proposal') return
    const planMode = agent.ctx.get('agentPresets')?.serviceFor(agent, 'planMode') ?? agent.ctx.get('planMode')
    const plan = planMode?.get(agent)
    if (plan?.active === true || plan?.pending === true) return suspendAndCapture(agent, signal)
    if (policy.purpose === 'legacy') return capture(agent, 'legacy-confirmation', signal)
    if (policy.disposition === 'paused' || policy.disposition === 'waiting') {
      return capture(agent, policy.disposition, signal)
    }
    if (policy.disposition === 'limit' && !policyOf(agent)?.recoverAuthorizedTask(agent)) return
    const reserved = policyOf(agent)?.recordRepair(agent)
    await checkpoint(agent, signal)
    if (!live(agent, signal) || reserved === undefined) return
    policy = executionPolicy(agent)
    if (policy === undefined || policy.purpose !== 'current-task' || policy.disposition !== 'active'
      || policy.repairAttempts !== reserved.repairAttempts || policy.completedHighWater !== reserved.completedHighWater) return
    const remaining = todosOf(agent).filter(todo => todo.status !== 'completed')
    agent.steer(createUserMessage({
      source: { kind: 'todo-reconcile' },
      content: [{ type: 'text', text: '<todo_continue>\n'
        + 'The authorized current task still has unfinished work. Continue executing the next item now; '
        + 'a statement of intent does not complete it. Verify completed work and update the whole list with todo_write. '
        + 'If the user requested a pause or required input is missing, record paused or waiting with a concrete reason.\n'
        + (reserved.repairAttempts >= maxNoProgressRepairs
          ? 'Repeated responses have not increased verified completion. Re-read the latest failure and tool results, '
            + 'change the approach, and execute a concrete diagnostic or implementation action before responding.\n' : '')
        + remaining.map(todo => `- ${JSON.stringify(todo.content)} [${todo.status}]`).join('\n')
        + '\n</todo_continue>' }],
    }))
  }

  function track(task: Promise<void>): Promise<void> {
    pending.add(task)
    return task.finally(() => { pending.delete(task) })
  }

  function recover(agent: Agent, creationSignal?: AbortSignal): void {
    if (recovering.has(agent)) return
    const initial = executionPolicy(agent)
    if (initial === undefined || initial.purpose === 'proposal') return
    const signal = creationSignal === undefined ? unloading.signal : AbortSignal.any([creationSignal, unloading.signal])
    recovering.add(agent)
    const task = ctx.agents.withoutInitiator(async () => {
      await nextImmediate()
      // Factory announcement runs inside maintenance; never hold its serial listener while waiting for admission.
      await waitFor(agent.whenIdle(), signal)
      if (!live(agent, signal)) return
      const policy = executionPolicy(agent)
      if (policy === undefined || policy.purpose === 'proposal') return
      if (policy.purpose === 'current-task' && (policy.disposition === 'active' || policy.disposition === 'limit')) {
        await ctx.workHandoffs.recoverTodos(agent, signal)
        return
      }
      const saved = ctx.workHandoffs.viewOf(agent.session)
      if (saved?.saved === true && saved.turn === ctx.agents.turnBoundaryOf(agent.session).lastTurn) return
      await suspendAndCapture(agent, signal)
    }).catch((error: unknown) => {
      if (!live(agent, signal)) return
      emitAgentEvent(ctx, agent, 'agent/error', {
        turn: ctx.agents.turnBoundaryOf(agent.session).lastTurn, step: 0,
        error: error instanceof HarnessError ? error : new HarnessError(
          'Todo continuation could not prepare its saved work. Check Session storage and retry.',
          'TODO_RECOVERY_FAILED', { cause: error }),
      })
    }).finally(() => { recovering.delete(agent) })
    void track(task)
  }

  ctx.effect(function* () {
    ctx.on('agent/turn-stopping', ({ agent, signal, cause }) => {
      if (cause === 'tool-concluded') return track(suspendAndCapture(agent, AbortSignal.any([signal, unloading.signal])))
      if (cause !== 'model-finished') return
      return track(repair(agent, signal))
    })
    ctx.on('agent/created', ({ agent, source, signal }): undefined => {
      if (source !== 'resume' && source !== 'startup') return undefined
      recover(agent, signal)
      return undefined
    })
    for (const agent of ctx.agents.list()) recover(agent)
    yield async () => {
      unloading.abort()
      await Promise.allSettled(pending)
    }
  }, 'todo continuation policy')
}
