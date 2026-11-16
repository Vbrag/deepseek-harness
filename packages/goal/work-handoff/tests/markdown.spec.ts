/** Portable Markdown keeps validation claims separate from committed runtime evidence. */

import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { GoalId } from '@deepseek-ai/dsh-goal/types'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkHandoffId, WorkHandoffState } from '../src/types.ts'
import { renderWorkHandoffMarkdown } from '../src/markdown.ts'

const id = brandString<WorkHandoffId>('capture-1')

function facts(): WorkHandoffState {
  return {
    sourceSessionId: brandString<SessionId>('source-1'), latest: null,
    humanObjective: 'Repair parser', turn: 4, checkpoint: {
      summary: 'Parser updated.', completed: ['Added parser support'],
      remaining: [{ task: 'Verify parser', nextActions: ['Run parser test'], references: ['src/parser.ts:12'] }],
      validation: [{ command: 'test parser', result: 'unknown', evidence: ['No final result yet'] }],
      blockers: ['Awaiting test result'],
    },
    evidence: [{ seq: 20, callId: brandString<ToolCallId>('call-1'), name: 'bash',
      arguments: '{"command":"test parser"}', result: '``` output\nfailed', isError: true }],
    pendingJobs: ['test-job'], pendingSubagents: ['reviewer'], policySeeds: [], policyFailure: null,
  }
}

describe('work handoff Markdown', () => {
  it('renders remaining actions, references, actual tool failures, pending work, and the unchanged goal allowance', () => {
    const markdown = renderWorkHandoffMarkdown(facts(), {
      reason: 'goal-budget', goal: { id: brandString<GoalId>('goal-1'), revision: 3,
        objective: 'Finish parser safely', roundsStarted: 4, maxGoalRounds: 4 },
      todoRepairs: { attempts: 3, limit: 3 },
      todos: [{ content: 'Implement parser', status: 'completed' }, { content: 'Test parser', status: 'in_progress' }],
    }, id, { cwd: '/work', branch: 'task/parser', commit: 'abc123', changes: ['src/parser.ts'] })
    expect(markdown).toContain('Source Session: source-1')
    expect(markdown).toContain('Stop reason: goal-budget')
    expect(markdown).toContain('Finish parser safely')
    expect(markdown).toContain('- [x] Implement parser (completed)')
    expect(markdown).toContain('- [ ] Test parser (in_progress)')
    expect(markdown).toContain('Run parser test')
    expect(markdown).toContain('src/parser.ts:12')
    expect(markdown).toContain('## Checkpoint validation reports\n\n### unknown')
    expect(markdown).toContain('source event 20')
    expect(markdown).toContain('Result preview (tool error)')
    expect(markdown).toContain('````\n``` output\nfailed\n````')
    expect(markdown).toContain('## Pending jobs\n\n- test-job')
    expect(markdown).toContain('## Pending subagents\n\n- reviewer')
    expect(markdown).toContain('Rounds started: 4\n\nMaximum rounds: 4\n\nRemaining allowance: 0')
    expect(markdown).toContain('## Todo recovery\n\nAutomatic continuation has no round limit.')
    expect(markdown).toContain('Consecutive repairs: 3\n\nStronger-guidance threshold: 3')
    expect(markdown).toContain('Branch: task/parser\n\nCommit: abc123')
    expect(markdown.endsWith('\n\n')).toBe(false)
    expect(markdown.endsWith('\n')).toBe(true)
  })

  it('reports absent facts without claiming success, escapes authored headings, and includes policy carryover failure', () => {
    const state = { ...facts(), checkpoint: null, evidence: [], humanObjective: '# Task <script>',
      pendingJobs: [], pendingSubagents: [], policyFailure: 'Policy is too large.' }
    const markdown = renderWorkHandoffMarkdown(state, {
      reason: 'error', todos: [{ content: 'Run tests', status: 'pending' }],
    }, id, { error: 'Git unavailable' })
    expect(markdown).toContain('\\# Task \\<script\\>')
    expect(markdown).toContain('No validation commands were reported.')
    expect(markdown).toContain('No tool observations were retained.')
    expect(markdown).toContain('## Remaining work and next actions\n\n- Run tests')
    expect(markdown).toContain('Branch: Unavailable')
    expect(markdown).toContain('Changed-file observations are unavailable.')
    expect(markdown).toContain('Observation error: Git unavailable')
    expect(markdown).toContain('Policy carryover unavailable: Policy is too large.')
  })
})
