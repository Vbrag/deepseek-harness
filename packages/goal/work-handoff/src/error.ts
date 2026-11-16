/** Structured unfinished-work capture and continuation failures. */
import { HarnessError } from '@deepseek-ai/dsh-error'

/** Conditions that require an explicit user or deployment decision. */
export type WorkHandoffErrorCode =
  | 'WORK_HANDOFF_NOT_READY' | 'WORK_HANDOFF_PERSISTENCE_FAILED'
  | 'WORK_HANDOFF_UNAVAILABLE' | 'WORK_HANDOFF_STALE'
  | 'WORK_HANDOFF_POLICY_UNAVAILABLE' | 'WORK_HANDOFF_WORKSPACE_UNAVAILABLE'

/** A failed handoff never implies that its work completed or was saved. */
export class WorkHandoffError extends HarnessError {
  override readonly code: WorkHandoffErrorCode

  /** @param message - Affected work and correction.
   * @param code - Stable failure classification.
   * @param options - Underlying failure, when available.
   */
  constructor(message: string, code: WorkHandoffErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
  }
}
