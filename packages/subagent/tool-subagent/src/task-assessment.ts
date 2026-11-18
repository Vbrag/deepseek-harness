/** Shared model-tool task requirements and safe token-count admission. */

import type { SubagentTaskAssessment } from '@deepseek-ai/dsh-subagent'
import { ToolArgsError } from '@deepseek-ai/dsh-tools'

/** Optional structured task requirements used by ordinary delegation and running-model changes. */
export const TASK_ASSESSMENT_PARAMETER = {
  type: 'object', additionalProperties: false,
  description: 'Assess the task for automatic model routing. Supply every required capability, including both coding and vision for visual code changes. Required when Orchestration mode is on.',
  properties: {
    requiredCapabilities: { type: 'array', items: { type: 'string' }, required: true },
    preferredCapabilities: { type: 'array', items: { type: 'string' } },
    requiredModalities: { type: 'array', items: { type: 'string' },
      description: 'Inputs needed now or later, such as images captured during visual checks.' },
    contextTokens: { type: 'integer', required: true,
      description: 'Expected total input tokens, including files and other context the child will read.' },
    outputTokens: { type: 'integer', description: 'Expected positive response-token count; omit for the configured allowance.' },
  },
} as const

/** Reject invalid token estimates before handing task requirements to the runtime policy.
 * @param assessment - Schema-validated requirements, or omission for ordinary delegation.
 */
export function validateTaskAssessment(assessment: SubagentTaskAssessment | undefined): void {
  if (assessment === undefined) return
  for (const [field, value] of [['contextTokens', assessment.contextTokens], ['outputTokens', assessment.outputTokens]] as const) {
    const minimum = field === 'outputTokens' ? 1 : 0
    if (value !== undefined && (!Number.isSafeInteger(value) || value < minimum)) {
      throw new ToolArgsError([`task_assessment.${field} must be a ${minimum === 0 ? 'non-negative' : 'positive'} safe integer`])
    }
  }
}
