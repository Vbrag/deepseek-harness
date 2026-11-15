/** Session mode, selected routes, and deployment policy for normal subagent routing. */
import type { CommandId } from '@deepseek-ai/dsh-commands/types'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentTaskAssessment } from '@deepseek-ai/dsh-subagent'
import type { ModelCapability, TaskDomain } from './capabilities.ts'

/** One exact registered LLM route eligible for orchestration. */
export interface PoolRoute {
  /** Registered LLM provider. */
  readonly provider: string
  /** Exact model id accepted by the provider. */
  readonly model: string
}

/** Curated gateway choices shown by the pool settings client. */
export interface OrchestrationCatalog {
  /** Exact registered provider associated with these gateway model ids. */
  readonly provider: string
  /** Read-only model facts; exact adapter metadata takes precedence during routing. */
  readonly models: readonly ModelCapability[]
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
  /** Exact-route specialties for models outside the curated gateway catalog. */
  readonly routeCapabilities?: RouteCapabilities[]
  /** Input-token allowance for child instructions, tool schemas, and request wrappers; defaults to 8192. */
  readonly contextOverheadTokens?: number
  /** Output-token allowance when the assessment omits outputTokens; defaults to 4096. */
  readonly outputReserveTokens?: number
  /** Maximum milliseconds before rechecking busy routes after capacity refunds; defaults to 1000. */
  readonly availabilityPollMs?: number
  /** Initial mode logged for a session with no recorded selection; defaults to false. */
  readonly defaultToOrchestrator?: boolean
}

/** Logged evidence for one automatic child-model selection. */
export interface OrchestrationRouteDecision {
  /** Fresh child that receives the selected route. */
  readonly childId: SessionId
  /** Parent's declared task needs, including anticipated tool-produced images. */
  readonly assessment: SubagentTaskAssessment
  /** Selected exact LLM route. */
  readonly selected: PoolRoute
  /** Deterministic selection priority among ready capable routes. */
  readonly reason: 'task-fit' | 'active-load' | 'diversity' | 'pool-order'
  /** Estimated input including the configured instruction allowance. */
  readonly inputTokens: number
  /** Conservative response allowance used for context eligibility. */
  readonly outputTokens: number
}

/** Browser view of the logged mode and an outstanding selection. */
export interface OrchestrationProjection {
  active: boolean
  pending: boolean
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
}

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    /** Durable mode selection queued during an open turn. */
    'plugin:orchestration/mode-request': { active: boolean }
    /** Informational routing evidence; never changes model history. */
    'plugin:orchestration/route': OrchestrationRouteDecision
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Applied and pending orchestration mode. */
    orchestration: OrchestrationProjection
  }
}
