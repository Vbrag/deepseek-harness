/** Session mode, selected routes, and deployment policy for normal subagent routing. */
import type { CommandId } from '@deepseek-ai/dsh-commands/types'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentTaskAssessment } from '@deepseek-ai/dsh-subagent'
import type { LlmQueueAvailability } from '@deepseek-ai/dsh-llm/types'
import type { ModelCapability, TaskDomain } from './capabilities.ts'

/** One exact registered LLM route eligible for orchestration. */
export interface PoolRoute {
  /** Registered LLM provider. */
  readonly provider: string
  /** Exact model id accepted by the provider. */
  readonly model: string
}

/** Identity of one uninterrupted membership in the configured pool. */
export type PoolMembershipId = Branded<'OrchestrationPoolMembershipId'>

/** A route and the identity of its current pool membership. */
export interface PoolMembership extends PoolRoute {
  /** Identity retained while this route stays in the pool. */
  readonly membershipId: PoolMembershipId
}

/** A model row shown by the pool settings client, grouped by its registered provider. */
export interface OrchestrationCatalogModel extends ModelCapability {
  /** Exact registered LLM provider that serves this route; the route is `{provider, id}`. */
  readonly provider: string
  /** Human provider display name for selectors. */
  readonly providerName: string
  /** True when specialties/capacity come from the curated catalogue rather than live adapter metadata. */
  readonly offlineCurated: boolean
}

/** One provider group in the pool settings catalog. */
export interface OrchestrationCatalogGroup {
  /** Exact registered LLM provider id. */
  readonly provider: string
  /** Human provider display name. */
  readonly name: string
  /** Models this provider currently advertises. */
  readonly models: readonly OrchestrationCatalogModel[]
}

/** Pool picker choices projected from the live LLM registry, with curated annotations. */
export interface OrchestrationCatalog {
  /** Non-empty provider groups with at least one advertised model. */
  readonly groups: readonly OrchestrationCatalogGroup[]
}

/** Current effective pool and the revision required for a settings write. */
export interface PoolSettingsState {
  readonly pool: readonly PoolRoute[]
  readonly revision: number | null
}

/** Result of attempting a revision-checked pool write. */
export type PoolSaveResult =
  | { readonly status: 'saved'; readonly pool: readonly PoolRoute[]; readonly revision: number }
  | { readonly status: 'stale' | 'failed'; readonly message: string }

/** Pool and user-assigned specialties read at one settings revision. */
export interface PoolConfiguration extends PoolSettingsState {
  readonly capabilityOverrides: readonly RouteCapabilities[]
}

/** Result of a revision-checked pool and specialty write. */
export type PoolConfigurationSaveResult =
  | { readonly status: 'saved'; readonly configuration: PoolConfiguration }
  | { readonly status: 'stale' | 'failed'; readonly message: string }

/** One Host-owned activation review, invalidated by later Session or pool changes. */
export type OrchestrationReviewId = Branded<'OrchestrationReviewId'>

/** Current requirements for enabling orchestration in one Session. */
export type OrchestrationActivationPreflight =
  | { readonly status: 'needs-pool' | 'unavailable' | 'durability' | 'child-restricted' }
  | {
    readonly status: 'ready' | 'authorize'
    readonly reviewId: OrchestrationReviewId
    readonly pool: readonly PoolRoute[]
    readonly additionalRoutes: readonly PoolRoute[]
  }

/** Result of applying a reviewed orchestration selection. */
export type OrchestrationActivationResult =
  | { readonly status: 'applied' | 'queued' }
  | { readonly status: 'stale' | 'failed' | 'authorization-required' }

/** Result of enabling orchestration with the current selected pool. */
export type OrchestrationPoolActivationResult =
  | { readonly status: 'applied' | 'queued' | 'needs-pool' | 'unavailable' | 'durability' | 'stale' | 'failed' }

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Only the owner may approve child model routes. */
    'orchestration/owner-required': Record<string, never>
  }
}

/** Explicit specialty facts for a route, replacing its curated specialties. */
export interface RouteCapabilities extends PoolRoute {
  /** Every specialty the route may satisfy; an empty list clears curated facts. */
  readonly capabilities: readonly TaskDomain[]
}

/** Validated deployment policy; session selections take precedence over defaults. */
export interface OrchestrationConfig {
  /** Default pool for new root-session model policies and the pool picker. */
  readonly pool?: PoolRoute[]
  /** User-selected pool persisted through Settings; takes precedence over `pool`. */
  readonly userPool?: PoolRoute[]
  /** An explicit user override exists, including an intentionally empty pool. */
  readonly userPoolConfigured?: boolean
  /** Durable identities for the current pool memberships. */
  readonly userPoolMemberships?: Array<PoolRoute & {
    /** Identity retained while this route stays in the pool. */
    readonly membershipId: string
  }>
  /** Exact-route specialties for models outside the curated gateway catalog. */
  readonly routeCapabilities?: RouteCapabilities[]
  /** User-saved exact-route specialty overrides. */
  readonly userRouteCapabilities?: RouteCapabilities[]
  /** Input-token allowance for child instructions, tool schemas, and request wrappers; defaults to 8192. */
  readonly contextOverheadTokens?: number
  /** Output-token allowance when the assessment omits outputTokens; defaults to 4096. */
  readonly outputReserveTokens?: number
  /** Maximum milliseconds before rechecking busy routes after capacity refunds; defaults to 1000. */
  readonly availabilityPollMs?: number
  /** Initial mode logged for a session with no recorded selection; defaults to false. */
  readonly defaultToOrchestrator?: boolean
  /** Record an inactive default and capture it for new children. */
  readonly recordDisabledDefault?: boolean
  /** Use the configured pool as authorization for new root Sessions. */
  readonly seedPoolAsRootPolicy?: boolean
  /** Maximum child model changes per recovery episode; defaults to 2. Explicit phases start a new episode. */
  readonly maxAutomaticReassignments?: number
  /** Consecutive output-limit responses without text or tools before recovery; defaults to 2. */
  readonly maxEmptyOutputLimits?: number
}

