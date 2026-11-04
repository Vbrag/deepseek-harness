import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { coordinate, CoordinatorError, createStepId, isModality, isTaskDomain, parsePlan, TASK_DOMAINS, TASK_MODALITIES } from '../src/coordinator.ts'

describe('parsePlan', () => {
  it('parses a valid plan with domains', () => {
    const steps = parsePlan('[{"description":"Do A","requiredDomains":["coding"]},{"description":"Do B","requiredDomains":[]}]')
    expect(steps).toHaveLength(2)
    const [first, second] = steps
    expect(first?.description).toBe('Do A')
    expect(first?.requiredDomains).toEqual(['coding'])
    expect(second?.id).toBe(createStepId(2))
  })

  it('strips a JSON code fence', () => {
    const steps = parsePlan('```json\n[{"description":"X","requiredDomains":[]}]\n```')
    expect(steps).toHaveLength(1)
    expect(steps[0]?.description).toBe('X')
  })

  it.each(['research', 3, null])('rejects an unsupported domain: %s', (domain) => {
    const raw = JSON.stringify([{ description: 'X', requiredDomains: ['coding', domain] }])
    expect(() => parsePlan(raw)).toThrow('requiredDomains contains an unsupported requirement')
  })

  it.each(['coding', null, 42])('rejects a non-array requiredDomains: %s', (requiredDomains) => {
    expect(() => parsePlan(JSON.stringify([{ description: 'X', requiredDomains }]))).toThrow('requiredDomains must be an array')
  })

  it('keeps omitted domains unconstrained', () => {
    expect(parsePlan('[{"description":"X"}]')[0]?.requiredDomains).toEqual([])
  })

  it('parses requiredModalities and contextTokens onto a step', () => {
    const steps = parsePlan('[{"description":"Watch the clip","requiredDomains":["vision"],"requiredModalities":["audio","video"],"contextTokens":50000}]')
    expect(steps[0]?.requiredModalities).toEqual(['audio', 'video'])
    expect(steps[0]?.contextTokens).toBe(50_000)
  })

  it('omits absent or empty modalities and preserves a zero context estimate', () => {
    const steps = parsePlan('[{"description":"Plain","requiredDomains":[],"contextTokens":0}]')
    expect(steps[0]?.requiredModalities).toBeUndefined()
    expect(steps[0]?.contextTokens).toBe(0)
    expect(parsePlan('[{"description":"Plain","requiredModalities":[]}]')[0]?.requiredModalities).toBeUndefined()
  })

  it.each(['haptic', null, 3])('rejects an unsupported modality without dropping it: %s', (modality) => {
    const raw = JSON.stringify([{ description: 'X', requiredModalities: ['image', modality] }])
    expect(() => parsePlan(raw)).toThrow('requiredModalities contains an unsupported requirement')
  })

  it.each(['image', null, 42])('rejects non-array modalities: %s', (requiredModalities) => {
    const raw = JSON.stringify([{ description: 'X', requiredModalities }])
    expect(() => parsePlan(raw)).toThrow('requiredModalities must be an array')
  })

  it('preserves large context estimates instead of clamping them to a smaller requirement', () => {
    const steps = parsePlan('[{"description":"Big","contextTokens":99999999}]')
    expect(steps[0]?.contextTokens).toBe(99_999_999)
  })

  it.each(['lots', null, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid context estimates: %s', (contextTokens) => {
    const raw = JSON.stringify([{ description: 'X', contextTokens }])
    expect(() => parsePlan(raw)).toThrow('contextTokens must be a non-negative safe integer')
  })

  it('exposes the known modality set and validates membership', () => {
    expect(TASK_MODALITIES).toEqual(['text', 'image', 'audio', 'video'])
    expect(isModality('video')).toBe(true)
    expect(isModality('haptic')).toBe(false)
    expect(isModality(3)).toBe(false)
  })

  it('exposes every known task domain and validates membership', () => {
    expect(TASK_DOMAINS).toEqual(['coding', 'reasoning', 'vision', 'allrounder', 'european'])
    expect(isTaskDomain('vision')).toBe(true)
    expect(isTaskDomain('research')).toBe(false)
    expect(isTaskDomain(7)).toBe(false)
  })

  it('rejects unparseable JSON', () => {
    expect(() => parsePlan('not json')).toThrow(CoordinatorError)
  })

  it('rejects a non-array reply', () => {
    expect(() => parsePlan('{"a":1}')).toThrow(CoordinatorError)
  })

  it('rejects an empty array', () => {
    expect(() => parsePlan('[]')).toThrow(CoordinatorError)
  })

  it('rejects a non-object entry', () => {
    expect(() => parsePlan('[42]')).toThrow(CoordinatorError)
  })

  it('rejects an entry without a description', () => {
    expect(() => parsePlan('[{"requiredDomains":["coding"]}]')).toThrow(CoordinatorError)
  })

  it('rejects an entry whose description is only whitespace', () => {
    expect(() => parsePlan('[{"description":"   ","requiredDomains":[]}]')).toThrow(CoordinatorError)
  })
})

