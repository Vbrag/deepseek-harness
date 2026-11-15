import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ModelRateLimit } from '../src/catalog.ts'
import {
  estimateInputTokens,
  estimateRequestInputTokens,
  ModelRateLimiter,
} from '../src/rate-limit.ts'

/** Observe admission without awaiting a deliberately blocked request. */
function acquireLater(limiter: ModelRateLimiter, provider: string, model: string, limits: ModelRateLimit | undefined, input: number) {
  let resolved = false
  const promise = limiter.acquire(provider, model, limits, input).then((n) => { resolved = true; return n })
  return { promise, get resolved() { return resolved } }
}

describe('input-token estimation', () => {
  it('estimates ~4 characters per token plus a flat image allowance', () => {
    expect(estimateInputTokens(400, 0)).toBe(100)
    expect(estimateInputTokens(400, 2)).toBe(100 + 2000)
  })

  it('estimates a whole request from messages, system, and tools', () => {
    const messages = [
      { content: [{ type: 'text' as const, text: 'x'.repeat(400) }] },
      { content: [{ type: 'reasoning' as const, text: 'y'.repeat(80) }] },
    ]
    const tool: ToolSchema = { name: 'tool-a', description: 'd'.repeat(40), parameters: { type: 'object', properties: {} } }
    const chars = 'sys'.repeat(20).length + 400 + 80 + tool.name.length + tool.description.length
      + JSON.stringify(tool.parameters).length
    expect(estimateRequestInputTokens(messages, 'sys'.repeat(20), [tool]))
      .toBe(Math.ceil(chars / 4))
  })

  it('counts images across messages', () => {
    const message = {
      content: [{ type: 'image' as const, attachment: {
        attachmentId: AttachmentId('sha256:' + 'a'.repeat(64)),
        mediaType: 'image/png' as const,
        bytes: 1,
        width: 1,
        height: 1,
      } }],
    }
    expect(estimateRequestInputTokens([message])).toBe(estimateInputTokens(0, 1))
  })
})

