/** SDK event collection retains the recorded auxiliary prompt and selected submission. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { createProcessDeepSeekHarness } from '../src/api.ts'

const expectedPath = fileURLToPath(new URL('./expected/prompt-enhancement-projection.json', import.meta.url))
const sessionPath = fileURLToPath(new URL('../../../../snapshots/web/prompt-enhancement/session.v4.jsonl', import.meta.url))
const fakeRuntime = fileURLToPath(new URL('./fake-runtime.ts', import.meta.url))
const auditTypes = new Set(['prompt-enhancement/request', 'prompt-enhancement/result', 'prompt-enhancement/accepted'])

function isAudit(event: unknown): event is { readonly type: string } {
  return typeof event === 'object' && event !== null && 'type' in event && typeof event.type === 'string'
    && auditTypes.has(event.type)
}

it('preserves prompt enhancement records and the original main response', async () => {
  const expected = JSON.parse(await readFile(expectedPath, 'utf8')) as { finalResponse: string }
  const rows: unknown[] = (await readFile(sessionPath, 'utf8')).split('\n')
    .filter(line => line !== '').map((line) => { const value: unknown = JSON.parse(line); return value })
  const records = rows.filter(isAudit).slice(0, 3)
  expect(records.map(event => event.type)).toEqual([
    'prompt-enhancement/request', 'prompt-enhancement/result', 'prompt-enhancement/accepted',
  ])
  const harness = createProcessDeepSeekHarness({
    command: process.execPath, args: [fakeRuntime],
    environment: () => ({ ...process.env, FAKE_TEXT: expected.finalResponse, FAKE_SESSION_EVENTS: JSON.stringify(records) }),
    description: 'scripted SDK prompt enhancement projection', initializeTimeoutMs: 5000,
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
  } finally {
    await harness.close()
  }
})
