/**
 * Public contracts for the orchestration capability: the selected model pool,
 * the capability-aware plan the coordinator produces, and the settled outcome
 * of one orchestrated run.
 *
 * @module @deepseek-ai/dsh-experimental-orchestration/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SubagentStopReason } from '@deepseek-ai/dsh-subagent'
import type { CommandId } from '@deepseek-ai/dsh-commands/brand'
import type { Modality, TaskDomain } from './capabilities.ts'

/** Identifies one planned substep within an orchestration. */
export type OrchestrationStepId = Branded<'OrchestrationStepId'>

/**
 * One model route in the selected pool. `provider` and `model` form the exact
 * route passed to a subagent's `agentOptions`; capability matching is resolved
 * from the provider's investigated catalog, not from per-route tags.
 */
export interface PoolRoute {
  /** Provider route registered on `ctx.llm`. */
  readonly provider: string
  /** Exact API model id as passed to the provider. */
  readonly model: string
}

/** Accepted deployment limits for one orchestration; every field is optional and defaults on validation. */
export interface OrchestrationConfig {
  /**
   * Persisted multi-model pool. Seeded into the service at load and written by
   * {@link OrchestrationService.persistPool} on GUI change, so the selection
   * survives restart. Execution reads the service's selected pool, which is
   * restored from this field on boot.
   */
  readonly pool?: PoolRoute[]
  /** Maximum concurrent workers, sampled before each run. */
  readonly maxConcurrency?: number
  /** Maximum attempts per planned step before the step is reported failed. */
  readonly maxAttemptsPerStep?: number
  /** Timeout, in milliseconds, budgeted per worker attempt before it is abandoned. */
  readonly workerTimeoutMs?: number
  /**
   * Seed the per-Agent (session) orchestration-mode default. A session with no
   * explicit {@link OrchestrationService.setMode} or `select` selection falls
   * back to this value, which `run_orchestration` consumes as its delegation
   * gate. The selection is recorded as a Session `orchestration/mode` event and
   * recovered from the `orchestration` session projection after restart, so an
   * explicit selection always wins over this default.
   */
  readonly defaultToOrchestrator?: boolean
}

/**
 * One planned step from the coordinator. `description` is a self-contained
 * task sent verbatim to a spawned worker; `requiredDomains` drive capability
 * matching against the provider catalog.
 */
export interface PlannedStep {
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

/** One attempt of one step against one pool route. */
export interface WorkerAttempt {
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

/** One step after its attempts: the accepted output or why it failed. */
export interface StepOutcome {
  readonly step: PlannedStep
  readonly attempts: readonly WorkerAttempt[]
  /** Assistant output of the accepted attempt, or `[]` on failure. */
  readonly output: readonly ContentBlock[]
  /** True when the step exhausted its attempts or was never started validly. */
  readonly failed: boolean
  /** True when a model route change occurred between attempts. */
  readonly failedOver: boolean
}

/** The terminal result of one orchestrated run. */
export interface OrchestrationResult {
  /** Every step in plan order with its outcome. */
  readonly steps: readonly StepOutcome[]
  /** True when every step completed successfully. */
  readonly succeeded: boolean
  /** Number of model route changes across all steps. */
  readonly failovers: number
  /** Number of steps that never completed. */
  readonly failedSteps: number
}

/**
 * The orchestration projection's wire value. `active` is the logged mode in
 * force (the last `orchestration/mode`, inactive before the first); `pending`
 * is true while a `/orchestration selection` targets a state other than
 * `active`, has not failed through its paired `command/done`, and no later
 * `orchestration/mode` event has recorded that state. Capability absence
 * (orchestration not composed) is the key's absence, never a value.
 */
export interface OrchestrationProjection {
  active: boolean
  pending: boolean
}

/** Host state used to derive {@link OrchestrationProjection}. */
export interface OrchestrationUnitState {
  /** Logged orchestration mode. */
  active: boolean
  /** The selection's target mode; null when no selection is outstanding. */
  wanted: boolean | null
  /** The latest orchestration command awaiting its paired settlement. */
  running: { commandId: CommandId; wanted: boolean } | null
  /** Whether a logged `orchestration/mode` selection (on or off) has been recorded in this Session. */
  entered: boolean
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Orchestration mode state folded from the command lifecycle and `orchestration/mode` events. */
    orchestration: OrchestrationProjection
  }
}
