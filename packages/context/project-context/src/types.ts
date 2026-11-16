/** Portable project-document maintenance state and model-tool inputs. */

import type { FsVersion } from '@deepseek-ai/dsh-fs/types'
import type { SessionSeq } from '@deepseek-ai/dsh-session/types'

/** State of one root turn's project-document assessment. */
export type ProjectContextStatus = 'pending' | 'updating' | 'updated' | 'unchanged' | 'deferred' | 'failed'

/** Latest project-document assessment, independent of task or goal completion. */
export interface ProjectContextView {
  readonly sourceTurn: number
  /** Last normal-work record assessed; maintenance activity does not advance it. */
  readonly knowledgeWatermark: SessionSeq
  readonly status: ProjectContextStatus
  readonly root?: string | undefined
  readonly contextPath?: string | undefined
  readonly summary?: string | undefined
  readonly reason?: string | undefined
}

/** Exact file content and freshness token admitted to one maintenance phase. */
export interface ProjectContextDocument {
  readonly path: string
  readonly version: FsVersion | null
  readonly content: string
}

/** Durable original document retained before a guarded edit or forwarding replacement. */
export interface ProjectContextDocumentObserved {
  readonly sourceTurn: number
  readonly root: string
  readonly document: ProjectContextDocument
}

/** One exact replacement in an observed primary project guide. */
export interface ProjectContextGuideUpdate {
  readonly path: string
  readonly oldText: string
  readonly newText: string
}

/** An observed duplicate guide whose complete original content may become a forwarding stub. */
export interface ProjectContextForwardingStub {
  readonly path: string
  readonly oldText: string
}

/** Validated model assessment and requested project-document changes. */
export interface ProjectContextUpdateRequest {
  readonly outcome: 'updated' | 'unchanged' | 'deferred'
  readonly summary: string
  readonly context?: string | undefined
  readonly guideUpdates?: ProjectContextGuideUpdate[] | undefined
  readonly forwardingStubs?: ProjectContextForwardingStub[] | undefined
}

/** Actual outcome and changed files returned by the guarded writer. */
export interface ProjectContextUpdateResult {
  readonly outcome: 'updated' | 'unchanged' | 'deferred'
  readonly summary: string
  readonly contextPath: string
  readonly changedPaths: string[]
}

/** Attribution for logged assessment requests and correction reminders. */
export interface ProjectContextMessageSource {
  readonly kind: 'project-context'
  readonly sourceTurn: number
}

/** Bounded replay state; inherited history never transfers maintenance authority. */
export interface ProjectContextState {
  readonly view: ProjectContextView | null
  readonly root: boolean
  readonly inheritedEventCount: number
}

/** Deployment limit for each persisted maintenance label and diagnostic. */
export interface ProjectContextProjectionConfig {
  readonly maxTextChars: number
  readonly maxSourceBytes: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Whole-value assessment status for one root turn. */
    'project-context/status': ProjectContextView
    /** Complete original file and version observed before project-document edits. */
    'project-context/document-observed': ProjectContextDocumentObserved
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Latest project-document assessment, separate from task execution status. */
    projectContext: ProjectContextView | null
  }
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'project-context': ProjectContextMessageSource
  }
}
