import { describe, expect, it } from 'vitest'
import type { CapabilityRoute } from '../src/plan.ts'
import { capabilityRoutes, selectFailover, selectRoute, withinBudget } from '../src/plan.ts'
import { createStepId } from '../src/coordinator.ts'

const POOL = [
  { provider: 'paderborn', model: 'gwdg.deepseek-v4-flash-0731' }, // reasoning
  { provider: 'paderborn', model: 'gwdg.glm-5.3-flash' }, // coding
  { provider: 'paderborn', model: 'hs-de.qwen3.8-27b' }, // reasoning+coding+vision
  { provider: 'paderborn', model: 'gwdg.meta-llama-3.1-8b-instruct' }, // allrounder
] as const

describe('capabilityRoutes', () => {
  it('resolves catalog models and drops unknown ones', () => {
    const routes = capabilityRoutes([
      { provider: 'paderborn', model: 'gwdg.glm-5.3-flash' },
      { provider: 'paderborn', model: 'not-a-real-model' },
    ])
    expect(routes.map(r => r.model)).toEqual(['gwdg.glm-5.3-flash'])
    expect(routes[0]?.capability.imageInput).toBe(false)
  })
})

describe('selectRoute', () => {
  const routes = capabilityRoutes([...POOL])

  it('prefers the model that best matches the required domain', () => {
    expect(selectRoute(routes, { requiredDomains: ['coding'] }, [])?.model).toBe('gwdg.glm-5.3-flash')
  })

  it('assigns a no-domain step to the broadest model', () => {
    const selected = selectRoute(routes, { requiredDomains: [] }, [])?.model
    expect(['gwdg.glm-5.3-flash', 'hs-de.qwen3.8-27b']).toContain(selected)
  })

  it('excludes a model already tried', () => {
    const selected = selectRoute(routes, { requiredDomains: ['coding'] }, [{ model: 'gwdg.glm-5.3-flash' }])
    expect(selected?.model).toBe('hs-de.qwen3.8-27b')
  })

  it('excludes a route whose capability is not routeable', () => {
    const unhealthy: CapabilityRoute = {
      provider: 'paderborn',
      model: 'gwdg.unhealthy-entry',
      capability: {
        id: 'gwdg.unhealthy-entry',
        name: 'Unhealthy',
        imageInput: false,
        reasoning: false,
        domains: ['allrounder'],
        modalities: ['text'],
        contextWindow: 8_192,
        health: 'unhealthy',
        suggested: 'synthetic unhealthy model for route-eligibility coverage',
      },
    }
    // The only route is not routeable, so selection yields nothing usable.
    expect(selectRoute([unhealthy], { requiredDomains: [] }, [])).toBeUndefined()
  })

  it('returns undefined when the pool is exhausted', () => {
    const tried = routes.map(r => ({ model: r.model }))
    expect(selectRoute(routes, { requiredDomains: ['coding'] }, tried)).toBeUndefined()
  })

  it('returns undefined for an empty pool', () => {
    expect(selectRoute([], { requiredDomains: ['coding'] }, [])).toBeUndefined()
  })
})

describe('selectRoute routing options', () => {
  const omniPool = capabilityRoutes([
    { provider: 'paderborn', model: 'gwdg.qwen3-omni-30b-a3b-instruct' },
    { provider: 'paderborn', model: 'gwdg.deepseek-v4-flash-0731' },
  ])

  it('routes a step requiring audio only to an audio-capable model', () => {
    const next = selectRoute(omniPool, { requiredDomains: [], requiredModalities: ['audio'] }, [])
    expect(next?.model).toBe('gwdg.qwen3-omni-30b-a3b-instruct')
  })

  it('excludes models whose context window is too small for the step', () => {
    // EuroLLM (32_000) is too small for 100_000 tokens; deepseek-v4-flash (1_000_000) fits.
    const pool = capabilityRoutes([
      { provider: 'paderborn', model: 'hs-de.eurollm-22b-instruct-2512' },
      { provider: 'paderborn', model: 'gwdg.deepseek-v4-flash-0731' },
    ])
    const next = selectRoute(pool, { requiredDomains: [], contextTokens: 100_000 }, [])
    expect(next?.model).toBe('gwdg.deepseek-v4-flash-0731')
  })

  it('excludes an explicitly unavailable (rate-limited) route', () => {
    const next = selectRoute(
      omniPool,
      { requiredDomains: [], requiredModalities: ['audio'] },
      [],
      { unavailable: ['gwdg.qwen3-omni-30b-a3b-instruct'] },
    )
    expect(next).toBeUndefined()
  })

  it('excludes a route whose run attempts reached its rpm ceiling', () => {
    // deepseek-v4-flash rpm = 10; budget already at 10 makes it unusable.
    const pool = capabilityRoutes([{ provider: 'paderborn', model: 'gwdg.deepseek-v4-flash-0731' }])
    const next = selectRoute(pool, { requiredDomains: [] }, [], { budget: { 'gwdg.deepseek-v4-flash-0731': { attempts: 10 } } })
    expect(next).toBeUndefined()
  })
})

