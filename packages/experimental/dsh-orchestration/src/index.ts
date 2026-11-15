/**
 * Orchestration service and plugin entry: capability-aware task splitting into
 * parallel spawn subagents with bounded, settled-task route failover. The
 * policy and scheduling live here, outside the agent-loop, composing the
 * stable `ctx.subagents` and `ctx.llm` seams.
 *
 * @module @deepseek-ai/dsh-orchestration
 */

import { Context, Service, type Volatile } from '@deepseek-ai/cordis'
import { isVolatile } from '@deepseek-ai/cosmokit'
// Type-only: pulls the Loader's Events augmentation (`loader/volatile-update`)
// and Fiber.entry, used for pool refresh and self-namespace resolution.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { brandString } from '@deepseek-ai/dsh-brand'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SettingsForms } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type { CommandDefinitionId } from '@deepseek-ai/dsh-commands'
import type { CommandId } from '@deepseek-ai/dsh-commands/brand'
import type { ProjectionDefinition, ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import type { SubagentActivation, SubagentResult } from '@deepseek-ai/dsh-subagent'
import { coordinate, CoordinatorError, TASK_DOMAINS } from './coordinator.ts'
import { capabilityRoutes, selectFailover, selectRoute } from './plan.ts'
import type { CapabilityRoute, RouteBudget } from './plan.ts'
import type {
  OrchestrationConfig,
  OrchestrationProjection,
  OrchestrationResult,
  OrchestrationUnitState,
  PlannedStep,
  PoolRoute,
  StepOutcome,
  WorkerAttempt,
} from './types.ts'

export type * from './types.ts'
export * from './capabilities.ts'
export { CoordinatorError, createStepId, isModality, isTaskDomain, TASK_DOMAINS, TASK_MODALITIES } from './coordinator.ts'
export { capabilityRoutes, selectFailover, selectRoute, withinBudget } from './plan.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    orchestrations: OrchestrationService
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Whether orchestration mode is selected for this Session from this point
     * on: log-only, non-surface, whole-value replace. The last `orchestration/mode`
     * wins; a log with none means no explicit selection.
     */
    'orchestration/mode': { active: boolean }
  }
}

const DEFAULT_MAX_CONCURRENCY = 3
const DEFAULT_MAX_ATTEMPTS_PER_STEP = 2
const DEFAULT_WORKER_TIMEOUT_MS = 120_000

/** Validate a branded `CommandId` in a projection state schema, cast-free. */
const commandIdSchema: ZodType<CommandId> = zod.string().transform(value => brandString<CommandId>(value))

const orchestrationUnitStateSchema: ZodType<OrchestrationUnitState> = zod.object({
  active: zod.boolean(),
  wanted: zod.boolean().nullable(),
  running: zod.object({
    commandId: commandIdSchema,
    wanted: zod.boolean(),
  }).strict().nullable(),
  entered: zod.boolean(),
}).strict()

/** Wire payload schema of the `orchestration` projection. */
const orchestrationProjectionSchema: ZodType<OrchestrationProjection> = zod.object({
  active: zod.boolean(),
  pending: zod.boolean(),
})

/** Projection of logged orchestration selections and committed mode. */
export const orchestrationProjectionDefinition = {
  key: 'orchestration',
  stateVersion: 1,
  stateSchema: orchestrationUnitStateSchema,
  init: () => ({ active: false, wanted: null, running: null, entered: false }),
  apply: (state: OrchestrationUnitState, event) => {
    if (event.type === 'command/run' && event.data.name === 'orchestration') {
      if (event.data.args === undefined) return state
      const wanted = event.data.args.trim() !== 'off'
      return { ...state, running: { commandId: event.data.commandId, wanted } }
    }
    if (event.type === 'command/done' && event.data.commandId === state.running?.commandId) {
      const wanted = event.data.kind === 'success' && state.running.wanted !== state.active
        ? state.running.wanted
        : null
      return { ...state, wanted, running: null }
    }
    if (event.type === 'orchestration/mode') {
      return { ...state, active: event.data.active, wanted: null, entered: state.entered || true }
    }
    return state
  },
  wire: {
    viewSchema: orchestrationProjectionSchema,
    view: (state) => {
      const wanted = state.running?.wanted ?? state.wanted
      return { active: state.active, pending: wanted !== null && wanted !== state.active }
    },
  },
} satisfies ProjectionDefinition<'orchestration', OrchestrationUnitState>

