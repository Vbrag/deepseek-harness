/** Detached control writers retain only newly accepted events without reading history. */
import { expect, it } from 'vitest'
import { Session, SessionId, SessionLogOffset, type SessionEvent } from '../src/index.ts'

it('captures the restore marker and new events without copying replayed history', () => {
  const original = Session.create(SessionId('append-capture'))
  const start = original.append('turn/start', { turn: 1 })
  const appended: SessionEvent[] = []
  const restored = Session.fromRestore(original.id, [start], original.header, SessionLogOffset(0), 'shared-frozen', undefined, appended)
  expect(appended.map(event => event.type)).toEqual(['session/end-seed'])
  const committed = restored.append('turn/start', { turn: 2 })
  expect(appended).toHaveLength(2)
  expect(appended[1]).toBe(committed)
  expect(Object.isFrozen(committed)).toBe(true)
  appended.splice(0)
  expect(restored.seq).toBe(3)
  restored.append('turn/start', { turn: 3 })
  expect(appended.map(event => event.seq)).toEqual([3])
})

it('captures accepted batches in order and excludes rejected writes', () => {
  const original = Session.create(SessionId('append-capture-batch'))
  const appended: SessionEvent[] = []
  const restored = Session.fromRestore(original.id, [], original.header, SessionLogOffset(0), 'detached', undefined, appended)
  appended.splice(0)
  const committed = restored.append([['turn/start', { turn: 1 }], ['turn/start', { turn: 2 }]])
  expect(appended).toEqual(committed)
  expect(appended[0]).toBe(committed[0])
  const before = [...appended]
  expect(() => restored.append('turn/start', { turn: Infinity })).toThrow()
  expect(() => restored.append([['turn/start', { turn: 3 }], ['turn/start', { turn: Infinity }]])).toThrow()
  expect(appended).toEqual(before)
})