/** Hard requirement or queue condition preventing a route from participating. */
export type OrchestrationRouteExclusion =
  | 'unauthorized' | 'missing-required-capability' | 'missing-required-modality'
  | 'unknown-context' | 'context-capacity' | 'output-capacity' | 'rate-limit' | 'request-token-capacity'
  | 'compaction-budget' | 'recovery-attempted' | 'billing-exhausted' | 'unsupported-reasoning' | 'route-unavailable'

/** Capacity and eligibility facts for one other configured route at assignment time. */
export interface OrchestrationRouteAlternative extends PoolRoute {
  /** Active and reserved children, with each child counted once. */
  readonly activeAssignments: number
  /** Empty only when this route could participate in the selection. */
  readonly exclusions: readonly OrchestrationRouteExclusion[]
  /** Advisory provider queue state; omitted when hard eligibility failed. */
  readonly availability?: LlmQueueAvailability
  /** Verified specialties, when this authorized route was inspected. */
  readonly capabilities?: readonly string[]
  /** Verified input modalities, when known. */
  readonly modalities?: readonly string[]
  /** Known combined input/output capacity. */
  readonly contextWindow?: number
  /** Known provider response ceiling. */
  readonly maxOutputTokens?: number
}

/** Logged evidence for one automatic child-model selection. */
export interface OrchestrationRouteDecision {
  /** Fresh child that receives the selected route. */
  readonly childId: SessionId
  /** Parent's declared task needs, including anticipated tool-produced images. */
  readonly assessment: SubagentTaskAssessment
  /** Selected exact LLM route. */
  readonly selected: PoolRoute
  /** First priority separating the selected eligible route from its next competitor. */
  readonly reason: 'active-load' | 'queue-readiness' | 'task-fit' | 'diversity' | 'pool-order'
  /** Eligible ready-or-unknown routes; absent in retained records without diagnostic evidence. */
  readonly eligibleCount?: number
  /** Active and reserved children before selection; absent in retained records without diagnostic evidence. */
  readonly selectedLoad?: number
  /** Confirmed or unreported capacity; absent in retained records without diagnostic evidence. */
  readonly selectedReadiness?: 'ready' | 'unknown'
  /** Other configured routes and their evidence; absent in retained records without diagnostic evidence. */
  readonly alternatives?: readonly OrchestrationRouteAlternative[]
  /** Estimated input including the configured instruction allowance. */
  readonly inputTokens: number
  /** Conservative response allowance used for context eligibility. */
  readonly outputTokens: number
}

/** Browser view of the logged mode and an outstanding selection. */
export interface OrchestrationProjection {
  active: boolean
  pending: boolean
  /** An older activation needs to be switched off and on to capture its pool. */
  requiresReactivation?: boolean | undefined
}

/** Explicitly assessed next phase, applied only at a model-request boundary. */
export interface OrchestrationPhaseRequest {
  /** Issuing routing-state revision, stable through unrelated progress records. */
  readonly revision: number
  readonly assessment: SubagentTaskAssessment
  readonly reason: string
  readonly checkpoint: string
  readonly preferredRoute?: PoolRoute
  readonly maxTokens?: number
}

/** Current and requested routes with recovery counters that survive reload. */
export interface OrchestrationRoutingState {
  readonly revision: number
  readonly assessment: SubagentTaskAssessment | null
  readonly request: OrchestrationPhaseRequest | null
  readonly route: PoolRoute | null
  readonly previous: PoolRoute | null
  readonly status: 'idle' | 'queued' | 'changing' | 'waiting' | 'blocked'
  readonly reason: string
  readonly checkpoint: string
  readonly maxTokens: number | null
  readonly automaticChanges: number
  readonly tried: readonly PoolRoute[]
  readonly emptyLimits: number
  /** Largest reported current-surface input; cleared by a committed compaction. */
  readonly observedInputTokens: number
}

/** Recoverable mode and legacy command lifecycle state. */
export interface OrchestrationUnitState {
  /** Mode applied to new delegations. */
  active: boolean
  /** Durable selection waiting for an accepted step; null when absent. */
  wanted: boolean | null
  /** Legacy command selection awaiting its settlement. */
  running: { commandId: CommandId; wanted: boolean } | null
  /** Whether an explicit or default mode was logged. */
  entered: boolean
  /** Pool captured for the applied activation; null for older Sessions. */
  activePool: readonly PoolMembership[] | null
  /** Pool captured for an activation waiting for the next step. */
  wantedPool: readonly PoolMembership[] | null
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Durable mode selection queued during an open turn. */
    'orchestration/mode-request': { active: boolean }
    /** Pool captured when an activation is applied or queued. */
    'orchestration/pool-snapshot': { pending: boolean; members: readonly PoolMembership[] }
    /** Informational routing evidence; never changes model history. */
    'orchestration/route': OrchestrationRouteDecision
    /** Full bounded routing state; informational until the runtime admits its requested route. */
    'orchestration/routing-state': OrchestrationRoutingState
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Applied and pending orchestration mode. */
    orchestration: OrchestrationProjection
    /** Phase request, applied route, and recovery disposition for a lead or local child. */
    orchestrationRouting: OrchestrationRoutingState
  }
}
