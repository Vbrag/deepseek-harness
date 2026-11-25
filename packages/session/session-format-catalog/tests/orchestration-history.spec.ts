/** Required orchestration events fail closed for readers that predate them. */
import { expect, it } from 'vitest'
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import { restoreReleasedV4Artifact } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import type { SessionFormatArtifact } from '@deepseek-ai/dsh-session-format'

it.each([
  'orchestration/mode-request', 'orchestration/route', 'orchestration/routing-state',
  'subagent/model-selection-policy-authorized',
])('rejects %s when an older reader does not recognize it', (type) => {
  const artifact: SessionFormatArtifact = {
    header: { version: 4, id: 'orchestration-compatibility', createdAt: 1, isSeeded: false, delegationDepth: 0 },
    inheritedEventCount: 0,
    events: [{ type, seq: 0, time: 1, data: {} }],
  }
  const older = new Set(KNOWN_SESSION_EVENT_TYPES)
  older.delete(type)
  expect(() => restoreReleasedV4Artifact(artifact, older)).toThrow(/unknown event type/)
  expect(restoreReleasedV4Artifact(artifact, KNOWN_SESSION_EVENT_TYPES)).toBe(artifact)
})
