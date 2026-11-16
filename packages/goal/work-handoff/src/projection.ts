/** Bounded replay state for unfinished-work captures and continuation evidence. */

import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { GoalId } from '@deepseek-ai/dsh-goal/types'
import type { AttachmentId } from '@deepseek-ai/dsh-attachment/types'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/types'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-jobs/types'
import type {} from '@deepseek-ai/dsh-subagent'
import type {
  WorkCheckpoint, WorkHandoffId, WorkHandoffProjectionConfig, WorkHandoffState, WorkHandoffView, WorkPolicySeed,
} from './types.ts'

/** Handoff definition always carries its direct latest-value client view. */
export interface WorkHandoffProjection extends ProjectionDefinition<'workHandoff', WorkHandoffState> {
  wire: NonNullable<ProjectionDefinition<'workHandoff', WorkHandoffState>['wire']>
}

/**
 * Build the bounded checkpoint decoder used for model input and durable replay.
 * @param config - deployment text and item limits.
 * @returns a strict decoder that rejects oversized checkpoints without truncating model input.
 */
export function createWorkCheckpointSchema(config: WorkHandoffProjectionConfig): z.ZodType<WorkCheckpoint> {
  const text = z.string().max(config.maxTextChars)
  const texts = z.array(text).max(config.maxEvidence)
  return z.object({
    summary: text,
    completed: texts,
    remaining: z.array(z.object({ task: text, nextActions: texts, references: texts }).strict()).max(config.maxEvidence),
    validation: z.array(z.object({
      command: text, result: z.enum(['passed', 'failed', 'unknown']), evidence: texts,
    }).strict()).max(config.maxEvidence),
    blockers: texts,
  }).strict().refine(value => JSON.stringify(value).length <= config.maxTextChars, {
    message: 'checkpoint exceeds the configured total character limit',
  })
}

/**
 * Create one stateless projection definition; the registry owns each Session's fold state.
 * @param config - positive deployment bounds for evidence, previews, pending work, and policy payloads.
 * @returns a strict version-one projection whose client view is the latest handoff or null.
 */
