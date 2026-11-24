/** Durable facts and request types for prompt enhancement. */
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { LlmEgressId, Message, ReasoningEffortId, TokenUsage } from '@deepseek-ai/dsh-llm/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionProjectionSummaryExcluded } from '@deepseek-ai/dsh-session-projection/types'

/** Identity shared by one enhancement and the associated Session submission. */
export type PromptEnhancementId = SessionRequestId

/** Exact auxiliary request recorded before dispatch. */
export interface PromptEnhancementRequestEvent {
  readonly id: PromptEnhancementId
  readonly requestKey: string
  readonly original: string
  readonly displayOriginal: string
  readonly provider: string
  readonly model: string
  readonly egressId?: LlmEgressId
  readonly purpose: 'prompt-enhancement'
  readonly system: string
  readonly messages: readonly Message[]
  readonly maxTokens: number
  readonly reasoningEffort?: ReasoningEffortId
  readonly temperature?: number
  readonly stop?: readonly string[]
}

/** Settlement of an enhancement attempt; failures contain a stable code, never raw provider text. */
export interface PromptEnhancementResultEvent {
  readonly id: PromptEnhancementId
  readonly requestKey: string
  readonly original: string
  readonly displayOriginal: string
  readonly status: 'enhanced' | 'failed' | 'cancelled'
  readonly enhanced?: string
  readonly code?: string
  readonly elapsedMs: number
  readonly usage?: TokenUsage
}

/** Recoverable attempt and the actual accepted submission, when available. */
export interface PromptEnhancementEntry {
  readonly original: string
  readonly displayOriginal: string
  readonly requestKey: string
  readonly status: 'pending' | 'enhanced' | 'failed' | 'cancelled'
  readonly enhanced?: string | undefined
  readonly code?: string | undefined
  readonly submitted?: boolean | undefined
  readonly submittedText?: string | undefined
}

/** Submission-keyed comparison data for an open Session. */
export type PromptEnhancementProjection = Readonly<Record<string, PromptEnhancementEntry>>

/** The final text selected by the user for one enhanced submission. */
export interface PromptEnhancementAcceptedEvent {
  readonly id: PromptEnhancementId
  readonly text: string
}

/** One auxiliary enhancement request; attachment values are names or references, never contents. */
export interface PromptEnhancementRequest {
  readonly sessionId: SessionId
  readonly id: PromptEnhancementId
  readonly original: string
  readonly displayOriginal: string
  readonly attachments: readonly string[]
  readonly provider: string
  readonly model: string
  /** Null records that the selected adapter did not expose an endpoint identity. */
  readonly expectedEgress: LlmEgressId | null
}

/** User-owned feature preferences and their settings revision. */
export interface PromptEnhancementPreferences {
  readonly enabled: boolean
  readonly mode: 'automatic' | 'review'
  /** Largest prompt eligible for enhancement, in Unicode word-like segments. */
  readonly maxPromptWords: number
  /** Largest prompt eligible for enhancement, in Unicode code points. */
  readonly maxPromptCharacters: number
  /** Empty provider and model select the Session model. */
  readonly provider: string
  readonly model: string
  readonly revision: number | null
}

/** Editable feature preferences. */
export type PromptEnhancementPreferenceUpdate = Omit<PromptEnhancementPreferences, 'revision'>

/** Registered model routes available for a dedicated enhancer. */
export type PromptEnhancementCatalog = readonly {
  readonly provider: string
  readonly name: string
  readonly models: readonly { readonly id: string; readonly name: string }[]
}[]

/** Result of saving preferences against a previously read revision. */
export type PromptEnhancementSaveResult =
  | { readonly status: 'saved'; readonly preferences: PromptEnhancementPreferences }
  | { readonly status: 'stale' | 'failed' }

/** Session and submission identity supplied to a preflight or consent request. */
export interface PromptEnhancementPreflightRequest {
  readonly sessionId: SessionId
  readonly id: PromptEnhancementId
  readonly original: string
  readonly displayOriginal: string
}

/** The exact provider route the user agreed to use. */
export interface PromptEnhancementConsentRequest extends PromptEnhancementPreflightRequest {
  readonly provider: string
  readonly model: string
  readonly egressId?: LlmEgressId
}

/** Route and consent state captured before an enhancement attempt. */
export type PromptEnhancementPreflight =
  | { readonly status: 'disabled' }
  | { readonly status: 'skipped'; readonly reason: 'length' }
  | {
    readonly status: 'ready' | 'consent-required'
    readonly provider: string
    readonly model: string
    readonly mode: 'automatic' | 'review'
    readonly egressId?: LlmEgressId
    readonly egressLabel?: string
  }
  | { readonly status: 'failed'; readonly code: string }

/** Input accepted by the session-authorized enhancement Remote. */
export interface PromptEnhancementRemoteRequest extends PromptEnhancementPreflightRequest {
  readonly attachments: readonly string[]
  readonly provider: string
  readonly model: string
  readonly expectedEgress: LlmEgressId | null
  readonly mode: 'automatic' | 'review'
}

/** Result of preparing one user submission. */
export type PromptEnhancementResult =
  | { readonly status: 'enhanced'; readonly text: string }
  | { readonly status: 'skipped'; readonly reason: 'length' }
  | { readonly status: 'failed'; readonly code: string }
  | { readonly status: 'cancelled' }
  | { readonly status: 'interrupted' }

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Exact log-only auxiliary request, recorded before dispatch.
     * @param data - Request identity and provider inputs.
     */
    'prompt-enhancement/request': PromptEnhancementRequestEvent
    /** Log-only auxiliary request settlement.
     * @param data - Result status, duration, and optional usage.
     */
    'prompt-enhancement/result': PromptEnhancementResultEvent
    /** Final user-selected prompt following enhancement.
     * @param data - Submission identity and selected text.
     */
    'prompt-enhancement/accepted': PromptEnhancementAcceptedEvent
  }
}

declare module '@deepseek-ai/dsh-llm/types' {
  interface LlmRequestPurposeMap {
    /** One user-requested enhancement before main-Agent submission. */
    'prompt-enhancement': true
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Enhancement outcomes are available to an open Session but not its list summary. */
    promptEnhancement: SessionProjectionSummaryExcluded<PromptEnhancementProjection>
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Prompt enhancement settings and calls are restricted to the owner. */
    'prompt-enhancement/owner-required': Record<string, never>
  }
}
