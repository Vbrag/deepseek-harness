/** Exact-route capability filtering and deterministic normal-subagent route ordering. */
import type { LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import type { SubagentTaskAssessment } from '@deepseek-ai/dsh-subagent'
import { capabilityOf, POOL_PROVIDER } from './capabilities.ts'
import type { PoolRoute, RouteCapabilities, OrchestrationRouteDecision, OrchestrationRouteExclusion } from './types.ts'

/** Route metadata sufficient to check every required task capability. */
export interface CapabilityRoute extends PoolRoute {
  /** Verified route specialties, augmented or restricted by exact adapter facts. */
  readonly capabilities: readonly string[]
  /** Supported input modalities; undefined means unknown. */
  readonly modalities: readonly string[] | undefined
  /** Combined input/output capacity; undefined means unknown. */
  readonly contextWindow: number | undefined
  /** Provider maximum response tokens; undefined means unknown. */
  readonly maxOutputTokens: number | undefined
  /** Provider-supplied billing and explicit reasoning facts. */
  readonly billing?: LlmResolvedModelInfo['billing']
  readonly reasoningEfforts?: readonly string[]
}

/** Resolve one route using exact adapter facts and optional configured specialties.
 * @param route - Exact provider/model route.
 * @param info - Metadata from that route's owning adapter.
 * @param overrides - Validated deployment specialty declarations.
 * @returns A route whose exact metadata takes precedence over catalog hints.
 */
export function capabilityRoute(
  route: PoolRoute,
  info: LlmResolvedModelInfo,
  overrides: readonly RouteCapabilities[],
): CapabilityRoute {
  const catalog = route.provider === POOL_PROVIDER ? capabilityOf(route.model) : undefined
  const explicit = overrides.find(item => item.provider === route.provider && item.model === route.model)
  const capabilities = new Set<string>(explicit?.capabilities ?? catalog?.domains ?? [])
  const modalities = (info.inputModalities ?? catalog?.modalities)?.filter(item => item === 'text' || item === 'image')
  if (explicit === undefined && info.reasoning !== undefined) capabilities.add('reasoning')
  if (explicit === undefined && modalities?.includes('image') === true) capabilities.add('vision')
  if (modalities?.includes('image') !== true) capabilities.delete('vision')
  return {
    ...route,
    capabilities: [...capabilities],
    modalities,
    contextWindow: info.context?.contextWindow ?? catalog?.contextWindow,
    maxOutputTokens: info.maxOutputTokens,
    ...info.billing === undefined ? {} : { billing: info.billing },
    ...info.reasoning === undefined ? {} : { reasoningEfforts: info.reasoning.efforts.map(effort => effort.id) },
  }
}

/** Test the strict intersection of specialties, anticipated modalities, and context capacity.
 * @param route - Exact route with resolved facts.
 * @param assessment - Parent-declared child task needs.
 * @param inputTokens - Complete input estimate including instructions and tools.
 * @param outputTokens - Response allowance.
 * @returns True only when every required fact is positively established.
 */
export function routeFits(
  route: CapabilityRoute,
  assessment: SubagentTaskAssessment,
  inputTokens: number,
  outputTokens: number,
): boolean {
  return routeExclusions(route, assessment, inputTokens, outputTokens).length === 0
}

/**
 * Explain every failed hard task or capacity requirement without relaxing eligibility.
 * @param route - Exact route with resolved metadata.
 * @param assessment - Required specialties and anticipated input modalities.
 * @param inputTokens - Complete estimated input.
 * @param outputTokens - Required response allowance.
 * @returns Failed requirements in deterministic order, or an empty list for a capable route.
 */
export function routeExclusions(route: CapabilityRoute, assessment: SubagentTaskAssessment,
  inputTokens: number, outputTokens: number): OrchestrationRouteExclusion[] {
  const reasons: OrchestrationRouteExclusion[] = []
  if (!assessment.requiredCapabilities.every(item => route.capabilities.includes(item))) reasons.push('missing-required-capability')
  if (!(assessment.requiredModalities ?? ['text']).every(item => route.modalities?.includes(item) === true)) {
    reasons.push('missing-required-modality')
  }
  if (route.contextWindow === undefined) reasons.push('unknown-context')
  else if (route.contextWindow < inputTokens + outputTokens) reasons.push('context-capacity')
  if (route.maxOutputTokens !== undefined && route.maxOutputTokens < outputTokens) reasons.push('output-capacity')
  return reasons
}

/** A capable route with ready or unknown queue capacity and process-owned assignment load. */
export interface ReadyRoute {
  /** Resolved candidate. */
  readonly route: CapabilityRoute
  /** Live children assigned to the exact route across all sessions. */
  readonly active: number
  /** Confirmed ready capacity wins only between routes with equal active assignment counts. */
  readonly readiness: 'ready' | 'unknown'
  /** Monotonic most recent assignment; zero before the first assignment. */
  readonly lastAssigned: number
}

/** Choose by assignment load, confirmed readiness, optional strengths, recency, then pool order.
 * @param candidates - Capable ready-or-unknown routes in pool order.
 * @param assessment - Required and preferred task specialties.
 * @returns The selected route and the first priority that separated candidates.
 */
export function selectReadyRoute(
  candidates: readonly ReadyRoute[],
  assessment: SubagentTaskAssessment,
): { route: CapabilityRoute; reason: OrchestrationRouteDecision['reason']; readiness: ReadyRoute['readiness'] } | undefined {
  const score = (entry: ReadyRoute): number =>
    (assessment.preferredCapabilities ?? []).filter(item => entry.route.capabilities.includes(item)).length
  const readiness = (entry: ReadyRoute): number => entry.readiness === 'ready' ? 0 : 1
  const sorted = [...candidates].sort((a, b) =>
    (a.active - b.active) || (readiness(a) - readiness(b)) || (score(b) - score(a)) || (a.lastAssigned - b.lastAssigned))
  const first = sorted[0]
  if (first === undefined) return undefined
  const second = sorted[1]
  const reason = second === undefined ? 'pool-order'
    : first.active !== second.active ? 'active-load'
      : first.readiness !== second.readiness ? 'queue-readiness'
        : score(first) !== score(second) ? 'task-fit'
          : first.lastAssigned !== second.lastAssigned ? 'diversity'
            : 'pool-order'
  return { route: first.route, reason, readiness: first.readiness }
}
