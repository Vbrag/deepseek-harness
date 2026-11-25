# Orchestration

English | [中文](orchestration.zh.md)

Orchestration mode assigns normal fresh subagents to permitted model routes using the task assessment, required inputs, context estimate, and available capacity. The lead agent retains the session model. Default mode preserves normal delegation. The [service reference](../../packages/subagent/orchestration/README.md) owns configuration; the [subagent runtime](subagent.md) owns admission, child execution, and teardown.

## Task assessment and eligibility

The normal spawn request carries required and preferred capabilities, required modalities including anticipated visual input, estimated context tokens, and optional output needs. Required capabilities are an intersection: coding plus visual verification requires both coding and image understanding. A reasoning specialty alone does not satisfy required coding. Unknown capabilities do not establish eligibility.

The adapter supplies exact route metadata. Explicit limitations override curated capability facts; configured task-specialty overrides apply only to their exact provider/model pair. The router considers configured prompt/tool overhead and response allowance with the handoff and lead estimates. Actual request validation remains authoritative after the child's prompt and tools are assembled.

## Capacity and model lifetime

Eligible ready routes are ranked by task fit, then active assignments and stable pool order. A compatible delayed route is preferred over an incompatible ready route. Assignments measure load across sessions; the adapter alone reserves request and token quota at actual dispatch. A started child keeps its route; quota pressure does not replay its work on another model.

## Mode and authorization

The committed per-session mode and selected pool are logged and projected. Mid-turn selections apply at the next accepted non-aborted step. A fresh child snapshots its parent's committed mode and pool before admission waits and records that selection before its first request. Changing the parent's mode later does not change existing children's modes.

Existing recorded model permissions constrain routing, and historical absence permits only the parent route. Enabling the main conversation's switch durably authorizes the selected pool. Added routes require a new activation; removed routes are immediately ineligible for new work and recovery, including after re-addition within the same activation. Existing children keep their grants. Older active Sessions without a snapshot require off/on before new orchestrated work. A failed checkpoint blocks new delegations until storage is retried.

The Host catalog endpoint returns `OrchestrationCatalog` grouped by live provider. The Web panel reads it through Remote and can save user-defined specialties for exact routes.

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

/** Read the active pool and user-assigned specialties at one revision.
 * @returns Detached settings for the pool editor.
 */
@Remote('getPoolConfiguration') getPoolConfiguration(): PoolConfiguration

/** Review the current pool and the Session's existing child-model permissions.
 * @param sessionId - Conversation to activate.
 * @returns A setup requirement or a one-use review of the exact routes.
 */
@Remote({ name: 'prepareActivation', resources: { session: sessionId => sessionId } }) async prepareActivation(sessionId: SessionId): Promise<OrchestrationActivationPreflight>

/** Apply one reviewed activation without widening permissions without consent.
 * @param sessionId - Conversation from the review.
 * @param reviewId - One-use review identifier.
 * @param authorize - Whether the user approved the displayed additional routes.
 * @returns Applied, queued, stale, or failed admission.
 */
@Remote({ name: 'activateReviewed', resources: { session: sessionId => sessionId } }) async activateReviewed(sessionId: SessionId, reviewId: OrchestrationReviewId, authorize: boolean): Promise<OrchestrationActivationResult>

/** Enable a root conversation using the current pool as the owner's selection.
 * @param sessionId - Conversation to activate.
 * @returns Applied or queued selection, or an actionable setup failure.
 */
@Remote({ name: 'activatePool', resources: { session: sessionId => sessionId } }) async activatePool(sessionId: SessionId): Promise<OrchestrationPoolActivationResult>

/** Retry a failed authorization checkpoint without writing another approval.
 * @param sessionId - Conversation whose checkpoint failed.
 * @returns Whether the Session's checkpoint is now durable.
 */
@Remote({ name: 'retryActivationStorage', resources: { session: sessionId => sessionId } }) async retryActivationStorage(sessionId: SessionId): Promise<boolean>

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

/** Persist a pool and exact-route specialty overrides against the settings revision.
 * @param pool - Selected exact provider/model routes.
 * @param capabilityOverrides - User-assigned specialties for exact routes.
 * @param revision - Revision returned by {@link getPoolConfiguration}.
 * @returns Confirmed configuration or an actionable stale/failed result.
 */
@Remote('persistPoolConfiguration') async persistPoolConfiguration(pool: readonly PoolRoute[], capabilityOverrides: readonly RouteCapabilities[], revision: number): Promise<PoolConfigurationSaveResult>
```

Types: [Agent](core.md) · [OrchestrationActivationPreflight](../../packages/subagent/orchestration/README.md#use-this-package) · [OrchestrationActivationResult](../../packages/subagent/orchestration/README.md#use-this-package) · [OrchestrationPoolActivationResult](../../packages/subagent/orchestration/README.md#use-this-package) · [OrchestrationReviewId](../../packages/subagent/orchestration/README.md#use-this-package) · [PoolConfiguration](../../packages/subagent/orchestration/README.md#use-this-package) · [PoolConfigurationSaveResult](../../packages/subagent/orchestration/README.md#use-this-package) · [PoolSaveResult](../../packages/subagent/orchestration/README.md#use-this-package) · [PoolSettingsState](../../packages/subagent/orchestration/README.md#use-this-package) · [RouteCapabilities](../../packages/subagent/orchestration/README.md#use-this-package) · [SessionId](core.md)

Source: [`packages/subagent/orchestration/src/index.ts`](../../packages/subagent/orchestration/src/index.ts)
<!-- END GENERATED cordis-surface -->
