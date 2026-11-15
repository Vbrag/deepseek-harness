/** Experimental record helpers accept Sessions from independently evaluated module copies. */

import { afterEach, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '../src/index.ts'
import type {} from './plugin-records.type-test.ts'

afterEach(() => { vi.resetModules() })

it('appends through the Session instance that owns the private record writer', async () => {
  vi.resetModules()
  const first = await import('../src/index.ts')
  vi.resetModules()
  const second = await import('../src/index.ts')
  expect(first.Session).not.toBe(second.Session)
  const session = second.Session.create(brandString<SessionId>('independent-copy'))
  const data = { count: 1 }
  const seq = first.appendPluginRecord(session, 'plugin:test/state', data)
  data.count = 2
  expect(session.eventAt(seq)).toMatchObject({ type: 'plugin:test/state', data: { count: 1 }, ignorable: true })
  expect(session.deriveMessages()).toEqual([])
  expect(Object.isFrozen(session.eventAt(seq)?.data)).toBe(true)
  expect(() => first.appendPluginRecord(session, 'plugin:test/number', Number.NaN)).toThrow('JSON')
  expect(session.seq).toBe(1)
})
