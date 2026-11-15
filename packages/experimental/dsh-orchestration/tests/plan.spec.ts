import { describe, expect, it } from 'vitest'
import { ReasoningEffortId, type LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import { capabilityRoute, routeFits, selectReadyRoute } from '../src/plan.ts'
import { capabilityOf, POOL_PROVIDER } from '../src/capabilities.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface ModelModalityMap {
    audio: 'audio'
  }
}

const code = { provider: POOL_PROVIDER, model: 'gwdg.glm-5.3-flash' }
const vision = { provider: POOL_PROVIDER, model: 'gwdg.gemma-4-31b-it' }
function info(route = code, extra: Partial<LlmResolvedModelInfo> = {}): LlmResolvedModelInfo {
  return { provider: route.provider, id: route.model, name: route.model, ...extra }
}

describe('strict route capability filtering', () => {
  it('requires coding explicitly instead of accepting reasoning as a substitute', () => {
    const route = { provider: POOL_PROVIDER, model: 'gwdg.deepseek-v4-flash-0731' }
    const resolved = capabilityRoute(route, info(route), [])
    expect(routeFits(resolved, { requiredCapabilities: ['coding'], contextTokens: 1 }, 1, 1)).toBe(false)
    expect(routeFits(resolved, { requiredCapabilities: ['reasoning'], contextTokens: 1 }, 1, 1)).toBe(true)
  })

  it('requires every specialty and expected modality, including images captured later', () => {
    const resolved = capabilityRoute(code, info(), [])
    expect(routeFits(resolved, {
      requiredCapabilities: ['coding', 'vision'], requiredModalities: ['text', 'image'], contextTokens: 1,
    }, 1, 1)).toBe(false)
    expect(routeFits(resolved, {
      requiredCapabilities: ['coding'], requiredModalities: ['image'], contextTokens: 1,
    }, 1, 1)).toBe(false)
  })

  it('uses exact text-only and context metadata over curated gateway facts', () => {
    const resolved = capabilityRoute(vision, info(vision, { inputModalities: ['text'], context: { contextWindow: 100 } }), [])
    expect(resolved.capabilities).not.toContain('vision')
    expect(routeFits(resolved, { requiredCapabilities: [], contextTokens: 1 }, 90, 10)).toBe(true)
    expect(routeFits(resolved, { requiredCapabilities: [], contextTokens: 1 }, 91, 10)).toBe(false)
  })

  it('requires enough response capacity even when the combined context window is large', () => {
    const resolved = capabilityRoute(code, info(code, {
      context: { contextWindow: 1_000_000 }, maxOutputTokens: 256,
    }), [])
    expect(routeFits(resolved, { requiredCapabilities: ['coding'], contextTokens: 100 }, 100, 257)).toBe(false)
    expect(routeFits(resolved, { requiredCapabilities: ['coding'], contextTokens: 100 }, 100, 256)).toBe(true)
  })

  it('excludes advertised modalities the current transport cannot carry', () => {
    const resolved = capabilityRoute(code, info(code, { inputModalities: ['text', 'audio'] }), [])
    expect(resolved.modalities).toEqual(['text'])
    expect(routeFits(resolved, {
      requiredCapabilities: [], requiredModalities: ['audio'], contextTokens: 1,
    }, 1, 1)).toBe(false)
  })

  it('does not apply gateway facts to another provider with the same model id', () => {
    const route = { ...code, provider: 'unrelated' }
    const unresolved = capabilityRoute(route, info(route), [])
    expect(unresolved.capabilities).toEqual([])
    expect(unresolved.contextWindow).toBeUndefined()
    const declared = capabilityRoute(route, info(route, {
      context: { contextWindow: 100 }, inputModalities: ['text'],
    }), [{ ...route, capabilities: ['coding'] }])
    expect(routeFits(declared, { requiredCapabilities: ['coding'], contextTokens: 1 }, 50, 50)).toBe(true)
  })

  it('treats an explicit empty specialty override as clearing curated skills', () => {
    expect(capabilityRoute(code, info(), [{ ...code, capabilities: [] }]).capabilities).toEqual([])
  })

  it('keeps absent metadata unknown and retains verified specialty facts', () => {
    expect(capabilityOf('missing')).toBeUndefined()
    const route = { provider: POOL_PROVIDER, model: 'gwdg.deepseek-v4-flash-0731' }
    expect(capabilityRoute(route, info(route), []).capabilities).toContain('reasoning')
    expect(capabilityRoute(code, info(code, {
      reasoning: { efforts: [{ id: ReasoningEffortId('high'), name: 'High' }] },
    }), []).capabilities).toContain('reasoning')
  })
})

describe('ready route ordering', () => {
  const a = capabilityRoute(code, info(), [])
  const b = capabilityRoute({ provider: POOL_PROVIDER, model: 'hs-de.qwen3.8-27b' },
    info({ provider: POOL_PROVIDER, model: 'hs-de.qwen3.8-27b' }), [])
  const task = { requiredCapabilities: ['coding'], contextTokens: 1 }

  it('ranks task fit before active load, then spreads equally capable assignments', () => {
    expect(selectReadyRoute([
      { route: a, active: 0, lastAssigned: 0 }, { route: b, active: 5, lastAssigned: 5 },
    ], { ...task, preferredCapabilities: ['vision'] })).toEqual({ route: b, reason: 'task-fit' })
    expect(selectReadyRoute([
      { route: a, active: 1, lastAssigned: 0 }, { route: b, active: 0, lastAssigned: 5 },
    ], task)).toEqual({ route: b, reason: 'active-load' })
    expect(selectReadyRoute([
      { route: a, active: 0, lastAssigned: 5 }, { route: b, active: 0, lastAssigned: 2 },
    ], task)).toEqual({ route: b, reason: 'diversity' })
    expect(selectReadyRoute([
      { route: a, active: 0, lastAssigned: 0 }, { route: b, active: 0, lastAssigned: 0 },
    ], task)).toEqual({ route: a, reason: 'pool-order' })
    expect(selectReadyRoute([], task)).toBeUndefined()
  })
})
