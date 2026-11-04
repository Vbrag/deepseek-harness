import { describe, expect, it } from 'vitest'
import type { ModelCapability } from '../src/capabilities.ts'
import {
  bestCapabilityMatch,
  capabilityOf,
  capabilitySimilarity,
  coversModalities,
  domainScore,
  fitsContext,
  PADERBORN_CATALOG,
  underRateBudget,
} from '../src/capabilities.ts'

describe('PADERBORN_CATALOG', () => {
  it('contains only routeable chat entries', () => {
    expect(PADERBORN_CATALOG.length).toBeGreaterThan(10)
    for (const entry of PADERBORN_CATALOG) {
      expect(entry.health).toBe('routeable')
      expect(entry.id).toMatch(/^\S+$/)
    }
  })

  it('exposes known models with their capability facts', () => {
    const coding = capabilityOf('gwdg.glm-5.3-flash')
    expect(coding?.domains).toContain('coding')
    const reasoning = capabilityOf('gwdg.deepseek-v4-flash-0731')
    expect(reasoning?.reasoning).toBe(true)
    const vision = capabilityOf('hs-de.qwen3.8-27b')
    expect(vision?.imageInput).toBe(true)
  })

  it('returns undefined for an unknown model', () => {
    expect(capabilityOf('does-not-exist')).toBeUndefined()
  })
})

describe('domainScore', () => {
  const vision = capabilityOf('hs-de.qwen3.8-27b')! // imageInput true, vision domain
  const textOnly = capabilityOf('gwdg.deepseek-v4-flash-0731')! // no image input
  const coding = capabilityOf('gwdg.glm-5.3-flash')! // coding only
  const reasoning = capabilityOf('gwdg.deepseek-v4-flash-0731')! // reasoning

  it('scores a vision task for a vision model above a text-only model', () => {
    expect(domainScore(vision, 'vision')).toBeGreaterThan(domainScore(textOnly, 'vision'))
  })

  it('scores a coding task highest for an explicit coding model', () => {
    expect(domainScore(coding, 'coding')).toBe(2)
    expect(domainScore(reasoning, 'coding')).toBe(1) // partial via reasoning
    expect(domainScore(textOnly, 'vision')).toBe(0)
  })

  it('scores an image-capable non-vision model as a lesser vision match', () => {
    const imageWithoutVision: ModelCapability = {
      id: 'synthetic.image-intake-only',
      name: 'Synthetic image intake',
      imageInput: true,
      reasoning: false,
      domains: ['allrounder'],
      modalities: ['text', 'image'],
      contextWindow: 8_192,
      health: 'routeable',
      suggested: 'synthetic model with image input but no vision tag',
    }
    // Image input alone earns 2 even when the domains list omits 'vision'.
    expect(domainScore(imageWithoutVision, 'vision')).toBe(2)
  })
})

describe('capabilitySimilarity', () => {
  it('counts shared domains plus image agreement', () => {
    const a = capabilityOf('hs-de.qwen3.8-27b')!
    const b = capabilityOf('gwdg.qwen3.5-397b-a17b')!
    const similarity = capabilitySimilarity(a, b)
    // Both are reasoning+coding+vision+allrounder with image input and text+image
    // modalities: 4 shared domains + 1 image agreement + 2 modality agreement.
    expect(similarity).toBe(7)
  })
})