describe('selectRoute load-balanced distribution', () => {
  const routes = capabilityRoutes([...POOL])

  it('spreads same-domain steps across the top capability matches', () => {
    // Both glm (coding) and qwen (coding) score 2 for a coding step; the shared
    // per-run assignment counter pushes the second step onto the other model.
    const assigned: Record<string, number> = {}
    const first = selectRoute(routes, { requiredDomains: ['coding'] }, [], { assigned })
    expect(first).toBeDefined()
    if (first !== undefined) assigned[first.model] = 1
    const second = selectRoute(routes, { requiredDomains: ['coding'] }, [], { assigned })
    expect(second?.model).not.toBe(first?.model)
  })

  it('round-robins no-domain steps across the usable pool', () => {
    // With no domain requirement every usable route is acceptable, so repeated
    // first selections rotate through the pool instead of piling on the broadest.
    const assigned: Record<string, number> = {}
    const seen = new Set<string>()
    for (let i = 0; i < routes.length; i += 1) {
      const selected = selectRoute(routes, { requiredDomains: [] }, [], { assigned })
      expect(selected).toBeDefined()
      if (selected === undefined) break
      seen.add(selected.model)
      assigned[selected.model] = (assigned[selected.model] ?? 0) + 1
    }
    // Every pool model is used once before any is used twice.
    expect(seen.size).toBe(routes.length)
  })

  it('keeps capability-best selection without an assignment signal', () => {
    // A single step with no shared assignment counter still routes to the
    // capability-best model for its domain.
    expect(selectRoute(routes, { requiredDomains: ['coding'] }, [])?.model).toBe('gwdg.glm-5.3-flash')
  })
})

describe('selectFailover', () => {
  const routes = capabilityRoutes([...POOL])

  it('switches to the most capability-similar untried model after a failure', () => {
    const failed = 'gwdg.glm-5.3-flash' // coding
    const next = selectFailover(routes, failed, { requiredDomains: ['coding'] }, [{ model: failed }])
    expect(next?.model).toBe('hs-de.qwen3.8-27b')
  })

  it('falls back to the best domain match when no similar model overlaps', () => {
    const failed = 'gwdg.meta-llama-3.1-8b-instruct' // no coding domain
    const next = selectFailover(routes, failed, { requiredDomains: ['coding'] }, [{ model: failed }])
    expect(next?.model).toBe('gwdg.glm-5.3-flash')
  })

  it('treats an unresolved failed model as having no capability similarity', () => {
    // An unknown failed model yields no capability facts, so similarity is 0 for
    // every route and the selection sorts purely by domain.
    const failed = 'not-a-real-model'
    const next = selectFailover(routes, failed, { requiredDomains: ['coding'] }, [{ model: failed }])
    expect(['gwdg.glm-5.3-flash', 'hs-de.qwen3.8-27b']).toContain(next?.model)
  })

  it('returns undefined when no untried route serves the domain and none is similar', () => {
    // The failed model is image-capable (no 'coding' tag) while the only untried
    // route is a text-only coding model: it neither serves 'vision' nor shares
    // any domain or image agreement with the failed model.
    const single = capabilityRoutes([{ provider: 'paderborn', model: 'gwdg.glm-5.3-flash' }])
    const next = selectFailover(single, 'gwdg.qwen3.6-35b-a3b-no-think', { requiredDomains: ['vision'] }, [])
    expect(next).toBeUndefined()
  })

  it('returns undefined when no domain is required and the failed model is unknown', () => {
    // With no required domain every surviving route scores 0 for the domain, and an
    // unknown failed model contributes no similarity, so no replacement is chosen.
    const next = selectFailover(routes, 'not-a-real-model', { requiredDomains: [] }, [{ model: 'not-a-real-model' }])
    expect(next).toBeUndefined()
  })

  it('returns undefined when every route is already tried', () => {
    const tried = routes.map(r => ({ model: r.model }))
    expect(selectFailover(routes, 'gwdg.glm-5.3-flash', { requiredDomains: ['coding'] }, tried)).toBeUndefined()
  })
})

describe('withinBudget', () => {
  it('accepts an in-range attempt', () => {
    expect(withinBudget(0, 2)).toBe(true)
    expect(withinBudget(1, 2)).toBe(true)
  })

  it('rejects an exhausted budget', () => {
    expect(withinBudget(2, 2)).toBe(false)
  })

  it('rejects non-positive or non-integer budgets', () => {
    expect(withinBudget(0, 0)).toBe(false)
    expect(withinBudget(0, -1)).toBe(false)
    expect(withinBudget(0, 1.5)).toBe(false)
    expect(withinBudget(0, Number.NaN)).toBe(false)
  })
})

describe('planned step ids', () => {
  it('creates a branded step id', () => {
    expect(createStepId(1)).toBe('step-1')
  })
})
