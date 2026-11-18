/** Child-option JSON validation shared by the workflow guest and host. */
import type { SubagentTaskAssessment } from '@deepseek-ai/dsh-subagent'
import { WorkflowError } from '@deepseek-ai/dsh-workflow'

function labels(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || !value.every((item: unknown) => typeof item === 'string')) {
    throw new WorkflowError(`${name} must be an array of strings`, 'INVALID_ARGUMENT')
  }
  return value
}

/**
 * Validate an explicit generation cap independently of routing estimates.
 * @param value - Decoded generation cap.
 * @param name - Field name included in argument diagnostics.
 * @returns A positive safe integer; malformed data throws `INVALID_ARGUMENT`.
 */
export function readMaxTokens(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new WorkflowError(`${name} must be a positive safe integer`, 'INVALID_ARGUMENT')
  }
  return value
}

/**
 * Validate task requirements without interpreting router-owned labels.
 * @param value - Assessment decoded from script options or a PTC request.
 * @param name - Field name included in argument diagnostics.
 * @returns Validated requirements; malformed data throws `INVALID_ARGUMENT`.
 */
export function readTaskAssessment(value: unknown, name: string): SubagentTaskAssessment {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WorkflowError(`${name} must be an object`, 'INVALID_ARGUMENT')
  }
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!['requiredCapabilities', 'preferredCapabilities', 'requiredModalities', 'contextTokens', 'outputTokens'].includes(key)) {
      throw new WorkflowError(`${name}.${key} is not recognized`, 'INVALID_ARGUMENT')
    }
  }
  const requiredCapabilities = labels(record.requiredCapabilities, `${name}.requiredCapabilities`)
  const preferredCapabilities = record.preferredCapabilities === undefined
    ? undefined : labels(record.preferredCapabilities, `${name}.preferredCapabilities`)
  const requiredModalities = record.requiredModalities === undefined
    ? undefined : labels(record.requiredModalities, `${name}.requiredModalities`)
  const { contextTokens, outputTokens } = record
  if (typeof contextTokens !== 'number' || !Number.isSafeInteger(contextTokens) || contextTokens < 0) {
    throw new WorkflowError(`${name}.contextTokens must be a non-negative safe integer`, 'INVALID_ARGUMENT')
  }
  if (outputTokens !== undefined && (typeof outputTokens !== 'number' || !Number.isSafeInteger(outputTokens) || outputTokens < 1)) {
    throw new WorkflowError(`${name}.outputTokens must be a positive safe integer`, 'INVALID_ARGUMENT')
  }
  return {
    requiredCapabilities,
    contextTokens,
    ...preferredCapabilities === undefined ? {} : { preferredCapabilities },
    ...requiredModalities === undefined ? {} : { requiredModalities },
    ...outputTokens === undefined ? {} : { outputTokens },
  }
}
