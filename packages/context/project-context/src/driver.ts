/** Same-turn project-document finalization without taking over task continuation. */

import { FiberState, type Context } from '@deepseek-ai/cordis'
import { emitAgentEvent, type Agent } from '@deepseek-ai/dsh-agent'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { delegationDepthOf } from '@deepseek-ai/dsh-subagent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-goal'
import type {} from '@deepseek-ai/dsh-tool-todo'
import type {} from '@deepseek-ai/dsh-plan-mode'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-work-handoff'
import type { ProjectContextService } from './index.ts'
import type { ProjectContextView } from './types.ts'

/** Wait without retaining a stopping turn after cancellation or plugin removal. */
async function waitFor(task: Promise<unknown>, signal: AbortSignal): Promise<void> {
  const aborted = Promise.withResolvers<undefined>()
  const stop = (): void => { aborted.resolve(undefined) }
  if (signal.aborted) stop()
  else signal.addEventListener('abort', stop, { once: true })
  try {
    await Promise.race([task, aborted.promise])
  } finally {
    signal.removeEventListener('abort', stop)
  }
}

/**
 * Install finalization at normal root turn boundaries and preserve interrupted assessments.
 * @param ctx - effect owner with project context, Agent, persistence, and handoff services.
 * @param service - owning maintenance service; passed explicitly without a self-injection dependency.
 */
