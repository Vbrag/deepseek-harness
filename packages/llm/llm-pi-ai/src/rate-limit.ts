/** Adapter-owned rolling-minute request and token accounting, shared by advisory queries and dispatch. */

import { LlmError } from '@deepseek-ai/dsh-llm'
import type { LlmQueueAvailability } from '@deepseek-ai/dsh-llm'
import type { ModelRateLimit } from './catalog.ts'

export { estimateInputTokens, estimateRequestInputTokens } from '@deepseek-ai/dsh-llm/input-estimate'

const WINDOW_MS = 60_000

interface Charge {
  requestAt: number
  tokenAt: number
  tokens: number
  dispatched: boolean
  pending: boolean
}

interface ModelLedger {
  readonly charges: Set<Charge>
  readonly waiters: Set<() => void>
}

/** One request's reservation; release is valid only before dispatch. */
export interface ModelRateReservation {
  /** Mark the request as dispatched before invoking the provider transport. */
  dispatch(): void
  /** Replace the estimate with actual usage, or retain it when usage is unknown.
   * @param actualTokens - Reported full-call tokens; omission preserves the estimate.
   */
  settle(actualTokens?: number): void
  /** Return an undispatched request's RPM and token reservations. */
  release(): void
}

/** Wait for capacity to change, the rolling window to advance, or caller cancellation. */
function waitForChange(ledger: ModelLedger, ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer)
      ledger.waiters.delete(onChange)
      signal?.removeEventListener('abort', onAbort)
    }
    const onChange = (): void => {
      cleanup()
      resolve()
    }
    const onAbort = (): void => {
      cleanup()
      const reason: unknown = signal?.reason
      reject(reason instanceof Error ? reason : new LlmError('rate-limit wait aborted', 'ABORTED', { cause: reason }))
    }
    const timer = setTimeout(onChange, ms)
    ledger.waiters.add(onChange)
    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Rolling-minute ledger owned by one adapter instance. Requests to the same
 * provider/model share charges across sessions; separate instances remain independent.
 * Limits are applied when inspected, so configuration changes retain prior charges.
 */
export class ModelRateLimiter {
  private readonly ledgers = new Map<string, ModelLedger>()

  private key(provider: string, model: string, budgetKey?: string): string {
    // An explicit shared-budget identity lets several route keys (which each
    // otherwise get their own ledger) charge the same gateway model's quota
    // together; without it the route key and model identify the ledger.
    return budgetKey ?? `${provider}\u0000${model}`
  }

  private ledger(provider: string, model: string, budgetKey?: string): ModelLedger {
    const key = this.key(provider, model, budgetKey)
    let ledger = this.ledgers.get(key)
    if (ledger === undefined) {
      ledger = { charges: new Set(), waiters: new Set() }
      this.ledgers.set(key, ledger)
    }
    return ledger
  }

  /**
   * Inspect admission without reserving capacity. Active calls retain their token
   * estimate until settlement; actual usage remains charged for a minute afterward.
   * @param provider - provider route.
   * @param model - exact model id.
   * @param limits - currently effective limits.
   * @param tokens - estimated input plus output allowance.
   * @param budgetKey - optional shared-budget identity overriding the route+model ledger key.
   * @returns current advisory admission state.
   */
  availability(provider: string, model: string, limits: ModelRateLimit | undefined, tokens: number, budgetKey?: string): LlmQueueAvailability {
    limits ??= {}
    if (limits.tpm !== undefined && tokens > limits.tpm) {
      return { kind: 'impossible', estimatedTokens: tokens, tokenLimit: limits.tpm }
    }
    const ledger = this.ledger(provider, model, budgetKey)
    const now = Date.now()
    let requests = 0
    let chargedTokens = 0
    const expirations: Array<{ at: number; requests: number; tokens: number }> = []
    for (const charge of ledger.charges) {
      const requestLive = charge.requestAt + WINDOW_MS > now
      const tokensLive = charge.pending || charge.tokenAt + WINDOW_MS > now
      if (!requestLive && !tokensLive) {
        ledger.charges.delete(charge)
        continue
      }
      if (requestLive) {
        requests += 1
        expirations.push({ at: charge.requestAt + WINDOW_MS, requests: 1, tokens: 0 })
      }
      if (tokensLive) {
        chargedTokens += charge.tokens
        if (!charge.pending) expirations.push({ at: charge.tokenAt + WINDOW_MS, requests: 0, tokens: charge.tokens })
      }
    }
    if (limits.rpm === undefined && limits.tpm === undefined) return { kind: 'unknown' }
    const fits = (): boolean => (limits.rpm === undefined || requests + 1 <= limits.rpm)
      && (limits.tpm === undefined || chargedTokens + tokens <= limits.tpm)
    if (fits()) return { kind: 'ready' }
    expirations.sort((a, b) => a.at - b.at)
    for (const expiry of expirations) {
      requests -= expiry.requests
      chargedTokens -= expiry.tokens
      if (fits()) return { kind: 'wait', waitMs: Math.max(1, expiry.at - now) }
    }
    return { kind: 'wait', waitMs: WINDOW_MS }
  }

  /**
   * Wait for and atomically reserve both request and token capacity.
   * @param provider - provider route.
   * @param model - exact model id.
   * @param limits - effective limits for this prepared request.
   * @param tokens - estimated input plus output allowance.
   * @param signal - cancellation before dispatch.
   * @param budgetKey - optional shared-budget identity overriding the route+model ledger key.
   * @returns the exact request reservation; oversized requests reject immediately.
   */
  async acquire(
    provider: string,
    model: string,
    limits: ModelRateLimit | undefined,
    tokens: number,
    signal?: AbortSignal,
    budgetKey?: string,
  ): Promise<ModelRateReservation> {
    const ledger = this.ledger(provider, model, budgetKey)
    for (;;) {
      signal?.throwIfAborted()
      const availability = this.availability(provider, model, limits, tokens, budgetKey)
      if (availability.kind === 'impossible') {
        throw new LlmError(
          `provider "${provider}" model "${model}" needs an estimated ${tokens} tokens, exceeding its ${availability.tokenLimit} TPM limit; reduce the request or output allowance`,
          'RATE_LIMIT_REQUEST_TOO_LARGE',
        )
      }
      if (availability.kind !== 'wait') break
      await waitForChange(ledger, availability.waitMs, signal)
    }
    const now = Date.now()
    const charge: Charge = { requestAt: now, tokenAt: now, tokens, dispatched: false, pending: true }
    ledger.charges.add(charge)
    const notify = (): void => {
      for (const wake of [...ledger.waiters]) wake()
    }
    return {
      dispatch: () => {
        charge.dispatched = true
        charge.requestAt = Date.now()
      },
      settle: (actualTokens) => {
        if (!charge.pending) return
        charge.tokens = actualTokens ?? charge.tokens
        charge.tokenAt = Date.now()
        charge.pending = false
        notify()
      },
      release: () => {
        if (charge.dispatched) return
        charge.pending = false
        ledger.charges.delete(charge)
        notify()
      },
    }
  }
}
