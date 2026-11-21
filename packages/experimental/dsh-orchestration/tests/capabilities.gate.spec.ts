/**
 * Consistency gate: the Orchestration gateway capability catalog must match the
 * canonical Uni Paderborn AI-Gateway catalogue in `@deepseek-ai/dsh-llm-pi-ai`.
 *
 * The canonical catalogue (`upb-gateway-catalog.ts`) is the single source of
 * truth for gateway model facts. `PADERBORN_CATALOG` keeps orchestration-only
 * preferences (task domains, health, suggested use, pool membership) but must
 * not restate stale factual columns. This spec fails CI the moment any gated
 * orchestration fact (name, image input, context window, per-minute rate
 * limits) drifts from the catalogue or names an id the catalogue does not list.
 *
 * @module dsh-orchestration/tests/capabilities.gate
 */
import { describe, expect, it } from 'vitest'
import { UPB_CHAT_ROUTE_MODELS } from '@deepseek-ai/dsh-llm-pi-ai/src/upb-gateway-catalog.ts'
import { upbEntryOf } from '@deepseek-ai/dsh-llm-pi-ai/src/upb-gateway-catalog.ts'
import { PADERBORN_CATALOG } from '../src/capabilities.ts'

/** Single conservative pacing scalar: a published range is pinned to its lower bound. */
function paced(quota: readonly number[] | 'none' | undefined): number | undefined {
  if (quota === undefined || quota === 'none' || quota.length === 0) return undefined
  return Math.min(...quota)
}

describe('PADERBORN_CATALOG matches the canonical gateway catalogue', () => {
  it('covers every shipped chat-route model', () => {
    const curated = new Set(PADERBORN_CATALOG.map(row => row.id))
    for (const entry of UPB_CHAT_ROUTE_MODELS) {
      expect(curated.has(entry.id), `chat-route model "${entry.id}" has no curated capability row`).toBe(true)
    }
  })

  it('every orchestration model id exists in the canonical catalogue', () => {
    for (const row of PADERBORN_CATALOG) {
      expect(upbEntryOf(row.id), `orchestration row "${row.id}" is not in UPB_GATEWAY_CATALOG`).toBeDefined()
    }
  })

  it('gated factual columns match the canonical catalogue (name, image input, context window, rate limits)', () => {
    for (const row of PADERBORN_CATALOG) {
      const entry = upbEntryOf(row.id)
      expect(entry, `no canonical entry for "${row.id}"`).toBeDefined()
      if (entry === undefined) continue
      expect(row.name, `name for "${row.id}"`).toBe(entry.name)
      expect(row.imageInput, `imageInput for "${row.id}"`).toBe(entry.badges.includes('Vision'))
      expect(row.contextWindow, `contextWindow for "${row.id}"`).toBe(entry.maxInputTokens)
      const rpm = paced(entry.rpm)
      const tpm = paced(entry.tpm)
      const expectedRateLimits = rpm === undefined && tpm === undefined
        ? undefined
        : { ...(rpm === undefined ? {} : { rpm }), ...(tpm === undefined ? {} : { tpm }) }
      expect(row.rateLimits, `rateLimits for "${row.id}"`).toEqual(expectedRateLimits)
    }
  })

  it('retains the orchestration pool provider routing', () => {
    // The pool provider is a fixed orchestration preference independent of the
    // catalogue; it must stay stable and every pooled model must be routeable.
    expect(PADERBORN_CATALOG.length).toBeGreaterThan(0)
    for (const row of PADERBORN_CATALOG) {
      expect(row.health, `health for "${row.id}"`).toBe('routeable')
      expect(row.domains.length, `domains for "${row.id}"`).toBeGreaterThan(0)
    }
  })
})
