/** Decode complete retained policies before a fresh continuation Session is created. */
import { z } from 'zod'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-plan-mode'
import type {} from '@deepseek-ai/dsh-subagent/model-selection-policy'
import { WorkHandoffError } from './error.ts'
import type { WorkPolicySeed } from './types.ts'

/**
 * Validate security policy fields without discarding or defaulting source data.
 * @param policy - whole policy retained by the source projection.
 * @param index - contiguous position in the fresh Session seed.
 * @returns a typed Session event accepted by its policy owner.
 */
export function decodePolicySeed(policy: WorkPolicySeed, index: number): SessionEvent {
  const envelope = { seq: SessionSeq(index), time: Date.now() }
  try {
    switch (policy.type) {
      case 'permission/preset':
        return { ...envelope, type: policy.type, data: z.object({ preset: z.string().min(1) }).strict().parse(policy.data) }
      case 'sandbox/mode':
        return { ...envelope, type: policy.type, data: z.object({
          mode: z.enum(['read-only', 'workspace-write', 'danger-full-access']), source: z.literal('delegation').optional(),
        }).strict().transform(({ mode, source }) => ({ mode, ...source === undefined ? {} : { source } })).parse(policy.data) }
      case 'approval/policy':
        return { ...envelope, type: policy.type, data: z.object({
          policy: z.enum(['ask', 'never']), source: z.literal('delegation').optional(),
        }).strict().transform(({ policy: value, source }) => ({ policy: value, ...source === undefined ? {} : { source } }))
          .parse(policy.data) }
      case 'subagent/model-selection-policy':
        return { ...envelope, type: policy.type, data: z.object({
          allowedModels: z.array(z.object({ provider: z.string().min(1), model: z.string().min(1) }).strict()).min(1),
        }).strict().parse(policy.data) }
      case 'plan/mode':
        return { ...envelope, type: policy.type, data: z.object({ active: z.boolean() }).strict().parse(policy.data) }
    }
  } catch (cause) {
    throw new WorkHandoffError(`Cannot retain source policy ${policy.type}; no continuation was started.`,
      'WORK_HANDOFF_POLICY_UNAVAILABLE', { cause })
  }
}
