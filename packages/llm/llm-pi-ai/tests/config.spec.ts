import { describe, expect, it } from 'vitest'
import { assertServiceable, Config, resolveProfiles, type Options, type PiAiProviderProfile } from '../src/config.ts'

/** Validate one hand-declared route, with the caller's fields layered onto it. */
const routeWith = (profile: Record<string, unknown>): (() => unknown) =>
  () => ({ providers: Config({
    providers: {
      'acme-gateway': {
        api: 'openai-completions',
        baseURL: 'https://acme.test',
        models: [{ id: 'm' }],
        ...profile,
      },
    },
  }).providers.get() })

/** Validate that route with the caller's fields on its single model entry. */
const configWith = (model: Record<string, unknown>): (() => unknown) =>
  routeWith({ models: [{ id: 'm', ...model }] })

describe('reasoning schema boundary', () => {
  it('accepts an empty provider section and propagates unexpected catalog failures', () => {
    expect(() => { assertServiceable({}) }).not.toThrow()
    const failure = new TypeError('model metadata lookup failed')
    expect(() => resolveProfiles({ openrouter: { models: [{
      id: '111',
      get name(): string { throw failure },
    }], api: 'openai-completions' } }, 'deferred')).toThrow(failure)
  })

  it('rejects a level pi-ai does not know at the write that produced it', () => {
    expect(configWith({ reasoningEfforts: { ultra: 'x' } })).toThrow(/"off"/)
    expect(configWith({ reasoningEfforts: { high: 42 } })).toThrow()
  })

  it('keeps false distinguishable from an absent declaration', () => {
    type Materialized = { providers: Record<string, { models?: { reasoningEfforts?: unknown }[] }> }
    const withFalse = configWith({ reasoningEfforts: false })() as Materialized
    expect(withFalse.providers['acme-gateway']?.models?.[0]?.reasoningEfforts).toBe(false)
    const absent = configWith({})() as Materialized
    expect(absent.providers['acme-gateway']?.models?.[0]?.reasoningEfforts).toBeUndefined()
  })

  it('rejects a thinking format outside the offered set', () => {
    expect(configWith({ compat: { thinkingFormat: 'quantum' } })).toThrow(/expected/)
  })

  it('accepts Baseten template arguments and completion controls', () => {
    expect(configWith({
      compat: {
        supportsFinishReason: false,
        thinkingFormat: 'baseten',
        chatTemplateArgs: { enable_thinking: { $var: 'thinking.enabled' } },
        supportsThinkingTokenBudget: true,
      },
    })).not.toThrow()
  })
})

describe('modality schema boundary', () => {
  it('rejects a modality pi-ai does not know, at either level', () => {
    expect(configWith({ input: ['audio'] })).toThrow(/expected/)
    expect(routeWith({ defaultInput: ['text', 'audio'] })).toThrow(/expected/)
  })

  it('refuses a route whose models could accept nothing', () => {
    // The pair the settings seam runs: the schema accepts the empty list as
    // well-typed, and the namespace validator is what refuses it. Asserting
    // only the schema would report this route as writable.
    expect(routeWith({ defaultInput: [] })).not.toThrow()
    expect(() => { assertServiceable(routeWith({ defaultInput: [] })() as Options) })
      .toThrow(/defaultInput must name at least one modality/)
  })

  type Materialized = {
    providers: Record<string, { defaultInput?: unknown; models?: { input?: unknown }[] }>
  }

  it('materializes an absent entry list as empty and an absent route list as text', () => {
    // The empty-list inheritance rule exists because of exactly this: an entry
    // that declares nothing reaches resolution as `[]`, not as `undefined`.
    const absent = configWith({})() as Materialized
    expect(absent.providers['acme-gateway']?.models?.[0]?.input).toEqual([])
    expect(absent.providers['acme-gateway']?.defaultInput).toEqual(['text'])
  })
})

describe('request image policy bounds', () => {
  it.each([
    ['requestImagePixelBudget', 0, /requestImagePixelBudget must be a positive safe integer/],
    ['requestImagePixelBudget', Number.MAX_SAFE_INTEGER + 1, /requestImagePixelBudget must be a positive safe integer/],
    ['requestImageMaxBytes', 0, /requestImageMaxBytes must be a positive safe integer/],
    ['requestImageMaxBytes', 1.5, /requestImageMaxBytes must be a positive safe integer/],
  ] as const)('rejects %s=%s at service resolution', (field, value, message) => {
    const programmatic = {
      providers: {
        'acme-gateway': {
          api: 'openai-completions',
          baseURL: 'https://acme.test',
          models: [{ id: 'm' }],
          [field]: value,
        },
      },
    } as Options
    expect(() => {
      assertServiceable(programmatic)
    }).toThrow(message)
  })
})

describe('per-model pacing limits and billing', () => {
  it('carries rpm/tpm/free/pricing into the resolved profile', () => {
    const resolved = resolveProfiles({
      'acme-gateway': {
        api: 'openai-completions',
        baseURL: 'https://acme.test',
        models: [{
          id: 'm',
          rpm: 10,
          tpm: 500_000,
          free: true,
          pricing: { input: 1.25, output: 5 },
        }],
      },
    }, 'deferred')
    const profile = resolved.get('acme-gateway')
    expect(profile?.modelRateLimits.get('m')).toEqual({ rpm: 10, tpm: 500_000 })
    expect(profile?.modelBilling.get('m')).toEqual({ free: true, pricing: { input: 1.25, output: 5 } })
  })

  it('records only the limit fields a model declares', () => {
    const resolved = resolveProfiles({
      'acme-gateway': {
        api: 'openai-completions',
        baseURL: 'https://acme.test',
        models: [{ id: 'a', rpm: 5 }, { id: 'b', tpm: 1000 }, { id: 'c' }],
      },
    }, 'deferred')
    const profile = resolved.get('acme-gateway')
    expect(profile?.modelRateLimits.get('a')).toEqual({ rpm: 5 })
    expect(profile?.modelRateLimits.get('b')).toEqual({ tpm: 1000 })
    expect(profile?.modelRateLimits.get('c')).toBeUndefined()
  })

  it('accepts the new fields at the schema boundary', () => {
    expect(configWith({
      rpm: 10,
      tpm: 500_000,
      free: false,
      pricing: { input: 0.1, output: 0.5 },
    })).not.toThrow()
  })

  it('rejects a non-positive rpm/tpm at service resolution', () => {
    const provider = (rpm: number): PiAiProviderProfile => ({
      api: 'openai-completions',
      baseURL: 'https://acme.test',
      models: [{ id: 'm', rpm }],
    })
    const programmatic = { providers: { 'acme-gateway': provider(0) } } as Options
    expect(() => assertServiceable(programmatic)).toThrow(/positive integer/)
    expect(() => resolveProfiles({ 'acme-gateway': provider(0) })).toThrow(/positive integer/)
  })
})
