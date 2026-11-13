/**
 * Proactive per-model request and token throttling for the pi-ai adapter.
 *
 * A provider gateway (such as a university AI gateway) publishes per-model
 * limits: a maximum number of requests per minute (RPM) and a maximum number
 * of tokens per minute (TPM). When several sessions or several steps of one
 * agent call the same model concurrently, naive dispatch can exceed those
 * limits and be denied mid-turn (HTTP 429). This module paces dispatch so the
 * process never issues more requests or tokens than the configured budget in a
 * rolling minute, holding a call briefly when the budget is exhausted rather
 * than failing it — the "queue and wait" behavior.
 *
 * Both dimensions are token buckets that refill continuously:
 * - The **RPM bucket** holds `rpm` tokens and refills `rpm/60` per second;
 *   a call reserves one token before dispatch.
 * - The **TPM bucket** holds `tpm` tokens and refills `tpm/60` per second; a
 *   call reserves an estimate of its input tokens before dispatch and settles
 *   the actual input+output usage when the streamed response reports it, so an
 *   underestimate delays the following call instead of silently exceeding the
 *   minute budget.
 *
 * One {@link ModelRateLimiter} instance covers the whole process, so every
 * chat sharing a provider route shares one budget per model. A configuration
 * that removes a model's limits leaves a stale bucket behind harmlessly; it is
 * never consulted once the model stops declaring limits.
 *
 * @module dsh-llm-pi-ai/rate-limit
 */

import type { ContentBlock, ToolSchema } from '@deepseek-ai/dsh-llm'
import type { ModelRateLimit } from './catalog.ts'

/** One token bucket: capacity, a continuous refill rate, and current tokens. */
class TokenBucket {
  readonly capacity: number
  private readonly ratePerMs: number
  private tokens: number
  private lastRefillMs: number

  constructor(capacity: number, perSecond: number, nowMs: number) {
    this.capacity = capacity
    this.ratePerMs = perSecond / 1000
    this.tokens = capacity
    this.lastRefillMs = nowMs
  }

  private refill(nowMs: number): void {
    if (nowMs <= this.lastRefillMs) return
    const added = (nowMs - this.lastRefillMs) * this.ratePerMs
    this.tokens = Math.min(this.capacity, this.tokens + added)
    this.lastRefillMs = nowMs
  }

  /**
   * How long to wait until `count` tokens are available, without mutating the
   * bucket — checked first so a caller can sleep before reserving.
   * @param count - tokens the caller needs.
   * @param nowMs - current wall-clock time.
   * @returns the milliseconds to wait, or 0 when enough are available now.
   */
  waitMs(count: number, nowMs: number): number {
    this.refill(nowMs)
    const deficit = count - this.tokens
    return deficit <= 0 ? 0 : Math.ceil(deficit / this.ratePerMs)
  }

  /** Reserve `count` tokens, refilling first; returns the tokens actually available (capped). */
  reserve(count: number, nowMs: number): void {
    this.refill(nowMs)
    this.tokens = Math.max(0, this.tokens - count)
  }

  /** Return an unused reservation so the budget is not wasted (used to settle an over-estimate). */
  refund(count: number, nowMs: number): void {
    this.refill(nowMs)
    this.tokens = Math.min(this.capacity, this.tokens + count)
  }
}

/** One model's RPM and TPM buckets plus the configured limits that created them. */
interface ModelLimiter {
  rpm?: TokenBucket
  tpm?: TokenBucket
  rpmLimit?: number
  tpmLimit?: number
}

/** A timer-backed wait: resolves when the delay elapses or the signal aborts. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal?.reason instanceof Error ? signal.reason : new Error('aborted'))
    }
    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Estimate the input tokens a request will consume from its serialized text. */
export function estimateInputTokens(chars: number, images: number): number {
  // ~4 characters per token is the common English heuristic; images reserve a
  // conservative flat allowance because the harness has no provider tokenizer.
  return Math.ceil(chars / 4) + images * 1000
}

/** The only message field the input estimator reads: its content blocks. */
interface MessageContent {
  readonly content: readonly ContentBlock[]
}

/** Count the text characters and inline images in one serialized message. */
function countContent(content: readonly ContentBlock[], acc: { chars: number; images: number }): void {
  for (const block of content) {
    switch (block.type) {
      case 'text': acc.chars += block.text.length; break
      case 'reasoning': acc.chars += block.text.length; break
      case 'tool-call': acc.chars += block.name.length + block.arguments.length; break
      case 'image': acc.images += 1; break
      case 'file': acc.chars += block.attachment.name.length; break
      // tool-addition / tool-removal: negligible representation
      default: break
    }
  }
}

/**
 * Estimate the input tokens a whole request will consume, from its messages,
 * initial system prompt, and tool declarations. This is a pacing estimate only:
 * true usage is reconciled from the provider's reported usage. It reads only
 * each message's content blocks, so any message-shaped value — a full harness
 * message or a minimal `{ content }` — is accepted.
 * @param messages - the conversation messages.
 * @param system - the initial system prompt text, when set.
 * @param tools - tool declarations, when any.
 */
