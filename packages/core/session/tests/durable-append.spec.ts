/** Durability guards survive a failed checkpoint until storage confirms the accepted events. */
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import SessionStore, { type SessionId } from '@deepseek-ai/dsh-session'
import { expect, it, onTestFinished, vi } from 'vitest'

it('blocks dependent work until a pending append is flushed', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SessionStore)
  const session = ctx.sessions.create(brandString<SessionId>('durable-pending'))
  const barrier = Promise.withResolvers<undefined>()
  ctx.on('session/flush', () => barrier.promise)
  const write = ctx.sessions.appendDurably(session, [['turn/start', { turn: 1 }]])
  expect(ctx.sessions.durableAppendPending(session)).toBe(true)
  await expect(ctx.sessions.retryDurableAppend(session)).resolves.toBe(false)
  await expect(ctx.sessions.appendDurably(session, [['turn/start', { turn: 2 }]])).rejects.toThrow(/unresolved/)
  barrier.resolve(undefined)
  await write
  expect(ctx.sessions.durableAppendPending(session)).toBe(false)
})

it('keeps an uncertain append guarded until an explicit successful retry', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SessionStore)
  const session = ctx.sessions.create(brandString<SessionId>('durable-failure'))
  const checkpoint = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
  ctx.on('session/flush', checkpoint)
  await expect(ctx.sessions.appendDurably(session, [['turn/start', { turn: 1 }]])).rejects.toThrow('offline')
  expect(ctx.sessions.durableAppendPending(session)).toBe(true)
  expect(session.snapshotEvents()).toHaveLength(1)
  await expect(ctx.sessions.retryDurableAppend(session)).resolves.toBe(true)
  expect(ctx.sessions.durableAppendPending(session)).toBe(false)
  expect(session.snapshotEvents()).toHaveLength(1)
})
