/** Exact-route capability filtering and deterministic normal-subagent route ordering. */
import type { LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import type { SubagentTaskAssessment } from '@deepseek-ai/dsh-subagent'
import { capabilityOf, POOL_PROVIDER } from './capabilities.ts'
import type { PoolRoute, RouteCapabilities, OrchestrationRouteDecision } from './types.ts'

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
  if (info.reasoning !== undefined) capabilities.add('reasoning')
  if (modalities?.includes('image') === true) capabilities.add('vision')
  else capabilities.delete('vision')
  return {
    ...route,
    capabilities: [...capabilities],
    modalities,
    contextWindow: info.context?.contextWindow ?? catalog?.contextWindow,
    maxOutputTokens: info.maxOutputTokens,
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
  return assessment.requiredCapabilities.every(item => route.capabilities.includes(item))
    && (assessment.requiredModalities ?? ['text']).every(item => route.modalities?.includes(item) === true)
    && route.contextWindow !== undefined
    && route.contextWindow >= inputTokens + outputTokens
    && (route.maxOutputTokens === undefined || route.maxOutputTokens >= outputTokens)
}

/** A currently ready route with process-owned load information. */
export interface ReadyRoute {
  /** Resolved candidate. */
  readonly route: CapabilityRoute
  /** Live children assigned to the exact route across all sessions. */
  readonly active: number
  /** Monotonic most recent assignment; zero before the first assignment. */
  readonly lastAssigned: number
}

/** Choose by task fit, live load, route diversity, then caller pool order.
 * @param candidates - Ready capable routes in pool order.
 * @param assessment - Required and preferred task specialties.
 * @returns The selected route and the first priority that separated candidates.
 */
export function selectReadyRoute(
  candidates: readonly ReadyRoute[],
  assessment: SubagentTaskAssessment,
): { route: CapabilityRoute; reason: OrchestrationRouteDecision['reason'] } | undefined {
  const score = (entry: ReadyRoute): number =>
    (assessment.preferredCapabilities ?? []).filter(item => entry.route.capabilities.includes(item)).length
  const sorted = [...candidates].sort((a, b) =>
    (score(b) - score(a)) || (a.active - b.active) || (a.lastAssigned - b.lastAssigned))
  const first = sorted[0]
  if (first === undefined) return undefined
  const second = sorted[1]
  const reason = second === undefined ? 'pool-order'
    : score(first) !== score(second) ? 'task-fit'
      : first.active !== second.active ? 'active-load'
        : first.lastAssigned !== second.lastAssigned ? 'diversity'
          : 'pool-order'
  return { route: first.route, reason }
}
