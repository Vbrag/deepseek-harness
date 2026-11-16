/** Strict bounded recovery and whole-value publication of handoff facts. */

import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { JobId } from '@deepseek-ai/dsh-jobs/types'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { createWorkCheckpointSchema, createWorkHandoffProjection } from '../src/projection.ts'
import type { WorkCheckpoint, WorkHandoffId, WorkHandoffView, WorkPolicyTag } from '../src/types.ts'

const config = { maxEvidence: 2, maxTextChars: 500, maxPending: 2, maxPolicyChars: 1000 }
const checkpoint: WorkCheckpoint = {
  summary: 'Parser updated.', completed: ['Read parser'],
  remaining: [{ task: 'Verify parser', nextActions: ['Run parser tests'], references: ['parser.ts'] }],
  validation: [{ command: 'test parser', result: 'unknown', evidence: [] }], blockers: [],
}

function bench() {
  const definition = createWorkHandoffProjection(config)
  const session = Session.create(brandString<SessionId>('handoff-source'))
  const initial = definition.init(session.header, SessionLogOffset(0))
  const fold = () => session.snapshotEvents().reduce((state, event) => definition.apply(state, event), initial)
  return { definition, session, initial, fold }
}

function handoff(sourceSessionId: SessionId): WorkHandoffView {
  return {
    id: brandString<WorkHandoffId>('capture-1'), sourceSessionId, turn: 1, reason: 'todo-limit',
    status: 'budget-exhausted', objective: 'Finish parser', markdown: '# Work handoff\n', saved: false, todos: [],
  }
}