export function estimateRequestInputTokens(
  messages: readonly MessageContent[],
  system?: string,
  tools?: readonly ToolSchema[],
): number {
  const acc = { chars: system?.length ?? 0, images: 0 }
  for (const message of messages) countContent(message.content, acc)
  for (const tool of tools ?? []) acc.chars += tool.name.length + tool.description.length + JSON.stringify(tool.parameters).length
  // images counted per occurrence across messages
  return estimateInputTokens(acc.chars, acc.images)
}

/**
 * Process-wide rate limiter keyed by provider route and model id. All calls to
 * the same provider+model share one budget, regardless of which session issued
 * them. The instance is held by the single adapter instance, whose apply runs
 * once per process, so this is global across every chat in that process.
 */
export class ModelRateLimiter {
  private readonly limiters = new Map<string, ModelLimiter>()

  private key(provider: string, model: string): string {
    return `${provider}\u0000${model}`
  }

  private limiter(
    provider: string,
    model: string,
    limits: ModelRateLimit | undefined,
    nowMs: number,
  ): ModelLimiter | undefined {
    if (limits === undefined) return undefined
    let entry = this.limiters.get(this.key(provider, model))
    if (entry === undefined) {
      entry = {}
      if (limits.rpm !== undefined && limits.rpm > 0) {
        entry.rpm = new TokenBucket(limits.rpm, limits.rpm / 60, nowMs)
        entry.rpmLimit = limits.rpm
      }
      if (limits.tpm !== undefined && limits.tpm > 0) {
        entry.tpm = new TokenBucket(limits.tpm, limits.tpm / 60, nowMs)
        entry.tpmLimit = limits.tpm
      }
      this.limiters.set(this.key(provider, model), entry)
    }
    return entry
  }

  /**
   * Wait until both the RPM and TPM budgets have room for a call to this model.
   * Reserves the RPM slot and the input-token estimate once both fit, so no
   * other caller can steal the slot during the wait. Never fails on full
   * budgets — it queues for at most a rolling minute. Returns the input tokens
   * reserved, so the caller can settle them against real usage later.
   * @param provider - provider route.
   * @param model - model id.
   * @param limits - configured limits for this model, when any.
   * @param inputTokens - estimated input-token reservation.
   * @param signal - caller cancellation; an aborted wait rejects with the signal reason.
   * @returns the reserved input token count (0 when no TPM limit applies).
   */
  async acquire(
    provider: string,
    model: string,
    limits: ModelRateLimit | undefined,
    inputTokens: number,
    signal?: AbortSignal,
  ): Promise<number> {
    const entry = this.limiter(provider, model, limits, Date.now())
    if (entry === undefined) return 0
    // Loop until both buckets accept the reservation. Each iteration recomputes
    // the wait from the current state, so a competing caller only delays us.
    for (;;) {
      const now = Date.now()
      const rpmWait = entry.rpm === undefined ? 0 : entry.rpm.waitMs(1, now)
      const tpmWait = entry.tpm === undefined ? 0 : entry.tpm.waitMs(inputTokens, now)
      const wait = Math.max(rpmWait, tpmWait)
      if (wait === 0) {
        entry.rpm?.reserve(1, now)
        entry.tpm?.reserve(inputTokens, now)
        return entry.tpm === undefined ? 0 : inputTokens
      }
      await delay(wait, signal)
    }
  }

  /**
   * Settle the TPM budget after a response reports its real usage. The
   * pre-dispatch reservation was an estimate; this refunds an over-estimate or
   * charges the deficit of an underestimate against the budget.
   * @param provider - provider route.
   * @param model - model id.
   * @param limits - configured limits for this model, when any.
   * @param reservedInput - input tokens reserved at dispatch (0 if no TPM limit).
   * @param actualInput - input tokens from the response usage.
   * @param actualOutput - output tokens from the response usage.
   */
  settle(
    provider: string,
    model: string,
    limits: ModelRateLimit | undefined,
    reservedInput: number,
    actualInput: number,
    actualOutput: number,
  ): void {
    if (limits?.tpm === undefined || limits.tpm <= 0) return
    const entry = this.limiters.get(this.key(provider, model))
    if (entry?.tpm === undefined) return
    const now = Date.now()
    const actual = actualInput + actualOutput
    if (reservedInput >= actual) {
      entry.tpm.refund(reservedInput - actual, now)
    } else {
      entry.tpm.reserve(actual - reservedInput, now)
    }
  }

  /**
   * Release a reservation for a call that never produced usage (aborted or
   * failed before the response). Returns the RPM slot and the TPM reservation,
   * so a denied or cancelled call does not consume the budget.
   * @param provider - provider route.
   * @param model - model id.
   * @param reservedInput - input tokens reserved at dispatch.
   */
  release(provider: string, model: string, reservedInput: number): void {
    const entry = this.limiters.get(this.key(provider, model))
    if (entry === undefined) return
    const now = Date.now()
    entry.rpm?.refund(1, now)
    if (reservedInput > 0) entry.tpm?.refund(reservedInput, now)
  }
}
