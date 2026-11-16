/** Project-document replay, fork authority, and interrupted assessment state. */

import { expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import { createProjectContextProjection } from '../src/projection.ts'

function harness(header: Partial<SessionHeader> = {}, inherited = 0) {
  const session = Session.create(SessionId('project-context-projection'))
  const projection = createProjectContextProjection({ maxTextChars: 500, maxSourceBytes: 40 })
  const initial = projection.init({ ...session.header, ...header }, SessionLogOffset(inherited))
  const state = () => session.snapshotEvents().reduce((state, event) => projection.apply(state, event), initial)
  return { session, projection, initial, state }
}

it('accepts projection limits from the complete deployment configuration', () => {
  const config = { maxTextChars: 500, maxSourceBytes: 1000, maxDocuments: 16, projectContextFileName: 'PROJECT_CONTEXT.md' }
  expect(() => createProjectContextProjection(config)).not.toThrow()
})

it('freezes the assessed work watermark while maintenance requests and results are logged', () => {
  const test = harness()
  test.session.append('turn/start', { turn: 1 })
  const work = test.session.append('user/message', createUserMessage({ source: { kind: 'user' },
    content: [{ type: 'text', text: 'Implement the parser' }] }), { surfaceOp: 'append' })
  expect(test.state().view).toEqual({ sourceTurn: 1, knowledgeWatermark: work.seq, status: 'pending' })
  test.session.append('project-context/status', { sourceTurn: 1, knowledgeWatermark: work.seq, status: 'updating' })
  test.session.append('user/message', createUserMessage({ source: { kind: 'project-context', sourceTurn: 1 },
    content: [{ type: 'text', text: 'Assess the documentation now' }] }), { surfaceOp: 'append' })
  test.session.append('project-context/document-observed', { sourceTurn: 1, root: '/project', document: {
    path: '/project/PROJECT_CONTEXT.md', version: null, content: '',
  } })
  expect(test.state().view?.knowledgeWatermark).toBe(work.seq)
  test.session.append('project-context/status', { sourceTurn: 1, knowledgeWatermark: work.seq,
    status: 'unchanged', summary: 'The current guide already records these facts.' })
  test.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  expect(test.state().view?.status).toBe('unchanged')
  test.session.append('turn/start', { turn: 2 })
  expect(test.state().view).toMatchObject({ sourceTurn: 2, status: 'pending' })
})

it('restores a checkpoint and its suffix identically to full replay', () => {
  const test = harness()
  const start = test.session.append('turn/start', { turn: 1 })
  test.session.append('project-context/status', { sourceTurn: 1, knowledgeWatermark: start.seq, status: 'updating' })
  const restored = test.projection.stateSchema.parse(JSON.parse(JSON.stringify(test.state())))
  const cursor = test.session.seq
  test.session.append('project-context/status', { sourceTurn: 1, knowledgeWatermark: start.seq,
    status: 'updated', contextPath: '/project/PROJECT_CONTEXT.md' })
  const replayed = test.session.snapshotEvents().slice(cursor).reduce((state, event) => test.projection.apply(state, event), restored)
  expect(replayed).toEqual(test.state())
  expect(test.projection.wire.view(replayed)).toBe(replayed.view)
  const unrelated = test.session.append('step/end', { turn: 1, step: 1 })
  expect(test.projection.apply(replayed, unrelated)).toBe(replayed)
})

it('ignores inherited authority and stale results from a different source turn', () => {
  const test = harness({}, 2)
  test.session.append('turn/start', { turn: 1 })
  test.session.append('project-context/status', { sourceTurn: 1, knowledgeWatermark: SessionSeq(0), status: 'updated' })
  expect(test.state().view).toBeNull()
  const own = test.session.append('turn/start', { turn: 2 })
  const before = test.state()
  const stale = test.session.append('project-context/status', { sourceTurn: 1,
    knowledgeWatermark: SessionSeq(0), status: 'failed', reason: 'Old operation finished late' })
  expect(test.projection.apply(before, stale)).toBe(before)
  expect(test.state().view).toEqual({ sourceTurn: 2, knowledgeWatermark: own.seq, status: 'pending' })
})

it.each([{ delegationDepth: 1 }, { origin: 'subagent' as const }])('does not transfer project-document writing authority to a child', (header) => {
  const test = harness(header)
  test.session.append('turn/start', { turn: 1 })
  test.session.append('project-context/status', { sourceTurn: 1, knowledgeWatermark: SessionSeq(0), status: 'updating' })
  expect(test.state()).toBe(test.initial)
})

it.each(['completed', 'aborted', 'max-tokens', 'error'] as const)('preserves unfinished assessment on %s closure', (kind) => {
  const test = harness()
  const start = test.session.append('turn/start', { turn: 1 })
  test.session.append('project-context/status', { sourceTurn: 1, knowledgeWatermark: start.seq, status: 'updating' })
  if (kind === 'error') test.session.append('turn/end', { turn: 1, reason: { kind, error: { code: 'TEST', message: 'Write failed' } } })
  else if (kind === 'aborted') test.session.append('turn/end', { turn: 1, reason: { kind, reason: { kind: 'user' } } })
  else test.session.append('turn/end', { turn: 1, reason: { kind } })
  expect(test.state().view?.status).toBe(kind === 'error' ? 'failed' : 'deferred')
  expect(test.state().view?.reason).toBeTruthy()
})

it('rejects invalid durable checkpoints, future watermarks, and oversized original document bytes', () => {
  const test = harness()
  test.session.append('turn/start', { turn: 1 })
  expect(test.projection.stateSchema.safeParse({ ...test.state(), extra: true }).success).toBe(false)
  const future = test.session.append('project-context/status', {
    sourceTurn: 1, knowledgeWatermark: SessionSeq(100), status: 'updated',
  })
  expect(() => test.projection.apply(test.initial, future)).toThrow('future Session knowledge')
  const oversized = test.session.append('project-context/document-observed', { sourceTurn: 1, root: '/project',
    document: { path: '/project/AGENTS.md', version: null, content: '界'.repeat(14) } })
  expect(() => test.projection.apply(test.initial, oversized)).toThrow('maxSourceBytes')
})