describe('work handoff projection', () => {
  it('retains bounded tool results and human objectives without crediting model progress as human input', () => {
    const { session, fold, definition, initial } = bench()
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Finish parser' }],
      source: { kind: 'user' } }), { surfaceOp: 'append' })
    session.append('work-handoff/checkpoint', { checkpoint })
    for (let index = 0; index < 3; index++) {
      const callId = brandString<ToolCallId>(`call-${index}`)
      session.append('tool/call', { turn: 1, step: 1, callId, name: 'test', arguments: 'x'.repeat(600) })
      session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({
        callId, content: [{ type: 'text', text: `result-${index}` }], isError: index === 2,
      }) }, { surfaceOp: 'append' })
    }
    const state = fold()
    expect(state.humanObjective).toBe('Finish parser')
    expect(state.objectiveSeq).toBe(2)
    expect(state.turn).toBe(1)
    expect(state.checkpoint).toEqual(checkpoint)
    expect(state.evidence.map(item => [item.callId, item.result, item.isError]))
      .toEqual([['call-1', 'result-1', false], ['call-2', 'result-2', true]])
    expect(state.evidence.every(item => item.arguments.length === 500 && item.arguments.endsWith('…'))).toBe(true)
    expect(definition.stateSchema.parse(JSON.parse(JSON.stringify(state)))).toEqual(state)
    const unrelated = session.append('step/end', { turn: 1, step: 1 })
    expect(definition.apply(initial, unrelated)).toBe(initial)
  })

  it('publishes captures by reference, acknowledges only the current id, and clears without erasing checkpoint facts', () => {
    const { session, fold, definition } = bench()
    const view = handoff(session.id)
    session.append('work-handoff/checkpoint', { checkpoint })
    session.append('work-handoff/captured', { handoff: view })
    let state = fold()
    expect(definition.wire?.view(state)).toBe(state.latest)
    const stale = session.append('work-handoff/saved', { id: brandString<WorkHandoffId>('stale') })
    expect(definition.apply(state, stale)).toBe(state)
    session.append('work-handoff/saved', { id: view.id })
    state = fold()
    expect(state.latest?.saved).toBe(true)
    session.append('work-handoff/cleared', {})
    expect(fold()).toMatchObject({ latest: null, checkpoint })
  })

  it('restores a checkpoint and replays its suffix identically to full replay', () => {
    const { session, fold, definition } = bench()
    session.append('work-handoff/checkpoint', { checkpoint })
    session.append('work-handoff/captured', { handoff: handoff(session.id) })
    const restored = definition.stateSchema.parse(JSON.parse(JSON.stringify(fold())))
    const cursor = session.seq
    session.append('work-handoff/saved', { id: brandString<WorkHandoffId>('capture-1') })
    session.append('work-handoff/imported', { sourceSessionId: session.id,
      handoffId: brandString<WorkHandoffId>('capture-1'), objective: 'Continue parser' })
    const resumed = session.snapshotEvents().slice(cursor).reduce((state, event) => definition.apply(state, event), restored)
    expect(resumed).toEqual(fold())
    expect(resumed.humanObjective).toBe('Continue parser')
    expect(definition.stateVersion).toBe(1)
  })

  it('clears the current report and progress claims when a later turn starts without deleting historical captures', () => {
    const { session, fold } = bench()
    session.append('work-handoff/checkpoint', { checkpoint })
    session.append('work-handoff/captured', { handoff: handoff(session.id) })
    expect(fold().latest).not.toBeNull()
    session.append('turn/start', { turn: 1 })
    expect(fold()).toMatchObject({ turn: 1, latest: null, checkpoint: null })
    expect(session.snapshotEvents().filter(event => event.type === 'work-handoff/captured')).toHaveLength(1)
  })

  it('preserves every admitted todo and the full captured objective independently of evidence limits', () => {
    const { session, fold, definition } = bench()
    const view = { ...handoff(session.id), objective: 'objective '.repeat(1000), markdown: 'capture '.repeat(1000),
      todos: Array.from({ length: 40 }, (_, index) => ({ content: `Task ${index} ` + 'details '.repeat(100),
        status: 'pending' as const })) }
    session.append('work-handoff/captured', { handoff: view })
    expect(fold().latest).toEqual(view)
    expect(definition.stateSchema.safeParse(fold()).success).toBe(true)
  })

  it('bounds pending work observations and removes matching job and subagent settlements', () => {
    const { session, fold } = bench()
    for (let index = 0; index < 3; index++) {
      session.append('job/registered', { jobId: brandString<JobId>(`job-${index}`), owner: session.id,
        kind: 'test', label: 'Test run', startedAt: 0 })
      session.append('subagent/catalog', { childId: brandString<SessionId>(`child-${index}`), childCreatedAt: 0,
        version: 3, name: `agent-${index}`, mode: 'continuable', label: 'Review' })
    }
    expect(fold().pendingJobs).toEqual(['job-1', 'job-2'])
    expect(fold().pendingSubagents).toEqual(['child-1', 'child-2'])
    session.append('job/settled', { jobId: brandString<JobId>('job-2'), owner: session.id, kind: 'test', label: 'Test run',
      startedAt: 0, finishedAt: 1, status: 'completed', cause: 'producer', producerReported: true })
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Review finished' }],
      source: { kind: 'subagent-settled', form: 'notice', summary: 'Review finished',
        senderSessionId: brandString<SessionId>('child-1') } }), { surfaceOp: 'append' })
    expect(fold().pendingJobs).toEqual(['job-1'])
    expect(fold().pendingSubagents).toEqual(['child-2'])
  })

  it('retains exact latest policy payloads and refuses oversized carryover without truncating policies', () => {
    const { session, fold, definition } = bench()
    // Policy payloads are durable JSON; their semantic validation belongs to their target policy owner.
    const policy = (type: WorkPolicyTag, data: JsonValue): SessionEvent =>
      ({ type, data, seq: SessionSeq(0), time: 0 }) as SessionEvent
    let state = definition.apply(fold(), policy('sandbox/mode', { mode: 'read-only' }))
    state = definition.apply(state, policy('sandbox/mode', { mode: 'workspace-write' }))
    state = definition.apply(state, policy('approval/policy', { policy: 'ask' }))
    expect(state.policySeeds).toEqual([
      { type: 'sandbox/mode', data: { mode: 'workspace-write' } },
      { type: 'approval/policy', data: { policy: 'ask' } },
    ])
    const immutable = definition.apply(state, policy('subagent/model-selection-policy', {
      allowedModels: [{ provider: 'mock', model: 'parent' }],
    }))
    expect(definition.apply(immutable, policy('subagent/model-selection-policy', {
      allowedModels: [{ provider: 'mock', model: 'broader' }],
    }))).toBe(immutable)
    state = definition.apply(state, policy('subagent/model-selection-policy', { allowedModels: ['x'.repeat(1001)] }))
    expect(state.policyFailure).toContain('Policy subagent/model-selection-policy')
    expect(state.policySeeds.some(seed => seed.type === 'subagent/model-selection-policy')).toBe(false)
    expect(definition.stateSchema.safeParse(state).success).toBe(true)
    expect(definition.apply(state, session.append('work-handoff/cleared', {})).policyFailure).toBe(state.policyFailure)
  })

  it('rejects malformed checkpoints, extra fields, and incompatible or oversized persisted state', () => {
    const { definition, initial } = bench()
    expect(createWorkCheckpointSchema(config).safeParse({ ...checkpoint, unexpected: true }).success).toBe(false)
    expect(createWorkCheckpointSchema(config).safeParse({ ...checkpoint, summary: 'x'.repeat(501) }).success).toBe(false)
    expect(createWorkCheckpointSchema(config).safeParse({ ...checkpoint,
      validation: [{ command: 'test', result: 'success', evidence: [] }] }).success).toBe(false)
    expect(definition.stateSchema.safeParse({ ...initial, extra: true }).success).toBe(false)
    expect(definition.stateSchema.safeParse({ ...initial, pendingJobs: ['a', 'b', 'c'] }).success).toBe(false)
    expect(definition.stateSchema.safeParse({ ...initial, humanObjective: 'x'.repeat(501) }).success).toBe(false)
    expect(() => createWorkHandoffProjection({ ...config, maxEvidence: 0 })).toThrow('positive safe integer')
  })
})