export function installProjectContextDriver(ctx: Context,
  service: Pick<ProjectContextService, 'prepare' | 'viewOf' | 'activeOf'>): void {
  const unloading = new AbortController()
  const pending = new Set<Promise<void>>()
  const finalizing = new Map<Agent, Promise<void>>()
  const conclusions = new WeakMap<Session, number>()

  function owner<K extends string & keyof Context>(agent: Agent, name: K): Context[K] | undefined {
    return agent.ctx.get('agentPresets')?.serviceFor(agent, name) ?? agent.ctx.get(name)
  }

  function live(agent: Agent, signal: AbortSignal): boolean {
    return !signal.aborted && ctx.fiber.state === FiberState.ACTIVE && ctx.agents.get(agent.id) === agent
      && delegationDepthOf(agent) === 0 && agent.session.header.origin !== 'subagent'
  }

  function current(agent: Agent, turn: number): ProjectContextView | undefined {
    const view = service.viewOf(agent.session)
    return view?.sourceTurn === turn && (view.status === 'pending' || view.status === 'updating') ? view : undefined
  }

  function defer(agent: Agent, turn: number, reason: string): void {
    const view = current(agent, turn)
    if (view !== undefined) agent.session.append('project-context/status', { ...view, status: 'deferred', reason })
  }

  function eligible(agent: Agent, turn: number, signal: AbortSignal): boolean {
    if (!live(agent, signal) || current(agent, turn) === undefined) return false
    if (agent.inbox.nextStep.length > 0) return false
    if (agent.inbox.nextTurn.length > 0) {
      defer(agent, turn, 'New input is queued; project documentation will be assessed with the next task turn.')
      return false
    }
    const goal = owner(agent, 'goals')?.get(agent)
    const plan = owner(agent, 'planMode')?.get(agent)
    const todo = owner(agent, 'todoPolicy')
    const policy = todo?.viewOf(agent.session)
    if (plan?.active === true || plan?.pending === true || goal?.phase === 'paused' || goal?.phase === 'blocked'
      || (policy !== undefined && (policy.purpose === 'legacy' || policy.disposition === 'paused'
        || policy.disposition === 'waiting'))) {
      defer(agent, turn, 'Project documentation is deferred while work is paused, waiting, or requires approval.')
      return false
    }
    // An active goal owns its next round; ordinary unfinished execution stays in the Todo driver's same turn.
    if (!service.activeOf(agent) && (goal === undefined || goal.phase === 'complete') && policy?.purpose === 'current-task'
      && todo?.listOf(agent.session).some(item => item.status !== 'completed')) return false
    return true
  }

  async function finalize(agent: Agent, turn: number, turnSignal: AbortSignal): Promise<void> {
    const signal = AbortSignal.any([turnSignal, unloading.signal])
    if (!eligible(agent, turn, signal)) return
    const descendants = owner(agent, 'subagents')
    if (descendants !== undefined) {
      await waitFor(descendants.waitForTreeWork(agent), signal)
      if (!eligible(agent, turn, signal)) return
    }
    await waitFor(ctx.sessions.flush(agent.session).then((saved) => {
      if (!saved && !signal.aborted) throw new HarnessError(
        'Project documentation cannot be finalized before the Session checkpoint is saved. Restore Session storage.',
        'PROJECT_CONTEXT_DURABILITY_REQUIRED')
    }), signal)
    if (!eligible(agent, turn, signal)) return
    await service.prepare(agent, turn, signal)
  }

  function track(task: Promise<void>): Promise<void> {
    pending.add(task)
    return task.finally(() => { pending.delete(task) })
  }

  function interrupted(agent: Agent, event: Extract<SessionEvent, { type: 'turn/end' }>): void {
    const view = service.viewOf(agent.session)
    if (delegationDepthOf(agent) !== 0 || view?.sourceTurn !== event.data.turn
      || (view.status !== 'failed' && view.status !== 'deferred')
      || (event.data.reason.kind === 'completed' && conclusions.get(agent.session) !== event.data.turn)) return
    const cause = event.data.reason.kind === 'error' ? event.data.reason.error.message
      : event.data.reason.kind === 'max-tokens' ? 'The model reached its output-token limit.'
        : event.data.reason.kind === 'completed' ? 'A tool explicitly concluded the turn.' : 'Execution was cancelled.'
    const task = Promise.resolve().then(async () => {
      if (!live(agent, unloading.signal)) return
      const handoffs = owner(agent, 'workHandoffs')
      if (handoffs === undefined) throw new HarnessError(
        'Project documentation is unfinished and no work handoff service is configured. Enable work-handoff before continuing.',
        'PROJECT_CONTEXT_HANDOFF_UNAVAILABLE')
      await handoffs.capture(agent, { reason: event.data.reason.kind === 'completed' ? 'paused' : 'error', signal: unloading.signal,
        stopDetail: [`Project documentation remains unfinished for turn ${event.data.turn}. ${cause}`,
          view.contextPath === undefined ? undefined : `Context file: ${view.contextPath}.`,
          view.root === undefined ? undefined : `Project root: ${view.root}.`, view.reason, view.summary]
          .filter(value => value !== undefined).join('\n') })
    }).catch((error: unknown) => {
      if (!live(agent, unloading.signal)) return
      emitAgentEvent(ctx, agent, 'agent/error', { turn: event.data.turn, step: 0, error })
    })
    void track(task)
  }

  ctx.effect(function* () {
    ctx.on('agent/turn-stopping', ({ agent, turn, cause, signal }) => {
      if (cause === 'model-finished') {
        const existing = finalizing.get(agent)
        if (existing !== undefined) return existing
        const task = Promise.resolve().then(() => finalize(agent, turn, signal)).finally(() => { finalizing.delete(agent) })
        finalizing.set(agent, task)
        return track(task)
      }
      if (cause === 'tool-concluded' && live(agent, signal)) {
        defer(agent, turn, 'A tool explicitly concluded the turn; project documentation has not been finalized.')
        const view = service.viewOf(agent.session)
        if (view?.sourceTurn === turn && (view.status === 'deferred' || view.status === 'failed')) {
          conclusions.set(agent.session, turn)
        }
      }
    })
    ctx.on('session/event', (session, event) => {
      if (event.type !== 'turn/end') return
      const agent = ctx.agents.get(session.id)
      if (agent !== undefined && agent.session === session) interrupted(agent, event)
    })
    yield async () => {
      unloading.abort()
      await Promise.allSettled(pending)
    }
  }, 'project context turn finalization')
}
