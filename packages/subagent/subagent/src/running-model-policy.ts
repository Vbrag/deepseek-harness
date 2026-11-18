/** Child-owned immutable running-model grants, separate from descendant delegation permissions. */

import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SubagentModelRoute } from './types.ts'
import { foldSubagentDescriptor } from './descriptor.ts'
import { assertAllowedModelRoutes } from './model-selection-policy.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** First child-owned permission grant for changing this child's own running model. */
    'subagent/running-model-policy': { allowedModels: SubagentModelRoute[] }
  }
}

/** Own-suffix grant and immutable original route used for pre-grant Sessions. */
export interface RunningModelPolicyState {
  readonly allowedModels: readonly SubagentModelRoute[] | null
  readonly originalRoute: SubagentModelRoute | null
  readonly inheritedEventCount: number
}

const routeSchema = z.object({ provider: z.string().min(1), model: z.string().min(1) }).strict()
const stateSchema: z.ZodType<RunningModelPolicyState> = z.object({
  allowedModels: z.array(routeSchema).nullable(), originalRoute: routeSchema.nullable(),
  inheritedEventCount: z.number().int().nonnegative(),
}).strict()

/** Retain only the child's first grant and creation route, ignoring any fork-inherited authority. */
export const runningModelPolicyProjectionDefinition = {
  key: 'subagentRunningModelPolicy', stateVersion: 1,
  stateSchema,
  init: (_header, inheritedEventCount): RunningModelPolicyState => ({ allowedModels: null, originalRoute: null, inheritedEventCount }),
  apply: (state: RunningModelPolicyState, event): RunningModelPolicyState => {
    if (event.seq < state.inheritedEventCount) return state
    if (event.type === 'subagent/running-model-policy') {
      assertAllowedModelRoutes(event.data.allowedModels)
      return state.allowedModels === null ? { ...state, allowedModels: event.data.allowedModels.map(route => ({ ...route })) } : state
    }
    if (state.originalRoute !== null) return state
    if (event.type === 'subagent/descriptor') {
      const descriptor = foldSubagentDescriptor([event])
      if (descriptor?.mode === 'continuable' && descriptor.agentProvider !== undefined && descriptor.agentModel !== undefined) {
        return { ...state, originalRoute: { provider: descriptor.agentProvider, model: descriptor.agentModel } }
      }
    }
    if (event.type === 'request/header') {
      const { provider, model } = event.data.header.config
      return { ...state, originalRoute: { provider, model } }
    }
    return state
  },
} satisfies ProjectionDefinition<'subagentRunningModelPolicy', RunningModelPolicyState>

/** Read a detached grant or the legacy child's original route without scanning Session history.
 * @param state - Projection-owned child suffix facts.
 * @returns Authorized exact routes; empty when no original route or grant is known.
 */
export function runningModelRoutes(state: RunningModelPolicyState): SubagentModelRoute[] {
  return (state.allowedModels ?? (state.originalRoute === null ? [] : [state.originalRoute])).map(route => ({ ...route }))
}

/** Persist the first grant in the child's own log suffix.
 * @param session - Local child Session before model-change admission.
 * @param allowedModels - Exact routes captured from the authorized parent's recorded policy.
 */
export function appendRunningModelPolicy(session: Session, allowedModels: readonly SubagentModelRoute[]): void {
  assertAllowedModelRoutes(allowedModels)
  session.append('subagent/running-model-policy', { allowedModels: allowedModels.map(route => ({ ...route })) })
}
