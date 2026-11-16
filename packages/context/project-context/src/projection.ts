/** Replay-safe project-document phases with maintenance-independent knowledge accounting. */

import { z } from 'zod'
import { FsVersion } from '@deepseek-ai/dsh-fs/types'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type {
  ProjectContextDocumentObserved, ProjectContextProjectionConfig, ProjectContextState, ProjectContextView,
} from './types.ts'

/** Project-document definition always publishes its latest complete assessment. */
export interface ProjectContextProjection extends ProjectionDefinition<'projectContext', ProjectContextState> {
  wire: NonNullable<ProjectionDefinition<'projectContext', ProjectContextState>['wire']>
}

/**
 * Create the bounded project-document assessment projection.
 * @param config - deployment limits for status text and complete original documents.
 * @returns the version-one root-turn projection and direct client view.
 */
export function createProjectContextProjection(config: ProjectContextProjectionConfig): ProjectContextProjection {
  for (const field of ['maxTextChars', 'maxSourceBytes'] as const) {
    const value = config[field]
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`project context ${field} must be a positive safe integer`)
  }
  const text = z.string().max(config.maxTextChars)
  const viewSchema: z.ZodType<ProjectContextView> = z.object({
    sourceTurn: z.number().int().positive(),
    knowledgeWatermark: z.number().int().nonnegative().transform(SessionSeq),
    status: z.enum(['pending', 'updating', 'updated', 'unchanged', 'deferred', 'failed']),
    root: text.optional(), contextPath: text.optional(), summary: text.optional(), reason: text.optional(),
  }).strict()
  const observedSchema: z.ZodType<ProjectContextDocumentObserved> = z.object({
    sourceTurn: z.number().int().positive(), root: text,
    document: z.object({
      path: text, version: z.string().transform(FsVersion).nullable(),
      content: z.string().refine(value => Buffer.byteLength(value, 'utf8') <= config.maxSourceBytes,
        'project document exceeds maxSourceBytes'),
    }).strict(),
  }).strict()
  return {
    key: 'projectContext', stateVersion: 1,
    stateSchema: z.object({ view: viewSchema.nullable(), root: z.boolean(),
      inheritedEventCount: z.number().int().nonnegative() }).strict(),
    init: (header, inheritedEventCount) => ({ view: null,
      root: (header.delegationDepth ?? 0) === 0 && header.origin !== 'subagent', inheritedEventCount }),
    apply: (state, event) => {
      if (event.seq < state.inheritedEventCount || !state.root) return state
      if (event.type === 'project-context/document-observed') {
        observedSchema.parse(event.data)
        return state
      }
      if (event.type === 'turn/start') {
        if (state.view !== null && event.data.turn <= state.view.sourceTurn) return state
        return { ...state, view: { sourceTurn: event.data.turn, knowledgeWatermark: event.seq, status: 'pending' } }
      }
      if (event.type === 'project-context/status') {
        const view = viewSchema.parse(event.data)
        if (view.knowledgeWatermark > event.seq) throw new Error('Project context refers to future Session knowledge')
        return state.view?.sourceTurn === view.sourceTurn ? { ...state, view } : state
      }
      const view = state.view
      if (view === null) return state
      if (event.type === 'turn/end' && event.data.turn === view.sourceTurn
        && (view.status === 'pending' || view.status === 'updating')) {
        const reason = event.data.reason.kind === 'error' ? event.data.reason.error.message
          : event.data.reason.kind === 'max-tokens' ? 'The model reached its output-token limit.'
            : event.data.reason.kind === 'completed' ? 'The turn ended before project documentation was finalized.'
              : 'Execution was cancelled before project documentation was finalized.'
        return { ...state, view: { ...view, status: event.data.reason.kind === 'error' ? 'failed' : 'deferred',
          reason: reason.slice(0, config.maxTextChars) } }
      }
      if (view.status !== 'pending') return state
      switch (event.type) {
        case 'assistant/message':
        case 'tool/call':
        case 'tool/result':
          return { ...state, view: { ...view, knowledgeWatermark: event.seq } }
        case 'user/message':
          return event.data.source.kind === 'project-context' ? state
            : { ...state, view: { ...view, knowledgeWatermark: event.seq } }
        default:
          // Other merge-extensible events do not supply project-work evidence.
          return state
      }
    },
    wire: { viewSchema: viewSchema.nullable(), view: state => state.view },
  }
}
