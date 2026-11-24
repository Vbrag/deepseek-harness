# Orchestration

English | [中文](orchestration.zh.md)

Orchestration mode assigns normal fresh subagents to permitted model routes using the task assessment, required inputs, context estimate, and available capacity. The lead agent retains the session model. Default mode preserves normal delegation. The [service reference](../../packages/experimental/dsh-orchestration/README.md) owns configuration; the [subagent runtime](subagent.md) owns admission, child execution, and teardown.

## Task assessment and eligibility

The normal spawn request carries required and preferred capabilities, required modalities including anticipated visual input, estimated context tokens, and optional output needs. Required capabilities are an intersection: coding plus visual verification requires both coding and image understanding. A reasoning specialty alone does not satisfy required coding. Unknown capabilities do not establish eligibility.

The adapter supplies exact route metadata. Explicit limitations override curated capability facts; configured task-specialty overrides apply only to their exact provider/model pair. The router considers configured prompt/tool overhead and response allowance with the handoff and lead estimates. Actual request validation remains authoritative after the child's prompt and tools are assembled.

## Capacity and model lifetime

Eligible ready routes are ranked by task fit, then active assignments and stable pool order. A compatible delayed route is preferred over an incompatible ready route. Assignments measure load across sessions; the adapter alone reserves request and token quota at actual dispatch. A started child keeps its route; quota pressure does not replay its work on another model.

## Mode and authorization

The committed per-session mode is logged and projected. Mid-turn selections apply at the next accepted non-aborted step. A fresh child snapshots its parent's committed mode before admission waits and records that selection before its first request. Changing the parent's mode later does not change existing children's modes.

Existing recorded model permissions constrain routing, and historical absence permits only the parent route. The existing model-selection settings owner initializes fresh root permissions from an explicit setting or the router's selected pool. Pool changes do not widen permissions in existing sessions.

The Host catalog endpoint returns `OrchestrationCatalog`: the provider id and its curated model capability records. The Web panel reads this through Remote rather than importing Host runtime values.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxorchestrations--orchestrationservice"></a>

### `ctx.orchestrations` — `OrchestrationService`

Mode and pool owner; one registered selector serves every normal local delegation.

```ts cordis-catalog
/** Read the applied logged mode; pending selections affect only the next accepted step.
 * @param agent - Session owner.
 * @returns Applied mode for new delegations.
 */
modeOf(agent: Agent): boolean

/** Record a selection immediately between turns, or queue it durably within a turn.
 * @param agent - Session owner.
 * @param active - Desired mode.
 */
setMode(agent: Agent, active: boolean): void

/** Select mode without losing pending intent on restart or plugin replacement.
 * @param agent - Session owner.
 * @param active - Desired mode.
 * @returns Whether the selection committed, queued, cancelled a pending choice, or already matched.
 */
select(agent: Agent, active: boolean): 'committed' | 'queued' | 'cancelled' | 'noop'

/** Read the default pool; recorded Session policies independently constrain every delegation.
 * @returns Detached exact routes in configured order.
 */
@Remote('getPool') getPool(): readonly PoolRoute[]

/** Read the effective pool and its current settings revision.
 * @returns The current pool and null when settings are unavailable.
 */
@Remote('getPoolSettingsState') getPoolSettingsState(): PoolSettingsState

/** Permit a user to retry models after correcting an exhausted billing account. */
@Remote('resetBillingHealth') resetBillingHealth(): void

/** Project the pool picker catalog from the live LLM registry, not a static list.
 * Providers and models are taken from `ctx.llm.listProviders()`/`listModels()`,
 * so the picker matches the models the composer can actually select. Curated
 * specialties/capacity from the Paderborn catalogue apply only to known
 * `uni-paderborn` routes; everything else carries live adapter metadata.
 * @returns Detached per-provider model facts used by the pool picker.
 */
@Remote('getCatalog') async getCatalog(): Promise<OrchestrationCatalog>

/** Replace the pool in memory; existing Session authorization is never widened.
 * @param pool - Exact routes, possibly empty to disable automatic selection.
 */
@Remote('setPool') setPool(pool: readonly PoolRoute[]): void

/** Persist a pool against the revision read by the caller.
 * @param pool - New default routes; existing Session authorization remains fixed.
 * @param revision - Settings revision from the most recent read.
 * @returns The applied pool or an actionable failure.
 */
@Remote('persistPool') async persistPool(pool: readonly PoolRoute[], revision: number): Promise<PoolSaveResult>
```

Types: [Agent](core.md) · [PoolSaveResult](../../packages/experimental/dsh-orchestration/README.md#use-this-package) · [PoolSettingsState](../../packages/experimental/dsh-orchestration/README.md#use-this-package)

Source: [`packages/experimental/dsh-orchestration/src/index.ts`](../../packages/experimental/dsh-orchestration/src/index.ts)
<!-- END GENERATED cordis-surface -->
