/** Recoverable, submission-keyed enhancement outcomes. */
import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type {} from './types.ts'

const entrySchema = z.object({
  original: z.string(),
  displayOriginal: z.string(),
  requestKey: z.string(),
  status: z.enum(['pending', 'enhanced', 'failed', 'cancelled']),
  enhanced: z.string().optional(),
  code: z.string().optional(),
  submitted: z.boolean().optional(),
  submittedText: z.string().optional(),
})
const entriesSchema = z.record(z.string(), entrySchema)
const stateSchema = z.object({ entries: entriesSchema, visible: entriesSchema })
/** Recoverable state needed to suppress duplicate auxiliary calls. */
export type PromptEnhancementState = z.infer<typeof stateSchema>

/** The log, rather than an active request, owns whether an id was dispatched. */
export const promptEnhancementProjection = {
  key: 'promptEnhancement',
  stateVersion: 1,
  stateSchema,
  init: (): PromptEnhancementState => ({ entries: {}, visible: {} }),
  apply: (state, event) => {
    if (event.type === 'prompt-enhancement/request') {
      return { ...state, entries: { ...state.entries, [event.data.id]: {
        original: event.data.original, displayOriginal: event.data.displayOriginal,
        requestKey: event.data.requestKey, status: 'pending' } } }
    }
    if (event.type === 'prompt-enhancement/result') {
      const { id, original, displayOriginal, requestKey, status, enhanced, code } = event.data
      return { ...state, entries: { ...state.entries, [id]: { original, displayOriginal, requestKey, status,
        ...enhanced === undefined ? {} : { enhanced }, ...code === undefined ? {} : { code } } } }
    }
    if (event.type === 'prompt-enhancement/accepted') {
      const previous = state.entries[event.data.id]
      if (previous === undefined || previous.submitted === true) return state
      const accepted = { ...previous, submitted: true, submittedText: event.data.text }
      return { entries: { ...state.entries, [event.data.id]: accepted },
        visible: { ...state.visible, [event.data.id]: accepted } }
    }
    return state
  },
  wire: { viewSchema: entriesSchema, view: state => state.visible, summary: false },
} satisfies ProjectionDefinition<'promptEnhancement', PromptEnhancementState>
