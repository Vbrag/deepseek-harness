/** Process-local observations of exhausted model billing budgets. */
import type { LlmBillingBudgetId, LlmResolvedModelInfo } from './types.ts'

/** One pending billing observation. Dispose it after recording or abandoning the result. */
export interface BillingHealthObservation {
  /** Record exhausted billing facts, or an unknown scope. @param billing - Captured route billing facts. */
  record(billing: LlmResolvedModelInfo['billing']): void
  /** Release the pending observation. Repeated calls have no effect. */
  dispose(): void
}

/** Billing failures shared by model consumers using one LLM runtime. */
export class LlmBillingHealth {
  private readonly exhausted = new Set<LlmBillingBudgetId>()
  private unscoped = false
  private pending = 0
  private generation = 0

  /** Whether failures currently restrict paid or unknown routes. @returns The current restriction state. */
  restricted(): boolean {
    return this.unscoped || this.pending > 0 || this.exhausted.size > 0
  }

  /** Check a route against known failures. @param billing - Captured route facts. @returns Whether dispatch is allowed. */
  available(billing: LlmResolvedModelInfo['billing']): boolean {
    if (billing?.free === true) return true
    if (this.unscoped || this.pending > 0) return false
    if (this.exhausted.size === 0) return true
    return billing?.budgetId !== undefined && !this.exhausted.has(billing.budgetId)
  }

  /** Begin a failure observation; pending observations conservatively restrict unknown paid routes. @returns The observation. */
  begin(): BillingHealthObservation {
    const generation = this.generation
    let active = true
    this.pending++
    return {
      record: (billing) => {
        if (!active || generation !== this.generation) return
        if (billing?.budgetId === undefined) this.unscoped = true
        else this.exhausted.add(billing.budgetId)
      },
      dispose: () => {
        if (!active) return
        active = false
        if (generation === this.generation) this.pending--
      },
    }
  }

  /** Clear observations after the account has been corrected. */
  reset(): void {
    this.generation++
    this.pending = 0
    this.unscoped = false
    this.exhausted.clear()
  }
}
