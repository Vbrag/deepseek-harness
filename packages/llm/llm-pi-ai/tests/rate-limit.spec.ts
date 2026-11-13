import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ModelRateLimit } from '../src/catalog.ts'
import {
  estimateInputTokens,
  estimateRequestInputTokens,
  ModelRateLimiter,
} from '../src/rate-limit.ts'

/** A rejection helper that lets a test observe one pending acquire resolving. */
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

  it('returns immediately when no limits are declared', async () => {
    const limiter = new ModelRateLimiter()
    await expect(limiter.acquire('p', 'm', undefined, 0)).resolves.toBe(0)
  })

  it('paces by RPM: a third immediate call waits for the bucket to refill', async () => {
    const limiter = new ModelRateLimiter()
    const limits: ModelRateLimit = { rpm: 2 }
    await limiter.acquire('p', 'm', limits, 0)
    await limiter.acquire('p', 'm', limits, 0)
    const third = acquireLater(limiter, 'p', 'm', limits, 0)
    // Capacity is 2, refill 2/60 per second: only ~30s of waiting to free one.
    await vi.advanceTimersByTimeAsync(1000)
    expect(third.resolved).toBe(false)
    await vi.advanceTimersByTimeAsync(30000)
    expect(third.resolved).toBe(true)
  })

  it('holds distinct provider+model budgets independently', async () => {
    const limiter = new ModelRateLimiter()
    const a: ModelRateLimit = { rpm: 1 }
    const b: ModelRateLimit = { rpm: 1 }
    await limiter.acquire('p', 'm1', a, 0)
    // A different model has its own full budget.
    await expect(limiter.acquire('p', 'm2', b, 0)).resolves.toBe(0)
    // The same model is now exhausted.
    const again = acquireLater(limiter, 'p', 'm1', a, 0)
    expect(again.resolved).toBe(false)
  })

  it('paces by TPM: reserves an input estimate and lets RPM pass when no rpm limit is set', async () => {
    const limiter = new ModelRateLimiter()
    const limits: ModelRateLimit = { tpm: 4000 } // refill 4000/60 per second
    // Reserve 3000 tokens immediately.
    await limiter.acquire('p', 'm', limits, 3000)
    const next = acquireLater(limiter, 'p', 'm', limits, 3000)
    // Only 1000 of the requested 3000 are available; needs ~30s.
    await vi.advanceTimersByTimeAsync(1000)
    expect(next.resolved).toBe(false)
    await vi.advanceTimersByTimeAsync(30000)
    expect(next.resolved).toBe(true)
    expect(await next.promise).toBe(3000)
  })

  it('refunds an over-estimate on settle and charges a deficit', async () => {
    const limiter = new ModelRateLimiter()
    const limits: ModelRateLimit = { tpm: 100000 }
    // Reserve 1000, then settle with actual 500 (over-estimate): refund 500.
    await limiter.acquire('p', 'm', limits, 1000)
    limiter.settle('p', 'm', limits, 1000, 300, 200)
    // Budget now has room for a fresh 1000 immediately (capacity 100000).
    await expect(limiter.acquire('p', 'm', limits, 1000)).resolves.toBe(1000)
  })

  it('releases a reservation when a call never produces usage', async () => {
    const limiter = new ModelRateLimiter()
    const limits: ModelRateLimit = { rpm: 1 }
    await limiter.acquire('p', 'm', limits, 0)
    limiter.release('p', 'm', 0)
    await expect(limiter.acquire('p', 'm', limits, 0)).resolves.toBe(0)
  })
})
