# Orchestration

English | [中文](orchestration.zh.md)

The experimental Orchestration Mode splits one task into parallel substeps, assigns each to a capability-matched model from a selected multi-model pool over the Paderborn AI-Gateway, and, on failure or non-response, fails over to another model with similar capabilities instead of failing the task. This page records the durable and model-visible contracts from [`packages/experimental/dsh-orchestration/src/types.ts`](../../packages/experimental/dsh-orchestration/src/types.ts) and [`packages/experimental/dsh-orchestration/src/capabilities.ts`](../../packages/experimental/dsh-orchestration/src/capabilities.ts).

## Model pool

`PoolRoute` names one route in the selected pool. `provider` is a route registered on `ctx.llm`; `model` is the exact API model id passed to the provider. Capability matching resolves from the provider's investigated catalog, never from per-route tags, so any pool route must name a model the provider catalog recognizes.

```ts type-equiv
/**
 * One model route in the selected pool. `provider` and `model` form the exact
 * route passed to a subagent's `agentOptions`; capability matching is resolved
 * from the provider's investigated catalog, not from per-route tags.
 */
interface PoolRoute {
  /** Provider route registered on `ctx.llm`. */
  readonly provider: string
  /** Exact API model id as passed to the provider. */
  readonly model: string
}
```

```ts type-equiv
/** Identifies one planned substep within an orchestration. */
type OrchestrationStepId = Branded<'OrchestrationStepId'>
```

## Plan and outcome

A run plans steps with required capability domains, executes each against a route, and reports a per-step outcome and a terminal run result.

```ts type-equiv
/**
 * One planned step from the coordinator. `description` is a self-contained
 * task sent verbatim to a spawned worker; `requiredDomains` drive capability
 * matching against the provider catalog.
 */
interface PlannedStep {
  readonly id: OrchestrationStepId
  /** Self-contained worker prompt; stands alone with no parent conversation. */
  readonly description: string
  /** Capability domains this sub-task requires, from the provider catalog. */
  readonly requiredDomains: readonly TaskDomain[]
  /** Input modalities this sub-task needs; absent means text-only routing. */
  readonly requiredModalities?: readonly Modality[]
  /** Estimated input tokens this sub-task needs; absent means no window constraint. */
  readonly contextTokens?: number
  /** Reasons this step cannot run; an errored plan rejects before workers start. */
  readonly error?: string
}
```

```ts type-equiv
/** One attempt of one step against one pool route. */
interface WorkerAttempt {
  readonly stepId: OrchestrationStepId
  /** Provider/model route actually used. */
  readonly provider: string
  readonly model: string
  /** Child session id, available after publication. */
  readonly childId?: string
  readonly stopReason: SubagentStopReason
  /** Non-assistant failure detail when present; never routed on programmatically. */
  readonly diagnostic?: string
}
```

```ts type-equiv
/** One step after its attempts: the accepted output or why it failed. */
interface StepOutcome {
  readonly step: PlannedStep
  readonly attempts: readonly WorkerAttempt[]
  /** Assistant output of the accepted attempt, or `[]` on failure. */
  readonly output: readonly ContentBlock[]
  /** True when the step exhausted its attempts or was never started validly. */
  readonly failed: boolean
  /** True when a model route change occurred between attempts. */
  readonly failedOver: boolean
}
```

```ts type-equiv
/** The terminal result of one orchestrated run. */
interface OrchestrationResult {
  /** Every step in plan order with its outcome. */
  readonly steps: readonly StepOutcome[]
  /** True when every step completed successfully. */
  readonly succeeded: boolean
  /** Number of model route changes across all steps. */
  readonly failovers: number
  /** Number of steps that never completed. */
  readonly failedSteps: number
}
```

```ts type-equiv
/** The discipline a sub-task is best served by. */
type TaskDomain = 'coding' | 'reasoning' | 'vision' | 'allrounder' | 'european'
```

The Gateways capability investigation maps these domains onto what each provider model supports; a step routes to the best-matching capable model and, on a failed or non-responding worker, to the next most capability-similar route before the step is reported failed.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxorchestrations--orchestrationservice"></a>

### `ctx.orchestrations` — `OrchestrationService`

Orchestration service; injects the seams it composes and exposes the pool over Remote.

```ts cordis-catalog
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
modeOf(agent: Agent): boolean

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
setMode(agent: Agent, active: boolean): void

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
select(agent: Agent, active: boolean): 'committed' | 'queued' | 'cancelled' | 'noop'

/**
 * The currently selected multi-model pool, set by the GUI panel or a caller.
 * @returns the selected provider/model routes; may be empty.
 */
@Remote('getPool') getPool(): readonly PoolRoute[]

/**
 * Replace the selected multi-model pool. An empty pool clears the selection;
 * later runs then fail loud rather than silently running nothing.
 * @param pool - provider/model routes to select.
 */
@Remote('setPool') setPool(pool: readonly PoolRoute[]): void

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
async run( parent: Agent, task: string, pool: readonly PoolRoute[] | undefined, signal: AbortSignal, ): Promise<OrchestrationResult>
```

Types: [Agent](core.md)

Source: [`packages/experimental/dsh-orchestration/src/index.ts`](../../packages/experimental/dsh-orchestration/src/index.ts)
<!-- END GENERATED cordis-surface -->
