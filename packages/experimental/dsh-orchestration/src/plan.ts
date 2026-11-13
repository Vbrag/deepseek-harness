/**
 * Capability-aware scheduling for orchestration: picks the best provider model
 * for each step's required domains, modalities, and context budget and, on
 * failover, the most-similar remaining model — excluding routes that are
 * unmounted, rate-limited/insufficient-funds, or outside a step's modality or
 * context requirements. Pure and deterministic so it can be unit-tested
 * directly.
 *
 * @module @deepseek-ai/dsh-orchestration/plan
 */

import { bestCapabilityMatch, capabilityOf, capabilitySimilarity, domainScore, underRateBudget } from './capabilities.ts'
import type { ModelCapability } from './capabilities.ts'
import type { PlannedStep, PoolRoute } from './types.ts'

/** A pool route with its resolved catalog capability facts. */
export interface CapabilityRoute extends PoolRoute {
  readonly capability: ModelCapability
}

/** Per-run per-model attempt counts, used by the budget-aware scheduler. */
export interface RouteBudget {
  [model: string]: { attempts: number }
}

/** The step requirements the scheduler routes on; the coordinator may omit modality/context. */
export type StepRequirements = Pick<PlannedStep, 'requiredDomains' | 'requiredModalities' | 'contextTokens'>

/** Resolve every pool route to its catalog capabilities; unknown models are dropped. */
export function capabilityRoutes(routes: readonly PoolRoute[]): readonly CapabilityRoute[] {
  const resolved: CapabilityRoute[] = []
  for (const route of routes) {
    const capability = capabilityOf(route.model)
    if (capability !== undefined) resolved.push({ ...route, capability })
  }
  return resolved
}

/** The models already tried for one step, by id. */
type Tried = readonly { readonly model: string }[]

/**
 * Whether one route remains usable for a step: routeable, not named as
 * unavailable (rate-limited/insufficient-funds), inside its modality and
 * context coverage, and under its documented rpm ceiling for this run.
 * @param route - the resolved pool route under test.
 * @param requirements - the step's modality/domain/context needs.
 * @param unavailable - models excluded for this round (rate-limited, etc.).
 * @param budget - per-model attempt counts this run.
 * @returns true when the route may still be chosen.
 */
function routeUsable(
  route: CapabilityRoute,
  requirements: StepRequirements,
  unavailable: readonly string[],
  budget: RouteBudget | undefined,
): boolean {
  if (route.capability.health !== 'routeable') return false
  if (requirements.requiredDomains.some(domain => domainScore(route.capability, domain) === 0)) return false
  if (unavailable.includes(route.model)) return false
  if (requirements.requiredModalities !== undefined
    && !requirements.requiredModalities.every(m => route.capability.modalities.includes(m))) return false
  if (requirements.contextTokens !== undefined && route.capability.contextWindow < requirements.contextTokens) return false
  const used = budget?.[route.model]?.attempts ?? 0
  if (!underRateBudget(route.capability, used, 0, 0)) return false
  return true
}

/**
 * Select the next route for a step, preferring the model whose capabilities
 * best match the step's required domains and requirements, excluding routes
 * already tried, unavailable, or unusable. Returns `undefined` when none remains.
 * @param routes - the resolved pool.
 * @param step - the step being scheduled.
 * @param tried - routes already attempted for this step.
 * @param options - run-local budget and unavailable (rate-limited) routes.
 * @returns the chosen route, or `undefined` when the pool is exhausted.
 */
export function selectRoute(
  routes: readonly CapabilityRoute[],
  step: StepRequirements,
  tried: Tried,
  options: { readonly unavailable?: readonly string[]; readonly budget?: RouteBudget } = {},
): CapabilityRoute | undefined {
  const triedIds = new Set(tried.map(t => t.model))
  const unavailable = options.unavailable ?? []
  const budget = options.budget
  const candidates = routes
    .filter(r => !triedIds.has(r.model) && routeUsable(r, step, unavailable, budget))
    .map(r => r.capability)
  const match = bestCapabilityMatch(
    candidates,
    [...triedIds],
    step.requiredDomains,
    {
      ...(step.requiredModalities === undefined ? {} : { requiredModalities: step.requiredModalities }),
      ...(step.contextTokens === undefined ? {} : { contextTokens: step.contextTokens }),
    },
  )
  if (match === undefined) return undefined
  return routes.find(r => r.model === match.id)
}

/**
 * Choose the failover route after one model failed. The replacement must keep
 * the step able to make progress: the untried route best serving the step's
 * required domains wins, with capability similarity to the failed model as the
 * tiebreaker (so a like-for-like swap is still preferred among equally capable
 * routes). Routes that are unusable (unmounted, rate-limited/insufficient-funds,
 * outside modality/context coverage) are excluded. Returns `undefined` when no
 * remaining route is usable.
 * @param routes - the resolved pool.
 * @param failedModel - the model that just failed.
 * @param step - the step being retried.
 * @param tried - routes already attempted for this step, including the failed one.
 * @param options - run-local budget and unavailable (rate-limited) routes.
 * @returns the chosen failover route, or `undefined` when exhausted.
 */
export function selectFailover(
  routes: readonly CapabilityRoute[],
  failedModel: string,
  step: StepRequirements,
  tried: Tried,
  options: { readonly unavailable?: readonly string[]; readonly budget?: RouteBudget } = {},
): CapabilityRoute | undefined {
  const failedCapability = capabilityOf(failedModel)
  const triedIds = new Set(tried.map(t => t.model))
  const unavailable = options.unavailable ?? []
  const budget = options.budget
  const untried = routes.filter(r => !triedIds.has(r.model) && routeUsable(r, step, unavailable, budget))
  if (untried.length === 0) return undefined
  const scored = untried.map(route => ({
    route,
    domain: step.requiredDomains.reduce((sum, domain) => sum + domainScore(route.capability, domain), 0),
    similarity: failedCapability === undefined ? 0 : capabilitySimilarity(failedCapability, route.capability),
  }))
  scored.sort((a, b) => (b.domain - a.domain) || (b.similarity - a.similarity))
  const best = scored[0]
  if (best === undefined || (best.domain === 0 && best.similarity === 0)) return undefined
  return best.route
}

/**
 * Finite-attempt budget: a step may retry across eligible routes at most
 * `maxAttempts` times.
 * @param attemptIndex - zero-based current attempt.
 * @param maxAttempts - positive budget.
 * @returns whether this attempt index may run.
 */
export function withinBudget(attemptIndex: number, maxAttempts: number): boolean {
  return attemptIndex >= 0 && attemptIndex < maxAttempts && Number.isSafeInteger(maxAttempts) && maxAttempts > 0
}
