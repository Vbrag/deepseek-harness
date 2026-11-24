import { brandString } from '@deepseek-ai/dsh-brand'
import { describe, expect, it } from 'vitest'
import type { LlmBillingBudgetId } from '../src/index.ts'
import { LlmBillingHealth } from '../src/billing-health.ts'

describe('shared billing health', () => {
  it('blocks a shared exhausted budget while permitting known-free and independent routes', () => {
    const health = new LlmBillingHealth()
    const exhausted = brandString<LlmBillingBudgetId>('exhausted')
    const independent = brandString<LlmBillingBudgetId>('independent')
    const failure = health.begin()
    expect(health.available({ budgetId: independent })).toBe(false)
    expect(health.available({ free: true })).toBe(true)
    failure.record({ budgetId: exhausted })
    failure.dispose()
    expect(health.available({ budgetId: exhausted })).toBe(false)
    expect(health.available({ budgetId: independent })).toBe(true)
    expect(health.available(undefined)).toBe(false)
  })

  it('does not restore an old observation after reset', () => {
    const health = new LlmBillingHealth()
    const failure = health.begin()
    health.reset()
    failure.record(undefined)
    failure.dispose()
    expect(health.restricted()).toBe(false)
    expect(health.available(undefined)).toBe(true)
  })
})
