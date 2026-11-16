/** Fresh-session policy decoding accepts exact payloads and refuses malformed durable JSON. */

import { describe, expect, it } from 'vitest'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { decodePolicySeed } from '../src/policy-seed.ts'
import type { WorkPolicyTag } from '../src/types.ts'

const policies: Array<{ type: WorkPolicyTag; valid: JsonValue; invalid: JsonValue }> = [
  { type: 'permission/preset', valid: { preset: 'read-only' }, invalid: { preset: '' } },
  { type: 'sandbox/mode', valid: { mode: 'read-only', source: 'delegation' }, invalid: { mode: 'unrestricted' } },
  { type: 'approval/policy', valid: { policy: 'ask', source: 'delegation' }, invalid: { policy: 'always' } },
  { type: 'subagent/model-selection-policy', valid: { allowedModels: [{ provider: 'mock', model: 'lead' }] },
    invalid: { allowedModels: [] } },
  { type: 'plan/mode', valid: { active: true }, invalid: { active: 'true' } },
]

describe('work handoff policy seed decoder', () => {
  it.each(policies)('retains exact $type payloads and rejects invalid fields or encoded JSON strings', (policy) => {
    const event = decodePolicySeed({ type: policy.type, data: policy.valid }, 2)
    expect(event).toMatchObject({ type: policy.type, data: policy.valid, seq: 2 })
    for (const data of [policy.invalid, JSON.stringify(policy.valid)]) {
      expect(() => decodePolicySeed({ type: policy.type, data }, 0))
        .toThrow(expect.objectContaining({ code: 'WORK_HANDOFF_POLICY_UNAVAILABLE' }))
    }
  })
})