describe('ModelRateLimiter', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('leaves unlimited routes advisory-unknown while retaining recent dispatches for later limits', async () => {
    const limiter = new ModelRateLimiter()
    expect(limiter.availability('p', 'm', undefined, 100)).toEqual({ kind: 'unknown' })
    const reservation = await limiter.acquire('p', 'm', undefined, 100)
    reservation.dispatch()
    reservation.settle()
    expect(limiter.availability('p', 'm', { rpm: 1 }, 0).kind).toBe('wait')
  })

  it('admits no more than the declared RPM in any rolling minute', async () => {
    const limiter = new ModelRateLimiter()
    const limits: ModelRateLimit = { rpm: 2 }
    for (let i = 0; i < 2; i += 1) {
      const reservation = await limiter.acquire('p', 'm', limits, 0)
      reservation.dispatch()
      reservation.settle()
    }
    const third = acquireLater(limiter, 'p', 'm', limits, 0)
    await vi.advanceTimersByTimeAsync(59_999)
    expect(third.resolved).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(third.resolved).toBe(true)
    ;(await third.promise).release()
  })

  it('keeps model, provider, and adapter-instance budgets independent', async () => {
    const limiter = new ModelRateLimiter()
    const limits = { rpm: 1 }
    await limiter.acquire('p', 'm1', limits, 0)
    expect(limiter.availability('p', 'm1', limits, 0).kind).toBe('wait')
    expect(limiter.availability('p', 'm2', limits, 0)).toEqual({ kind: 'ready' })
    expect(limiter.availability('other', 'm1', limits, 0)).toEqual({ kind: 'ready' })
    expect(new ModelRateLimiter().availability('p', 'm1', limits, 0)).toEqual({ kind: 'ready' })
  })

  it('keeps actual usage debt until its rolling minute expires', async () => {
    const limiter = new ModelRateLimiter()
    const limits = { tpm: 1000 }
    const reservation = await limiter.acquire('p', 'm', limits, 100)
    reservation.dispatch()
    await vi.advanceTimersByTimeAsync(30_000)
    reservation.settle(1500)
    expect(limiter.availability('p', 'm', limits, 1)).toEqual({ kind: 'wait', waitMs: 60_000 })
    await vi.advanceTimersByTimeAsync(59_999)
    expect(limiter.availability('p', 'm', limits, 1).kind).toBe('wait')
    await vi.advanceTimersByTimeAsync(1)
    expect(limiter.availability('p', 'm', limits, 1)).toEqual({ kind: 'ready' })
  })

  it('wakes queued calls when actual usage refunds an estimate', async () => {
    const limiter = new ModelRateLimiter()
    const limits = { tpm: 800 }
    const first = await limiter.acquire('p', 'm', limits, 500)
    first.dispatch()
    const next = acquireLater(limiter, 'p', 'm', limits, 500)
    expect(next.resolved).toBe(false)
    first.settle(100)
    ;(await next.promise).release()
    expect(next.resolved).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('releases RPM-only reservations only before dispatch', async () => {
    const limiter = new ModelRateLimiter()
    const limits = { rpm: 1 }
    const beforeDispatch = await limiter.acquire('p', 'm', limits, 0)
    beforeDispatch.release()
    const afterDispatch = await limiter.acquire('p', 'm', limits, 0)
    afterDispatch.dispatch()
    afterDispatch.release()
    afterDispatch.settle()
    expect(limiter.availability('p', 'm', limits, 0)).toEqual({ kind: 'wait', waitMs: 60_000 })
  })

  it('retains conservative usage when a dispatched request reports none', async () => {
    const limiter = new ModelRateLimiter()
    const limits = { tpm: 1000 }
    const reservation = await limiter.acquire('p', 'm', limits, 800)
    reservation.dispatch()
    reservation.settle()
    expect(limiter.availability('p', 'm', limits, 300).kind).toBe('wait')
  })

  it('applies changed limits to outstanding charges without resetting them', async () => {
    const limiter = new ModelRateLimiter()
    const first = await limiter.acquire('p', 'm', { tpm: 1000 }, 800)
    first.dispatch()
    first.settle()
    expect(limiter.availability('p', 'm', { tpm: 1500 }, 800).kind).toBe('wait')
    expect(limiter.availability('p', 'm', { tpm: 2000 }, 800)).toEqual({ kind: 'ready' })
    expect(limiter.availability('p', 'm', { rpm: 1 }, 0).kind).toBe('wait')
  })

  it('does not reserve capacity through repeated advisory queries', () => {
    const limiter = new ModelRateLimiter()
    expect(limiter.availability('p', 'm', { rpm: 1 }, 0)).toEqual({ kind: 'ready' })
    expect(limiter.availability('p', 'm', { rpm: 1 }, 0)).toEqual({ kind: 'ready' })
  })

  it('rejects oversized requests immediately with a typed failure', async () => {
    const limiter = new ModelRateLimiter()
    expect(limiter.availability('p', 'm', { tpm: 100 }, 101))
      .toEqual({ kind: 'impossible', estimatedTokens: 101, tokenLimit: 100 })
    await expect(limiter.acquire('p', 'm', { tpm: 100 }, 101))
      .rejects.toMatchObject({ name: 'LlmError', code: 'RATE_LIMIT_REQUEST_TOO_LARGE' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not charge an already-aborted call and removes cancelled waits', async () => {
    const limiter = new ModelRateLimiter()
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(limiter.acquire('p', 'm', { rpm: 1 }, 0, controller.signal)).rejects.toThrow('cancelled')
    const reservation = await limiter.acquire('p', 'm', { rpm: 1 }, 0)
    const queued = new AbortController()
    const waiting = limiter.acquire('p', 'm', { rpm: 1 }, 0, queued.signal)
    const rejected = expect(waiting).rejects.toThrow('stop waiting')
    queued.abort(new Error('stop waiting'))
    await rejected
    expect(vi.getTimerCount()).toBe(0)
    reservation.release()
  })
})