describe('bestCapabilityMatch', () => {
  const candidates = ['gwdg.glm-5.3-flash', 'gwdg.deepseek-v4-flash-0731', 'hs-de.qwen3.8-27b']
    .map(id => capabilityOf(id)!)
  const routeable = (ids: readonly string[]) => ids.map(id => capabilityOf(id)!)

  it('picks the model that serves a required coding domain', () => {
    const best = bestCapabilityMatch(candidates, [], ['coding'])
    expect(best?.id).toBe('gwdg.glm-5.3-flash')
  })

  it('never returns a model already tried', () => {
    const best = bestCapabilityMatch(candidates, ['gwdg.glm-5.3-flash'], ['coding'])
    expect(best?.id).toBe('hs-de.qwen3.8-27b')
  })

  it('returns undefined when no candidate matches the required domain', () => {
    const textOnly = routeable(['gwdg.deepseek-v4-flash-0731', 'gwdg.meta-llama-3.1-8b-instruct'])
    expect(bestCapabilityMatch(textOnly, [], ['vision'])).toBeUndefined()
  })

  it('returns undefined for an empty usable set', () => {
    expect(bestCapabilityMatch([], [], ['coding'])).toBeUndefined()
  })

  it('prefers the broadest model when no domain is required', () => {
    const broad = bestCapabilityMatch(candidates, [], [])?.id
    expect(broad).toBe('hs-de.qwen3.8-27b')
  })
})

describe('modality and context helpers', () => {
  const omni = capabilityOf('gwdg.qwen3-omni-30b-a3b-instruct')!
  const textOnly = capabilityOf('gwdg.deepseek-v4-flash-0731')!

  it('coversModalities accepts every required modality the model serves', () => {
    expect(coversModalities(omni, ['text', 'audio', 'video'])).toBe(true)
    expect(coversModalities(textOnly, ['text'])).toBe(true)
    expect(coversModalities(textOnly, ['image'])).toBe(false)
  })

  it('fitsContext accepts input at or under the documented window', () => {
    expect(fitsContext(textOnly, 163_840)).toBe(true)
    expect(fitsContext(textOnly, 1_000_001)).toBe(false)
  })

  it('underRateBudget respects static rpm and tpm ceilings', () => {
    // deepseek-v4-flash: rpm 10, tpm 500_000 (evidence-backed catalog defaults).
    expect(underRateBudget(textOnly, 9, 0, 1_000)).toBe(true)
    expect(underRateBudget(textOnly, 10, 0, 1_000)).toBe(false)
    expect(underRateBudget(textOnly, 0, 499_000, 999)).toBe(true)
    expect(underRateBudget(textOnly, 0, 499_000, 2_000)).toBe(false)
    expect(underRateBudget(textOnly, 0, 500_000, 1)).toBe(false)
  })
})

describe('bestCapabilityMatch routing options', () => {
  const omni = capabilityOf('gwdg.qwen3-omni-30b-a3b-instruct')!
  const image = capabilityOf('hs-de.qwen3.8-27b')!
  const textOnly = capabilityOf('gwdg.deepseek-v4-flash-0731')!
  const candidates = [omni, image, textOnly]

  it('requires every requested modality from the chosen model', () => {
    const chosen = bestCapabilityMatch(candidates, [], [], { requiredModalities: ['audio'] })
    expect(chosen?.id).toBe('gwdg.qwen3-omni-30b-a3b-instruct')
  })

  it('requires the context window to fit the step tokens', () => {
    const small = capabilityOf('hs-de.eurollm-22b-instruct-2512')! // 32_000 window
    const textOnly = capabilityOf('gwdg.deepseek-v4-flash-0731')! // 1_000_000 window
    const chosen = bestCapabilityMatch([small, textOnly], [], [], { contextTokens: 100_000 })
    expect(chosen?.id).toBe('gwdg.deepseek-v4-flash-0731')
  })

  it('excludes an explicitly unavailable (rate-limited) model', () => {
    const chosen = bestCapabilityMatch(candidates, [], [], { unavailable: ['gwdg.qwen3-omni-30b-a3b-instruct'] })
    expect(chosen).not.toBe(omni)
  })

  it('excludes a model whose run attempts reached its rpm ceiling', () => {
    // deepseek-v4-flash rpm = 60; a budget already at 60 attempts makes it ineligible.
    const budget = { 'gwdg.deepseek-v4-flash-0731': { attempts: 60, tokens: 0 } }
    const chosen = bestCapabilityMatch([textOnly], [], [], { budget })
    expect(chosen).toBeUndefined()
  })
})
