/** SDK event collection retains todo continuation state and saved handoffs without rewriting the response. */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import SessionStore, { SessionId, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { WorkHandoffId, WorkHandoffView } from '@deepseek-ai/dsh-work-handoff'
import type {} from '@deepseek-ai/dsh-tool-todo/types'
import type {} from '@deepseek-ai/dsh-project-context/types'
import { createProcessDeepSeekHarness } from '../src/api.ts'

const expectedPath = fileURLToPath(new URL('./expected/todo-handoff-projection.json', import.meta.url))
const fakeRuntime = fileURLToPath(new URL('./fake-runtime.ts', import.meta.url))
const auditTypes = new Set(['todo/policy', 'work-handoff/checkpoint', 'work-handoff/captured', 'work-handoff/saved',
  'project-context/status', 'project-context/document-observed'])

function isAudit(event: unknown): event is { readonly type: string } {
  return typeof event === 'object' && event !== null && 'type' in event && typeof event.type === 'string'
    && auditTypes.has(event.type)
}

it('preserves saved unfinished-work state in both event collections and the original response', async () => {
  const expected = JSON.parse(await readFile(expectedPath, 'utf8')) as { finalResponse: string }
  const ctx = new Context()
  const records: SessionEvent[] = []
  try {
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('sdk-todo-handoff'))
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({ source: { kind: 'user' },
      content: [{ type: 'text', text: 'Finish the task' }] }), { surfaceOp: 'append' })
    session.append('step/start', { turn: 1, step: 1 })
    ctx.on('session/event', (_session, event) => { if (isAudit(event)) records.push(event) })
    const clock = vi.spyOn(Date, 'now').mockReturnValue(0)
    try {
      session.append('todo/policy', {
        purpose: 'current-task', disposition: 'limit', completedHighWater: 1, repairAttempts: 3,
      })
      session.append('work-handoff/checkpoint', { checkpoint: {
        summary: 'Validation remains unresolved', completed: ['Implemented the first step'],
        remaining: [{ task: 'Verify the change', nextActions: ['Inspect the failing trace'], references: ['src/task.ts'] }],
        validation: [{ command: 'check', result: 'failed', evidence: ['Expected result was absent'] }], blockers: [],
      } })
      const handoff: WorkHandoffView = {
        id: brandString<WorkHandoffId>('handoff-todo-limit'), sourceSessionId: session.id, turn: 1,
        reason: 'todo-limit', status: 'work-remains', objective: 'Finish the task',
        markdown: '# Work remains\n\nInspect the failing trace.\n', saved: false,
        todos: [{ content: 'Verify the change', status: 'pending' }],
      }
      session.append('work-handoff/captured', { handoff })
      session.append('work-handoff/saved', { id: handoff.id })
      session.append('project-context/document-observed', { sourceTurn: 1, root: '/project',
        document: { path: 'PROJECT_CONTEXT.md', version: null, content: '' } })
      session.append('project-context/status', { sourceTurn: 1, knowledgeWatermark: SessionSeq(2),
        status: 'updated', contextPath: '/project/PROJECT_CONTEXT.md', summary: 'Project documentation recorded.' })
    } finally {
      clock.mockRestore()
    }
  } finally {
    await ctx.fiber.dispose()
  }
  const harness = createProcessDeepSeekHarness({
    command: process.execPath, args: [fakeRuntime],
    environment: () => ({ ...process.env, FAKE_TEXT: expected.finalResponse, FAKE_SESSION_EVENTS: JSON.stringify(records) }),
    description: 'scripted SDK todo handoff projection', initializeTimeoutMs: 5000,
  })
  try {
    const result = await harness.run([{ type: 'text', text: 'Keep the original response.' }])
    const projection = {
      finalResponse: result.finalResponse,
      auditEvents: result.events.filter(isAudit),
      auditNotifications: result.notifications.filter(notification => notification.method === 'session.event'
        && isAudit(notification.params.event)).map((notification) => {
        if (notification.method !== 'session.event') throw new Error('Expected a Session event notification')
        expect(notification.params.sessionId).toBe(result.sessionId)
        return { method: notification.method, event: notification.params.event }
      }),
      assistantTexts: result.events.filter(event => event.type === 'assistant/message')
        .flatMap(event => event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : [])),
    }
    expect(projection).toEqual(JSON.parse(await readFile(expectedPath, 'utf8')))
    expect(projection.auditEvents).toHaveLength(6)
  } finally {
    await harness.close()
  }
})
