/**
 * Regressions for the Uni Paderborn AI-Gateway deployment-profile sync
 * generator (scripts/gen-upb-profile.ts): the derived `models` list must equal
 * the shipped chat catalogue, and applying it to a profile patch must replace
 * only the route's `models` nodes while preserving the rest of the document.
 *
 * @module dsh-llm-pi-ai/tests/gen-upb-profile.spec
 */
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  UPB_PROFILE_PLUGIN,
  UPB_PROFILE_ROUTE,
  applyModelsToPatch,
  profileModels,
  type UpbProfileModel,
} from '../scripts/gen-upb-profile.ts'
import { upbEntryOf } from '../src/upb-gateway-catalog.ts'

/** The single conservative pacing scalar the shipped route uses: range → lower bound. */
function paced(quota: readonly number[] | 'none' | undefined): number | undefined {
  if (quota === undefined || quota === 'none' || quota.length === 0) return undefined
  return Math.min(...quota)
}

/**
 * The shipped per-request output cap: the published output maximum lowered to
 * the gateway's per-minute token share, so one request cannot reserve the whole
 * minute. Derived here from catalogue facts rather than from the shipped route.
 */
function requestCap(entry: NonNullable<ReturnType<typeof upbEntryOf>>): number {
  const tpm = paced(entry.tpm)
  const maxOutput = entry.maxOutputTokens ?? 0
  if (tpm === undefined || entry.maxParallel === undefined || entry.maxParallel <= 0) return maxOutput
  return Math.min(maxOutput, Math.floor(tpm / entry.maxParallel))
}

/** The three gateway `(Test)` chat listings the generator must keep shipping. */
const TEST_IDS = [
  'gwdg.deepseek-v4.1-flash-1017',
  'gwdg.glm-5.3',
  'gwdg.mistral-large-4-1t-a52b',
]

describe('gen-upb-profile: catalogue derivation', () => {
  it('derives the 19 shipped chat models, including all three (Test) listings', () => {
    const models = profileModels()
    expect(models).toHaveLength(19)
    expect(new Set(models.map(m => m.id)).size).toBe(models.length)
    for (const id of TEST_IDS) {
      expect(models.map(m => m.id), id).toContain(id)
    }
  })

  it('carries catalogue ceilings, the gateway-admissible request cap, and paced budgets', () => {
    for (const model of profileModels()) {
      const entry = upbEntryOf(model.id)
      expect(entry, model.id).toBeDefined()
      expect(model.name).toBe(entry!.name)
      expect(model.contextWindow).toBe(entry!.maxInputTokens)
      expect(model.maxTokens).toBe(requestCap(entry!))
      expect(model.maxTokens).toBeLessThanOrEqual(entry!.maxOutputTokens ?? 0)
      expect(model.rpm).toBe(paced(entry!.rpm))
      expect(model.tpm).toBe(paced(entry!.tpm))
      expect(model.free).toBe(true)
    }
  })

  it('maps the Vision badge to image input and leaves text-only models text-only', () => {
    const byId = new Map(profileModels().map(m => [m.id, m as UpbProfileModel]))
    expect(byId.get('gwdg.deepseek-v4.1-flash-1017')?.input).toEqual(['text', 'image'])
    expect(byId.get('gwdg.mistral-large-4-1t-a52b')?.input).toEqual(['text', 'image'])
    expect(byId.get('gwdg.glm-5.3')?.input).toBeUndefined()
  })
})

describe('gen-upb-profile: patch application', () => {
  const provider = `
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      uni-paderborn:
        apiKeyEnv: UNI_PADERBORN_API_KEY
        api: openai-completions
        baseURL: https://ai-gateway.uni-paderborn.de/v1/
        retryPolicy:
          mode: normal
          maxRetries: 30
        models:
          - id: gwdg.deepseek-v4-flash-0731
            name: Stale hand-maintained name
            contextWindow: 512000
            maxTokens: 256000
            reasoningEfforts:
              off: null
              low: low
              medium: medium
              high: high
          - id: kept-gone-example
            name: Not in catalogue
      uni-paderborn-responses:
        displayName: AI-Gateway (Responses)
`
  const otherRow = `
- id: ui-theme
  name: '@deepseek-ai/dsh-client-ui-theme'
  config:
    preference: dark
`

  it('replaces only the target route models and preserves deployment-only fields and other rows', () => {
    const { text, changed } = applyModelsToPatch(provider + otherRow, UPB_PROFILE_ROUTE, profileModels())
    expect(changed).toBe(true)
    expect(text).toContain("preference: dark")
    expect(text).toContain('UNI_PADERBORN_API_KEY')
    expect(text).toContain('retryPolicy')
    // A sibling provider route is left untouched.
    expect(text).toContain('uni-paderborn-responses')
    // The stale example model is gone; the shipped set is present.
    expect(text).not.toContain('kept-gone-example')
    expect(text).toContain('gwdg.deepseek-v4.1-flash-1017')
    expect(text).toContain('gwdg.mistral-large-4-1t-a52b')
  })

  it('updates catalogue facts while keeping deployment-owned per-model fields', () => {
    const { text } = applyModelsToPatch(provider, UPB_PROFILE_ROUTE, profileModels())
    const row = parse(text).find((entry: { id?: string }) => entry.id === UPB_PROFILE_PLUGIN)
    const models = row.config.providers[UPB_PROFILE_ROUTE].models as Record<string, unknown>[]
    const flash = models.find(model => model['id'] === 'gwdg.deepseek-v4-flash-0731')
    const entry = upbEntryOf('gwdg.deepseek-v4-flash-0731')!
    // Catalogue-owned facts win: the stale name and capacities are corrected,
    // and the stale 256,000-token request cap becomes the gateway-admissible
    // one instead of the published 384,000-token output maximum.
    expect(flash?.['name']).toBe(entry.name)
    expect(flash?.['contextWindow']).toBe(entry.maxInputTokens)
    expect(flash?.['maxTokens']).toBe(requestCap(entry))
    expect(flash?.['maxTokens']).not.toBe(entry.maxOutputTokens)
    // A saved reasoning selection survives: dropping its levels makes the model
    // reject the effort the session already stored.
    expect(flash?.['reasoningEfforts']).toEqual({ off: null, low: 'low', medium: 'medium', high: 'high' })
  })

  it('reports no change once the list already matches, and is idempotent', () => {
    const first = applyModelsToPatch(provider, UPB_PROFILE_ROUTE, profileModels())
    const second = applyModelsToPatch(first.text, UPB_PROFILE_ROUTE, profileModels())
    expect(first.changed).toBe(true)
    expect(second.changed).toBe(false)
    expect(second.text).toBe(first.text)
  })

  it('rejects a patch with no llm-pi-ai row', () => {
    expect(() => applyModelsToPatch(otherRow, UPB_PROFILE_ROUTE, profileModels()))
      .toThrowError(new RegExp(`no "${UPB_PROFILE_PLUGIN}" row`))
  })

  it('targets the deployment chat route key by default', () => {
    expect(UPB_PROFILE_ROUTE).toBe('uni-paderborn')
  })
})
