/** Durable phase requests and bounded recovery facts for one local child. */
import { z } from 'zod'
import type { SubagentTaskAssessment } from '@deepseek-ai/dsh-subagent'
import { pluginRecordOf, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { OrchestrationRoutingState, OrchestrationPhaseRequest } from './types.ts'
import { OrchestrationError } from './error.ts'

const route = z.object({ provider: z.string().min(1), model: z.string().min(1) }).strict()
const assessment: z.ZodType<SubagentTaskAssessment> = z.object({
  requiredCapabilities: z.array(z.string().min(1)),
  preferredCapabilities: z.array(z.string().min(1)).optional(),
  requiredModalities: z.array(z.string().min(1)).optional(),
  contextTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().positive().optional(),
}).strict().transform((value): SubagentTaskAssessment => ({
  requiredCapabilities: value.requiredCapabilities, contextTokens: value.contextTokens,
  ...value.preferredCapabilities === undefined ? {} : { preferredCapabilities: value.preferredCapabilities },
  ...value.requiredModalities === undefined ? {} : { requiredModalities: value.requiredModalities },
  ...value.outputTokens === undefined ? {} : { outputTokens: value.outputTokens },
}))
const request: z.ZodType<OrchestrationPhaseRequest> = z.object({
  revision: z.number().int().nonnegative(),
  assessment, reason: z.string().min(1), checkpoint: z.string().min(1),
  preferredRoute: route.optional(), maxTokens: z.number().int().positive().optional(),
}).strict().transform((value): OrchestrationPhaseRequest => ({
  revision: value.revision, assessment: value.assessment, reason: value.reason, checkpoint: value.checkpoint,
  ...value.preferredRoute === undefined ? {} : { preferredRoute: value.preferredRoute },
  ...value.maxTokens === undefined ? {} : { maxTokens: value.maxTokens },
}))
const routingSchema: z.ZodType<OrchestrationRoutingState> = z.object({
  revision: z.number().int().nonnegative(), assessment: assessment.nullable(), request: request.nullable(),
  route: route.nullable(), previous: route.nullable(),
  status: z.enum(['idle', 'queued', 'changing', 'waiting', 'blocked']),
  reason: z.string(), checkpoint: z.string(), maxTokens: z.number().int().positive().nullable(),
  automaticChanges: z.number().int().nonnegative(), tried: z.array(route),
  emptyLimits: z.number().int().nonnegative(),
  observedInputTokens: z.number().int().nonnegative(),
}).strict()

/** Host checkpoint keeps inherited phase facts outside the child's own policy. */
export interface AdaptiveProjectionState {
  readonly inheritedEventCount: SessionLogOffset
  readonly value: OrchestrationRoutingState
}

const stateSchema: z.ZodType<AdaptiveProjectionState> = z.object({
  inheritedEventCount: z.number().int().nonnegative().transform(SessionLogOffset), value: routingSchema,
}).strict()

/** Fixed-size phase state; replay does not admit requests or switch a model. */
export const adaptiveRoutingProjection = {
  key: 'orchestrationRouting', stateVersion: 2, stateSchema,
  init: (_header, inheritedEventCount): AdaptiveProjectionState => ({ inheritedEventCount, value: {
    revision: 0, assessment: null, request: null, route: null, previous: null,
    status: 'idle', reason: '', checkpoint: '', maxTokens: null,
    automaticChanges: 0, tried: [], emptyLimits: 0, observedInputTokens: 0,
  } }),
  apply: (state, event) => {
    if (event.seq < state.inheritedEventCount) return state
    const value = state.value
    const progress = (event.type === 'tool/result' && event.data.message.isError !== true)
      || (event.type === 'assistant/message' && event.data.interrupted !== true
        && event.data.message.content.some(block => block.type === 'text' && block.text.trim() !== ''))
    if (progress && (value.automaticChanges > 0 || value.emptyLimits > 0 || value.tried.length > 0)) {
      return { ...state, value: { ...value, automaticChanges: 0, emptyLimits: 0, tried: [] } }
    }
    if (event.type === 'compaction/summary' && value.observedInputTokens !== 0) {
      return { ...state, value: { ...value, observedInputTokens: 0 } }
    }
    const record = pluginRecordOf(event)
    if (record?.type !== 'plugin:orchestration/routing-state') return state
    const next = routingSchema.parse(record.data)
    if (next.revision <= value.revision) throw new OrchestrationError('orchestration routing revision must increase', 'ORCHESTRATION_INVALID_RECORD')
    return { ...state, value: next }
  },
  wire: { viewSchema: routingSchema, view: state => state.value },
} satisfies ProjectionDefinition<'orchestrationRouting', AdaptiveProjectionState>