/** Validate one positive safe-integer deployment value. */
function positiveInt(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive safe integer`)
  }
  return value
}

/** Human-readable message for an arbitrary thrown value. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Is a terminal stop reason eligible for a model-route failover? A completed
 * step succeeded; a refusal or policy-denial is never routed around.
 */
function eligibleForFailover(stopReason: SubagentResult['stopReason']): boolean {
  return stopReason === 'error' || stopReason === 'max-tokens' || stopReason === 'aborted'
}

/** How one worker attempt settled: a timed result, a rejected result, or a timeout. */
type AttemptSettlement =
  | { kind: 'result'; result: SubagentResult }
  | { kind: 'rejected'; error: unknown }
  | { kind: 'timeout' }

/** Orchestration service; injects the seams it composes and exposes the pool over Remote. */
export class OrchestrationService extends TypertRemoteService {
  static inject = ['llm', 'subagents', 'sessionProjections', 'agents']

  static Config = z.object({
    pool: z.array(z.object({ provider: z.string(), model: z.string() })).default([]).volatile(),
    maxConcurrency: z.number().step(1).min(1).default(DEFAULT_MAX_CONCURRENCY),
    maxAttemptsPerStep: z.number().step(1).min(1).default(DEFAULT_MAX_ATTEMPTS_PER_STEP),
    workerTimeoutMs: z.number().step(1).min(1).default(DEFAULT_WORKER_TIMEOUT_MS),
    defaultToOrchestrator: z.boolean().default(false),
  })

  private readonly config: Required<Omit<OrchestrationConfig, 'pool'>>
  /**
   * The configured pool source: a live volatile ref (schema-mounted config,
   * mutated in place on `loader/volatile-update`) or a plain array (direct
   * construction without schema resolution).
   */
  private readonly poolConfig: Volatile<readonly PoolRoute[]> | readonly PoolRoute[] | undefined
  private poolValue: readonly PoolRoute[] = []
  /** `orchestration` projection handle, ready after `[Service.init]`. */
  private orchestrationProjectionHandle: ProjectionHandle<OrchestrationUnitState> | undefined
  /**
   * Selection per session awaiting the next accepted boundary within an open
   * turn. Mid-turn `/orchestration` and `select` calls queue here; the logged
   * `orchestration/mode` event appends when the open turn commits.
   */
  private readonly pendingIntents = new WeakMap<Session, { active: boolean }>()

  constructor(ctx: Context, config: OrchestrationConfig = {}) {
    super(ctx, 'orchestrations', { namespace: 'orchestrations' })
    this.config = {
      maxConcurrency: positiveInt('maxConcurrency', config.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY),
      maxAttemptsPerStep: positiveInt('maxAttemptsPerStep', config.maxAttemptsPerStep ?? DEFAULT_MAX_ATTEMPTS_PER_STEP),
      workerTimeoutMs: positiveInt('workerTimeoutMs', config.workerTimeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS),
      defaultToOrchestrator: config.defaultToOrchestrator ?? false,
    }
    this.poolConfig = config.pool
    // Restore the persisted pool on load so the GUI-selected pool survives a
    // restart and the tool seed only ever runs against an intentionally empty
    // profile.
    this.poolValue = [...this.poolOf()]
  }

  /** Current plain routes of the configured pool, live after a volatile update. */
  private poolOf(): readonly PoolRoute[] {
    const source = this.poolConfig
    return source === undefined ? [] : isVolatile(source) ? source.get() : source
  }

  protected async [Service.init](): Promise<void> {
    this.orchestrationProjectionHandle = await this.ctx.sessionProjections.register(orchestrationProjectionDefinition)
    // Reflect volatile `pool` edits (GUI panel or a direct cordis.yml edit) into
    // the live runtime value without remounting the service.
    this.ctx.on('loader/volatile-update', (paths) => {
      if (paths.some(path => path.length === 1 && path[0] === 'pool')) {
        this.poolValue = [...this.poolOf()]
      }
    })
    // The `/orchestration` command mounts only when a command registry is
    // composed, so the service still boots without one (the boot test path).
    this.ctx.inject(['commands'], (commandCtx) => {
      commandCtx.commands.register({
        definitionId: brandString<CommandDefinitionId>('@deepseek-ai/dsh-orchestration'),
        name: 'orchestration',
        description: 'Turn orchestration mode on or off for this session',
        input: { hint: 'on|off' },
        handler: ({ agent, rawInput }) => {
          const arg = rawInput.trim()
          if (arg === 'on' || arg === '') {
            return { kind: 'success' as const, text: this.commandWording(this.select(agent, true), true) }
          }
          if (arg === 'off') {
            return { kind: 'success' as const, text: this.commandWording(this.select(agent, false), false) }
          }
          return { kind: 'error' as const, text: 'Usage: /orchestration on|off' }
        },
      })
    })
  }

  /**
   * Human-readable wording for one orchestration selection outcome, aware of
   * the selection's target direction.
   * @param outcome - the selection outcome from {@link OrchestrationService.select}.
   * @param active - the target orchestration state (true when enabling).
   * @returns the outcome sentence.
   */
  private commandWording(outcome: 'committed' | 'queued' | 'cancelled' | 'noop', active: boolean): string {
    switch (outcome) {
      case 'committed':
        return active ? 'Orchestration mode on. Use /orchestration off to leave.' : 'Orchestration mode off.'
      case 'queued':
        return active
          ? 'Entering orchestration mode (applies from the next step).'
          : 'Leaving orchestration mode (applies from the next step).'
      case 'cancelled':
        return 'Orchestration mode selection cancelled.'
      case 'noop':
        return active ? 'Orchestration mode is already on.' : 'Orchestration mode is already inactive.'
    }
  }

  /**
   * Whether the orchestration mode is selected for the calling Agent's session.
   * An explicit logged `orchestration/mode` selection wins; a session with no
   * selection falls back to the deployment `defaultToOrchestrator`. The
   * selection is session-scoped (an Agent is 1:1 with its Session) rather than
   * a global flag, and it is folded from the logged `orchestration/mode` event
   * by the `orchestration` projection, so restart recovery restores it.
   * @param agent - the Agent whose session mode is read.
   * @returns true when orchestration should be available to this session.
   */
  modeOf(agent: Agent): boolean {
    const state = this.orchestrationState(agent.session)
    return state.active || (!state.entered && this.config.defaultToOrchestrator)
  }

  /**
   * Select orchestration mode for the calling Agent's session, recording the
   * selection as a durable `orchestration/mode` Session event and updating the
   * live projected value. A failed durable append propagates so a selection is
   * never silently unrecorded; the projection reads the log, so a failed append
   * leaves the mode unchanged. This is the between-turns commit path; use
   * {@link OrchestrationService.select} to queue a mid-turn selection.
   * @param agent - the Agent whose session mode is set.
   * @param active - true to enable orchestration mode for this session.
   */
  setMode(agent: Agent, active: boolean): void {
    if (this.hasOpenTurn(agent.session)) {
      this.pendingIntents.set(agent.session, { active })
      return
    }
    this.commit(agent, active)
  }

  /**
   * Select orchestration mode, distinguishing how the selection lands. Between
   * turns the method appends `orchestration/mode` immediately because no
   * in-turn boundary will run until another prompt starts a turn. The open-turn
   * fold is the idle signal: agent status stays `running` through post-turn
   * checkpointing, when no further in-turn boundary runs. During an open turn
   * the selection remains pending until the next accepted boundary commits it.
   * Repeated selection of the current or already-pending state is a no-op.
   * @param agent - the Agent to switch.
   * @param active - true to enable orchestration mode for this session.
   * @returns what happened: `committed` (logged now), `queued` (awaiting the
   * next boundary), `cancelled` (an opposite pending selection was cleared and
   * the logged state already matches), or `noop` (already in that state).
   */
  select(agent: Agent, active: boolean): 'committed' | 'queued' | 'cancelled' | 'noop' {
    const session = agent.session
    const pending = this.pendingIntents.get(session)
    const target = pending?.active ?? this.loggedActive(session)
    if (active === target) return 'noop'
    if (this.hasOpenTurn(session)) {
      this.pendingIntents.set(session, { active })
      return this.loggedActive(session) === active ? 'cancelled' : 'queued'
    }
    // No open turn: commit now. Delete only after the append succeeds so a
    // failed durable write leaves the selection retryable, not dropped.
    if (active === this.loggedActive(session)) {
      this.pendingIntents.delete(session)
      return 'cancelled'
    }
    this.commit(agent, active)
    return 'committed'
  }

  /** Read the logged orchestration mode from the projection. */
  private loggedActive(session: Session): boolean {
    return this.orchestrationState(session).active
  }

  /** Whether a turn is open for the Session, per the agent turn-boundary projection. */
  private hasOpenTurn(session: Session): boolean {
    return this.ctx.agents.turnBoundaryOf(session).openTurnStartSeq !== null
  }

  /** Read the `orchestration` projection unit state for a Session. */
  private orchestrationState(session: Session): OrchestrationUnitState {
    if (this.orchestrationProjectionHandle === undefined) {
      throw new Error('orchestration mode is not ready; await plugin activation before reading it')
    }
    return this.orchestrationProjectionHandle.stateOf(session)
  }

  /** Append a committed mode selection and clear any pending intent for the Session. */
  private commit(agent: Agent, active: boolean): void {
    agent.session.append('orchestration/mode', { active })
    this.pendingIntents.delete(agent.session)
  }

  /**
   * The currently selected multi-model pool, read live by orchestration runs.
   * @returns the selected provider/model routes; may be empty.
   */
  @Remote('getPool')
  getPool(): readonly PoolRoute[] {
    return this.poolValue
  }

  /**
   * Replace the selected multi-model pool in memory only, without persisting.
   * An empty pool clears the selection; later runs then fail loud rather than
   * silently running nothing. This is the non-persisted setter used by the
   * headless `tool-orchestration` seed; the GUI panel persists a selection
   * through {@link OrchestrationService.persistPool}.
   * @param pool - provider/model routes to select.
   */
  @Remote('setPool')
  setPool(pool: readonly PoolRoute[]): void {
    this.poolValue = [...pool]
  }

  /**
   * Persist a replacement pool to Host settings (`orchestration.pool` in the
   * profile), restoring it after restart. The pool is always applied in memory
   * so the selection takes effect immediately; the profile write is best-effort
   * and a refused write (a settings conflict, a profile override, or a layered
   * entry the config editor cannot rewrite) is logged as a warning and keeps
   * the pool live for the session without blocking the selection. When the
   * settings service is absent (settings-less boots), the pool is applied in
   * memory with a warning so the call still lands.
   * @param pool - provider/model routes to select.
   * @returns true when the pool was applied (always, after an in-memory apply).
   */
  @Remote('persistPool')
  async persistPool(pool: readonly PoolRoute[]): Promise<boolean> {
    this.poolValue = [...pool]
    const settings = this.ctx.get('settings') as SettingsForms | undefined
    if (settings === undefined) {
      this.ctx.logger.warn('orchestration: settings service is absent; the selected pool is applied for this session only')
      return true
    }
    try {
      await settings.update(this.orchestrationNamespace(), { pool: [...pool] })
    } catch (error) {
      this.ctx.logger.warn(
        'orchestration: persisting the model pool to the profile was refused (%s); the pool is applied for this session only',
        messageOf(error),
      )
    }
    return true
  }

  /**
   * The profile entry id this service mounts as, the settings namespace for
   * its own config. Falls back to the shipped profile's `orchestration` entry
   * id when no Loader entry is attached (e.g. a bare-context test boot).
   */
  private orchestrationNamespace(): string {
    const id = this.ctx.fiber.entry?.options.id
    return typeof id === 'string' && id.length > 0 ? id : 'orchestration'
  }

  /**
   * Split a task into a plan with the coordinator and run every step as a
   * parallel spawn worker, failing over each settled failure to the next
   * capability-similar eligible pool route within a bounded attempt budget.
   *
   * Workers do not inherit orchestration mode: the delegation gate reads the
   * calling agent's own session mode only, and spawned workers receive just
   * provider/model options (no orchestration flag), so orchestration never
   * recursively enables itself inside worker chains.
   * @param parent - exact live Agent providing worker lineage for every step.
   * @param task - the raw goal to decompose and execute.
   * @param pool - optional selected model routes; defaults to the value set with
   *   {@link OrchestrationService.setPool}, so the GUI-selected pool drives runs.
   * @param signal - caller cancellation.
   * @returns every step outcome plus run-level counts.
   */
  async run(
    parent: Agent,
    task: string,
    pool: readonly PoolRoute[] | undefined,
    signal: AbortSignal,
  ): Promise<OrchestrationResult> {
    const routes = capabilityRoutes(pool ?? this.poolValue)
    if (routes.length === 0) {
      const source = pool ?? this.poolValue
      if (source.length === 0) throw new CoordinatorError('orchestration pool is empty; select a model pool before running')
      throw new CoordinatorError(
        `orchestration pool resolves to no usable routes: none of ${source.map(r => r.model).join(', ')} is a routeable catalog model`
        + ' (a provider/model that resolves to a catalog capability)',
      )
    }
    const steps = await this.plan(parent, task, routes, signal)
    if (steps.length === 0) throw new CoordinatorError('coordinator returned an empty plan')

    const semaphore = new Semaphore(this.config.maxConcurrency)
    const budget: RouteBudget = {}
    const assigned: Record<string, number> = {}
    const stepResults = await Promise.all(
      steps.map(step => semaphore.run(() => this.executeStep(parent, step, routes, signal, { budget, assigned }))),
    )

    let failovers = 0
    let failedSteps = 0
    for (const outcome of stepResults) {
      failovers += Math.max(0, outcome.attempts.length - 1)
      if (outcome.failed) failedSteps += 1
    }
    return {
      steps: stepResults,
      succeeded: failedSteps === 0,
      failovers,
      failedSteps,
    }
  }

  /**
   * Coordinated plan for one task. The coordinator runs on the parent's
   * currently selected model route, so the orchestrator is the model the user
   * already chose; the distinct worker pool (`routes`) is used only for the
   * spawned steps.
   */
  private async plan(
    parent: Agent,
    task: string,
    routes: readonly CapabilityRoute[],
    signal: AbortSignal,
  ): Promise<PlannedStep[]> {
    if (routes.length === 0) throw new CoordinatorError('orchestration pool is empty')
    const selection = parent.model.current()
    if (selection === undefined || selection.provider === '' || selection.model === '') {
      throw new CoordinatorError(`parent agent "${parent.id}" has no selected provider/model`)
    }
    const route = {
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
    }
    return coordinate(this.ctx, { route, task, signal }, TASK_DOMAINS)
  }

  /** Execute one step with capability-matched failover within the attempt budget. */
  private async executeStep(
    parent: Agent,
    step: PlannedStep,
    routes: readonly CapabilityRoute[],
    signal: AbortSignal,
    runState: { readonly budget: RouteBudget; readonly assigned: Record<string, number> },
  ): Promise<StepOutcome> {

    /** Count one attempt against the per-run budget for a model. */
    const recordAttempt = (model: string): void => {
      runState.budget[model] = { attempts: (runState.budget[model]?.attempts ?? 0) + 1 }
    }

    /** Reserve one first-attempt assignment for a model, for load balancing. */
    const recordAssignment = (model: string): void => {
      runState.assigned[model] = (runState.assigned[model] ?? 0) + 1
    }

    const attempts: WorkerAttempt[] = []
    let failedOver = false

    for (let index = 0; index < this.config.maxAttemptsPerStep; index += 1) {
      // Caller cancellation: never spawn a replacement after the signal aborts.
      if (signal.aborted) break
      const tried = attempts.map(a => ({ model: a.model }))
      // On retries (index > 0) a prior attempt always pushed a defined model, so the
      // fallback is unreachable; noUncheckedIndexedAccess still widens the access.
      /* v8 ignore next -- a retry already wrote a defined model (index > 0); noUncheckedIndexedAccess
         still widens the access, making this path only reachable through that widening. */
      const failedModel = attempts.at(-1)?.model ?? ''
      const route = index === 0
        ? selectRoute(routes, step, tried, { budget: runState.budget, assigned: runState.assigned })
        : selectFailover(routes, failedModel, step, tried, { budget: runState.budget })
      if (route === undefined) return { step, attempts, output: [], failed: true, failedOver }
      // Reserve the first-attempt route before any await so concurrently selected
      // steps see each other's assignments and spread across the pool.
      if (index === 0) recordAssignment(route.model)

      failedOver = attempts.length > 0
      let activation: SubagentActivation
      try {
        activation = await this.ctx.subagents.startActivation({
          provider: 'spawn',
          label: step.id,
          delivery: 'caller',
          prompt: [{ type: 'text', text: step.description }],
          parent,
          agentOptions: { provider: route.provider, model: route.model },
          signal,
        })
      } catch (error: unknown) {
        // Creation rejection can be a policy denial or an unknown partial start.
        // Without a typed safe-retry guarantee, changing routes is not permitted.
        const message = error instanceof Error ? error.message : String(error)
        attempts.push({
          stepId: step.id,
          provider: route.provider,
          model: route.model,
          stopReason: 'error',
          diagnostic: message,
        })
        recordAttempt(route.model)
        return { step, attempts, output: [], failed: true, failedOver }
      }

      const settlement = await this.settleAttempt(activation, this.config.workerTimeoutMs)
      const record = (stopReason: SubagentResult['stopReason'], diagnostic?: string): void => {
        attempts.push({
          stepId: step.id,
          provider: route.provider,
          model: route.model,
          childId: activation.childId,
          stopReason,
          ...(diagnostic === undefined ? {} : { diagnostic }),
        })
        recordAttempt(route.model)
      }
      if (settlement.kind === 'timeout') {
        // A worker that never settles within the budget is a non-response: record
        // it and fail over to the next eligible route, bounded by the attempt budget.
        record('aborted', `worker did not settle within ${this.config.workerTimeoutMs}ms`)
        if (signal.aborted || index === this.config.maxAttemptsPerStep - 1) {
          return { step, attempts, output: [], failed: true, failedOver }
        }
        continue
      }
      if (settlement.kind === 'rejected') {
        const message = settlement.error instanceof Error ? settlement.error.message : String(settlement.error)
        record('aborted', message)
        // A rejection after caller cancellation is a teardown, not a failover prompt.
        if (signal.aborted) return { step, attempts, output: [], failed: true, failedOver }
        continue
      }
      const result = settlement.result
      const diagnostic = result.diagnostic
      record(result.stopReason, diagnostic)
      if (result.stopReason === 'completed') {
        return { step, attempts, output: result.output, failed: false, failedOver }
      }
      if (!eligibleForFailover(result.stopReason) || signal.aborted) {
        return { step, attempts, output: [], failed: true, failedOver }
      }
    }
    return { step, attempts, output: [], failed: true, failedOver }
  }

  /**
   * Wait for one worker to settle within its timeout. The own timer is cleared
   * once the result settles; a timeout disposes the worker (safely swallowing a
   * dispose rejection) and reports a timeout so the caller never waits on a
   * promise that may never settle. A later result resolution after a timeout is
   * ignored because the settlement promise is already settled.
   * @param activation - the spawned worker activation.
   * @param timeoutMs - the per-attempt timeout budget in milliseconds.
   * @returns how the attempt settled.
   */
  private async settleAttempt(
    activation: SubagentActivation,
    timeoutMs: number,
  ): Promise<AttemptSettlement> {
    return new Promise<AttemptSettlement>((resolve) => {
      const timer = setTimeout(() => {
        Promise.resolve(activation.dispose()).catch((error) => {
          this.ctx.logger.warn('dsh-orchestration: worker dispose after timeout rejected: %o', error)
        })
        resolve({ kind: 'timeout' })
      }, timeoutMs)
      void activation.result.then(
        (result) => {
          clearTimeout(timer)
          resolve({ kind: 'result', result })
        },
        (error) => {
          clearTimeout(timer)
          resolve({ kind: 'rejected', error })
        },
      )
    })
  }
}

/** Minimal async semaphore bounding concurrent worker executions. */
class Semaphore {
  private readonly max: number
  private active = 0
  private readonly waiters: Array<() => void> = []

  constructor(max: number) {
    this.max = max
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>(resolve => this.waiters.push(resolve))
    }
    this.active += 1
    try {
      return await task()
    } finally {
      this.active -= 1
      const next = this.waiters.shift()
      next?.()
    }
  }
}

export default OrchestrationService
