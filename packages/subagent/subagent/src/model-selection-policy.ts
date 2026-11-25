/** Durable child-model authorization shared by delegation consumers and routing providers. */

import { z as zod } from 'zod'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ProjectionHandle, ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import type { SubagentModelRoute } from './types.ts'
import { SubagentError } from './error.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** First authorized child-route list; absence permits only the current parent route. */
    'subagent/model-selection-policy': { allowedModels: SubagentModelRoute[] }
    /** User-approved additions to the child routes permitted in this Session. */
    'subagent/model-selection-policy-authorized': { allowedModels: SubagentModelRoute[] }
  }
}

/**
 * Validate configured or restored exact child routes.
 * @param routes - untrusted configuration or durable payload.
 * @returns an assertion that every entry is a unique, non-empty exact route.
 */
export function assertAllowedModelRoutes(routes: unknown): asserts routes is readonly SubagentModelRoute[] {
  if (!Array.isArray(routes)) throw new Error('subagent model selection requires an array of routes')
  const seen = new Set<string>()
  const candidates: readonly unknown[] = routes
  for (const candidate of candidates) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)
      || !('provider' in candidate) || typeof candidate.provider !== 'string'
      || !('model' in candidate) || typeof candidate.model !== 'string'
      || candidate.provider.length === 0 || candidate.model.length === 0) {
      throw new Error('subagent model selection requires non-empty provider and model ids')
    }
    const key = `${candidate.provider}\0${candidate.model}`
    if (seen.has(key)) throw new Error(`subagent model selection repeats route "${candidate.provider}/${candidate.model}"`)
    seen.add(key)
  }
}

const schema = zod.array(zod.object({
  provider: zod.string().min(1), model: zod.string().min(1),
}).strict()).min(1).nullable()

/** Shared host projection; production consumers read through SubagentRuntime. */
export const subagentModelSelectionProjectionDefinition = {
  key: 'subagentModelSelectionPolicy',
  stateVersion: 2,
  stateSchema: schema,
  init: () => null,
  apply: (policy, event) => {
    if (event.type === 'subagent/model-selection-policy-authorized') {
      assertAllowedModelRoutes(event.data.allowedModels)
      if (event.data.allowedModels.length === 0) throw new Error('authorized model routes must not be empty')
      const routes = [...policy ?? []]
      const keys = new Set(routes.map(route => `${route.provider}\0${route.model}`))
      for (const route of event.data.allowedModels) {
        const key = `${route.provider}\0${route.model}`
        if (!keys.has(key)) { routes.push(route); keys.add(key) }
      }
      return routes
    }
    if (policy !== null || event.type !== 'subagent/model-selection-policy') return policy
    const { allowedModels } = event.data
    assertAllowedModelRoutes(allowedModels)
    if (allowedModels.length === 0) throw new Error('subagent/model-selection-policy requires at least one route')
    return allowedModels
  },
} satisfies ProjectionDefinition<'subagentModelSelectionPolicy', SubagentModelRoute[] | null>

/**
 * Read detached child-route authorization.
 * @param handle - registered policy reader.
 * @param session - Session whose recorded policy is read.
 * @returns authorized routes, or undefined to restrict choices to the parent route.
 */
export function subagentModelSelectionPolicy(
  handle: Pick<ProjectionHandle<SubagentModelRoute[] | null>, 'stateOf'>,
  session: Session,
): SubagentModelRoute[] | undefined {
  return handle.stateOf(session)?.map(route => ({ ...route })) ?? undefined
}

/**
 * Enforce the recorded policy against the effective selected model.
 * @param routes - recorded authorization; omission permits only the parent route.
 * @param parent - captured parent route.
 * @param selected - selected child route.
 */
export function assertAllowedModelSelection(
  routes: readonly SubagentModelRoute[] | undefined,
  parent: AgentOptions,
  selected: SubagentModelRoute,
): void {
  const allowed = routes === undefined
    ? selected.provider === parent.provider && selected.model === parent.model
    : routes.some(route => route.provider === selected.provider && route.model === selected.model)
  if (allowed) return
  throw new SubagentError(`child LLM route "${selected.provider}/${selected.model}" is not allowed for this Session`
    + (routes === undefined ? '; without a recorded model-selection policy, selection is limited to the parent route' : ''),
  'MODEL_ROUTE_NOT_ALLOWED')
}