describe('coordinate', () => {
  const route = { provider: 'paderborn', model: 'gwdg.deepseek-v4-flash-0731' }

  function ctxWith(stream: () => AsyncIterable<StreamChunk>): Context {
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    ctx.provide('llm', { stream: vi.fn(stream) })
    return ctx
  }

  async function* chunks(...items: StreamChunk[]): AsyncGenerator<StreamChunk> {
    for (const item of items) yield item
  }

  it('assembles a plan from multiple text deltas then a completed finish', async () => {
    const stream = vi.fn((_request: GenerateOptions) => chunks(
      { type: 'text-delta', index: 0, text: '[{"description":"Do A",' },
      { type: 'text-delta', index: 0, text: '"requiredDomains":["coding"]}]' },
      { type: 'finish', reason: { kind: 'stop' } },
    ))
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    ctx.provide('llm', { stream })
    const steps = await coordinate(ctx, { route, task: 'Do the thing' }, TASK_DOMAINS)
    expect(steps).toEqual([{ id: createStepId(1), description: 'Do A', requiredDomains: ['coding'] }])
    expect(stream).toHaveBeenCalledOnce()
    const request = stream.mock.calls[0]![0]
    expect(request).toMatchObject({
      provider: route.provider,
      model: route.model,
      temperature: 0,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Do the thing' }] }],
    })
    expect(request.system).toContain('availableDomains')
  })

  it('forwards the reasoning effort when the route carries one', async () => {
    const stream = vi.fn((_request: GenerateOptions) => chunks(
      { type: 'text-delta', index: 0, text: '[{"description":"Do A","requiredDomains":[]}]' },
      { type: 'finish', reason: { kind: 'stop' } },
    ))
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    ctx.provide('llm', { stream })
    await coordinate(ctx, {
      route: { provider: 'paderborn', model: 'gwdg.deepseek-v4-flash-0731', reasoningEffort: ReasoningEffortId('high') },
      task: 'X',
    }, TASK_DOMAINS)
    expect(stream.mock.calls[0]![0].reasoningEffort).toBe('high')
  })

  it('throws a CoordinatorError carrying the failure code on an error finish', async () => {
    await expect(coordinate(ctxWith(() => chunks({
      type: 'finish',
      reason: { kind: 'error', failure: { message: 'no route', code: 'NO_ADAPTER' } },
    })), { route, task: 'X' }, TASK_DOMAINS)).rejects.toThrow('coordinator call failed (NO_ADAPTER)')
  })

  it('throws a CoordinatorError on an aborted finish', async () => {
    await expect(coordinate(ctxWith(() => chunks({
      type: 'finish',
      reason: { kind: 'aborted', failure: { message: 'stopped', code: 'ABORTED' } },
    })), { route, task: 'X' }, TASK_DOMAINS)).rejects.toThrow('coordinator call failed (ABORTED)')
  })

  it('throws when the stream ends without a terminal finish', async () => {
    await expect(coordinate(ctxWith(() => chunks(
      { type: 'reasoning-delta', index: 0, text: 'thinking' },
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
    )), { route, task: 'X' }, TASK_DOMAINS))
      .rejects.toThrow('coordinator emitted no terminal finish')
  })
})
