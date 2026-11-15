/** Structured failures owned by orchestration mode and task routing. */
import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Conditions callers can handle without parsing human-readable diagnostics. */
export type OrchestrationErrorCode =
  | 'ORCHESTRATION_INVALID_CONFIG'
  | 'ORCHESTRATION_NOT_READY'
  | 'ORCHESTRATION_INVALID_RECORD'
  | 'ORCHESTRATION_ASSESSMENT_REQUIRED'
  | 'ORCHESTRATION_INVALID_ASSESSMENT'
  | 'ORCHESTRATION_NO_CAPABLE_ROUTE'
  | 'ORCHESTRATION_ROUTE_METADATA_FAILED'

/** Expected orchestration configuration, recovery, or routing failure. */
export class OrchestrationError extends HarnessError {
  override readonly code: OrchestrationErrorCode

  /** @param message - Affected operation and correction.
   * @param code - Stable failure condition.
   * @param options - Original dependency failure when applicable.
   */
  constructor(message: string, code: OrchestrationErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
  }
}