export function createWorkHandoffProjection(
  config: WorkHandoffProjectionConfig,
): WorkHandoffProjection {
  for (const [field, value] of Object.entries(config)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`work handoff ${field} must be a positive safe integer`)
  }
  const preview = (value: string): string => value.length <= config.maxTextChars
    ? value : value.slice(0, Math.max(0, config.maxTextChars - 1)) + '…'
  const text = z.string().max(config.maxTextChars)
  const boundedText = z.array(text).max(config.maxPending)
  const checkpointSchema = createWorkCheckpointSchema(config)
  const viewSchema: z.ZodType<WorkHandoffView> = z.object({
    id: z.string().min(1).transform(value => brandString<WorkHandoffId>(value)),
    sourceSessionId: z.string().min(1).transform(value => brandString<SessionId>(value)),
    turn: z.number().int().nonnegative(),
    reason: z.enum(['todo-limit', 'goal-budget', 'output-limit', 'error', 'cancelled', 'paused', 'waiting', 'legacy-confirmation']),
    status: z.enum(['work-remains', 'waiting', 'paused', 'budget-exhausted']),
    objective: z.string(),
    objectiveSeq: z.number().int().nonnegative().transform(SessionSeq).optional(),
    markdown: z.string(),
    saved: z.boolean(),
    goal: z.object({
      id: z.string().min(1).transform(value => brandString<GoalId>(value)),
      revision: z.number().int().positive(), objective: z.string(),
      roundsStarted: z.number().int().nonnegative(), maxGoalRounds: z.number().int().positive(),
    }).strict().optional(),
    todos: z.array(z.object({ content: z.string(), status: z.enum(['pending', 'in_progress', 'completed']) }).strict()),
    attachment: z.object({
      attachmentId: z.string().min(1).transform(value => brandString<AttachmentId>(value)),
      name: z.string(), bytes: z.number().int().nonnegative(),
    }).strict().optional(),
    exportError: z.string().optional(),
  }).strict()
  const policyTypeSchema = z.enum([
    'permission/preset', 'sandbox/mode', 'approval/policy', 'subagent/model-selection-policy', 'plan/mode',
  ])
  const seedSchema: z.ZodType<WorkPolicySeed> = z.object({
    type: policyTypeSchema,
    data: z.json(), ignorable: z.literal(true).optional(),
  }).strict()
  const stateSchema: z.ZodType<WorkHandoffState> = z.object({
    sourceSessionId: z.string().min(1).transform(value => brandString<SessionId>(value)),
    latest: viewSchema.nullable(), checkpoint: checkpointSchema.nullable(), humanObjective: text,
    objectiveSeq: z.number().int().nonnegative().transform(SessionSeq).optional(),
    turn: z.number().int().nonnegative(),
    evidence: z.array(z.object({
      seq: z.number().int().nonnegative(),
      callId: z.string().min(1).transform(value => brandString<ToolCallId>(value)),
      name: text, arguments: text, result: text.nullable(), isError: z.boolean().nullable(),
    }).strict()).max(config.maxEvidence),
    pendingJobs: boundedText, pendingSubagents: boundedText,
    policySeeds: z.array(seedSchema).max(5).refine(seeds =>
      new Set(seeds.map(seed => seed.type)).size === seeds.length
      && seeds.every(seed => JSON.stringify(seed.data).length <= config.maxPolicyChars)),
    policyFailure: text.nullable(),
  }).strict()

  const apply = (state: WorkHandoffState, event: SessionEvent): WorkHandoffState => {
    const policyType = policyTypeSchema.safeParse(event.type)
    if (policyType.success) {
      // The delegation policy owner makes the first recorded allowance immutable.
      if (policyType.data === 'subagent/model-selection-policy'
        && state.policySeeds.some(seed => seed.type === policyType.data)) return state
      const seed = seedSchema.parse({ type: policyType.data, data: event.data,
        ...event.ignorable === true ? { ignorable: true } : {} })
      const other = state.policySeeds.filter(item => item.type !== seed.type)
      if (JSON.stringify(seed.data).length > config.maxPolicyChars) {
        return { ...state, policySeeds: other,
          policyFailure: preview(`Policy ${seed.type} exceeded the continuation limit; policy carryover is unavailable.`) }
      }
      return { ...state, policySeeds: [...other, seed] }
    }
    switch (event.type) {
      case 'work-handoff/checkpoint':
        return { ...state, checkpoint: z.object({ checkpoint: checkpointSchema }).strict().parse(event.data).checkpoint }
      case 'work-handoff/captured': {
        const handoff = z.object({ handoff: viewSchema }).strict().parse(event.data).handoff
        // A fork retains its parent's evidence, but does not own the parent's handoff card.
        return handoff.sourceSessionId === state.sourceSessionId ? { ...state, latest: handoff } : state
      }
      case 'work-handoff/saved': {
        const { id } = z.object({ id: z.string().min(1) }).strict().parse(event.data)
        return state.latest?.id === id ? { ...state, latest: { ...state.latest, saved: true } } : state
      }
      case 'work-handoff/cleared':
        z.object({}).strict().parse(event.data)
        return state.latest === null ? state : { ...state, latest: null }
      case 'work-handoff/imported': {
        const imported = z.object({ sourceSessionId: z.string().min(1), handoffId: z.string().min(1), objective: z.string() })
          .strict().parse(event.data)
        return { ...state, humanObjective: preview(imported.objective), objectiveSeq: event.seq }
      }
      case 'turn/start':
        return event.data.turn > state.turn
          ? { ...state, turn: event.data.turn, checkpoint: null, latest: null } : state
      case 'user/message': {
        if (event.data.source.kind === 'subagent-settled') {
          const sender = preview(event.data.source.senderSessionId)
          const pending = state.pendingSubagents.filter(value => value !== sender)
          return pending.length === state.pendingSubagents.length ? state : { ...state, pendingSubagents: pending }
        }
        if (event.data.source.kind !== 'user') return state
        const objective = preview(event.data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n'))
        return objective.length === 0 ? state : { ...state, humanObjective: objective, objectiveSeq: event.seq }
      }
      case 'tool/call':
        return { ...state, evidence: [...state.evidence, {
          seq: event.seq, callId: event.data.callId, name: preview(event.data.name),
          arguments: preview(event.data.arguments), result: null, isError: null,
        }].slice(-config.maxEvidence) }
      case 'tool/result': {
        const index = state.evidence.findIndex(item => item.callId === event.data.message.toolCallId)
        if (index < 0) return state
        const result = preview(event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n'))
        return { ...state, evidence: state.evidence.map((item, at) => at === index
          ? { ...item, result, isError: event.data.message.isError === true } : item) }
      }
      case 'job/registered':
        return { ...state, pendingJobs: [...state.pendingJobs.filter(id => id !== preview(event.data.jobId)),
          preview(event.data.jobId)].slice(-config.maxPending) }
      case 'job/settled': {
        const pendingJobs = state.pendingJobs.filter(id => id !== preview(event.data.jobId))
        return pendingJobs.length === state.pendingJobs.length ? state : { ...state, pendingJobs }
      }
      case 'subagent/catalog':
        return { ...state, pendingSubagents: [...state.pendingSubagents.filter(id => id !== preview(event.data.childId)),
          preview(event.data.childId)].slice(-config.maxPending) }
      default:
        // SessionEventMap is merge-extensible; other domains do not change handoff facts.
        return state
    }
  }
  return {
    key: 'workHandoff', stateVersion: 1, stateSchema,
    init: header => ({ sourceSessionId: header.id, latest: null, checkpoint: null, humanObjective: '', turn: 0,
      evidence: [], pendingJobs: [], pendingSubagents: [], policySeeds: [], policyFailure: null }),
    apply,
    wire: { viewSchema: viewSchema.nullable(), view: state => state.latest },
  }
}
