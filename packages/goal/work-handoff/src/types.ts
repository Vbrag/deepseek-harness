/** Portable work checkpoints, handoff views, and bounded host recovery facts. */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { GoalId } from '@deepseek-ai/dsh-goal/types'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo/types'
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment/types'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/types'

/** Identity of one immutable unfinished-work capture. */
export type WorkHandoffId = Branded<'WorkHandoffId'>

/** Why unfinished work needs an explicit continuation decision. */
export type WorkStopReason =
  | 'todo-limit' | 'goal-budget' | 'output-limit' | 'error' | 'cancelled'
  | 'paused' | 'waiting' | 'legacy-confirmation'

/** Model-authored progress facts; validation evidence remains separate from completion claims. */
export interface WorkCheckpoint {
  readonly summary: string
  readonly completed: string[]
  readonly remaining: { task: string; nextActions: string[]; references: string[] }[]
  readonly validation: { command: string; result: 'passed' | 'failed' | 'unknown'; evidence: string[] }[]
  readonly blockers: string[]
}

/** Exact goal revision and allowance captured with a handoff. */
export interface WorkHandoffGoal {
  readonly id: GoalId
  readonly revision: number
  readonly objective: string
  readonly roundsStarted: number
  readonly maxGoalRounds: number
}

/** Latest captured handoff served directly to clients; saving acknowledges this exact id. */
export interface WorkHandoffView {
  readonly id: WorkHandoffId
  readonly sourceSessionId: SessionId
  readonly turn: number
  readonly reason: WorkStopReason
  readonly status: 'work-remains' | 'waiting' | 'paused' | 'budget-exhausted'
  readonly objective: string
  /** Source event containing the full human objective when its host preview is bounded. */
  readonly objectiveSeq?: SessionSeq | undefined
  readonly markdown: string
  readonly saved: boolean
  readonly goal?: WorkHandoffGoal | undefined
  readonly todos: TodoItem[]
  readonly attachment?: FileAttachmentRef | undefined
  readonly exportError?: string | undefined
}

/** Capture inputs resolved by the owning service; omitted snapshots use its current domain readers. */
export interface WorkCaptureRequest {
  readonly reason: WorkStopReason
  readonly goal?: WorkHandoffGoal
  readonly todos?: TodoItem[]
  readonly signal?: AbortSignal
  /** Consecutive repairs and stronger-guidance threshold; `limit` does not cap task continuation. */
  readonly todoRepairs?: { readonly attempts: number; readonly limit: number }
  /** Recorded host policy explanation for stopping, separate from model-authored blockers. */
  readonly stopDetail?: string
}

/** Bounded recorded tool observation; a null result means no committed result was retained. */
export interface WorkToolEvidence {
  readonly seq: number
  readonly callId: ToolCallId
  readonly name: string
  readonly arguments: string
  readonly result: string | null
  readonly isError: boolean | null
}

/** Policy tags whose latest complete payload may seed a fresh continuation Session. */
export type WorkPolicyTag =
  | 'permission/preset' | 'sandbox/mode' | 'approval/policy'
  | 'subagent/model-selection-policy' | 'plan/mode'

/** Whole policy payload; target policy owners validate it before admitting work. */
export interface WorkPolicySeed {
  readonly type: WorkPolicyTag
  readonly data: JsonValue
  readonly ignorable?: true | undefined
}

/** Fixed-size host recovery facts; only `latest` is a client projection value. */
export interface WorkHandoffState {
  readonly sourceSessionId: SessionId
  readonly latest: WorkHandoffView | null
  readonly checkpoint: WorkCheckpoint | null
  readonly humanObjective: string
  readonly objectiveSeq?: SessionSeq | undefined
  readonly turn: number
  readonly evidence: WorkToolEvidence[]
  readonly pendingJobs: string[]
  readonly pendingSubagents: string[]
  readonly policySeeds: WorkPolicySeed[]
  readonly policyFailure: string | null
}

/** Deployment bounds applied to replay state and model-authored checkpoints. */
export interface WorkHandoffProjectionConfig {
  /** Maximum retained tool observations and entries in each checkpoint list. */
  readonly maxEvidence: number
  /** Maximum serialized checkpoint characters and characters in each retained evidence preview. */
  readonly maxTextChars: number
  /** Maximum retained pending-job and pending-subagent observations. */
  readonly maxPending: number
  /** Maximum characters in each complete retained policy payload; larger policies refuse carryover. */
  readonly maxPolicyChars: number
}

/** Workspace facts gathered by the capture service, never by the replay projection. */
export interface WorkWorkspaceFacts {
  readonly cwd?: string
  readonly branch?: string | null
  readonly commit?: string | null
  readonly changes?: readonly string[]
  readonly error?: string
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Latest captured unfinished-work handoff, absent before capture and after clear. */
    workHandoff: WorkHandoffView | null
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Model-authored progress checkpoint. */
    'work-handoff/checkpoint': { checkpoint: WorkCheckpoint }
    /** Complete unfinished-work capture. */
    'work-handoff/captured': { handoff: WorkHandoffView }
    /** Acknowledgement of one exact captured handoff. */
    'work-handoff/saved': { id: WorkHandoffId }
    /** Removal of the current handoff. */
    'work-handoff/cleared': Record<string, never>
    /** Explicit continuation into a fresh Session with the captured objective. */
    'work-handoff/imported': { sourceSessionId: SessionId; handoffId: WorkHandoffId; objective: string }
  }
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Human-requested fresh-session continuation, distinct from a new human objective. */
    'work-handoff': { kind: 'work-handoff'; sourceSessionId: SessionId; handoffId: WorkHandoffId }
  }
}
