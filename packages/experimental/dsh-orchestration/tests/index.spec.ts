import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies, provideWorkingDirectoryFixture } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LlmAdapter, createUserMessage, type GenerateOptions, type LlmResolvedModelInfo,
  type ImageBlock, type LlmQueueAvailability, type LlmQueueRequest, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { appendPluginRecord, pluginRecordOf, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import SubagentRuntime, { type SubagentModelRouting, type SubagentModelRoutingContext } from '@deepseek-ai/dsh-subagent'
import { CommandId } from '@deepseek-ai/dsh-commands'
import OrchestrationService from '../src/index.ts'
import type { OrchestrationConfig, PoolRoute } from '../src/types.ts'

const pool: PoolRoute[] = [{ provider: 'mock', model: 'code' }, { provider: 'mock', model: 'mixed' }]
const assessment = { requiredCapabilities: ['coding'], contextTokens: 1000, requiredModalities: ['text'] }
const prompt = [{ type: 'text' as const, text: 'implement the parser' }]

class Adapter extends LlmAdapter {
  readonly queues = new Map<string, LlmQueueAvailability>()
  readonly metadata = new Map<string, Partial<LlmResolvedModelInfo>>()
  readonly unknownModels = new Set<string>()
  probe: ((request: LlmQueueRequest) => void) | undefined
  lookup: ((provider: string, model: string) => Promise<LlmResolvedModelInfo>) | undefined
  gate: Promise<undefined> | undefined
  streamStarted: (() => void) | undefined
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    if (this.lookup !== undefined) return this.lookup(provider, model)
    if (this.unknownModels.has(model)) return Promise.resolve({ provider, id: model, name: model })
    return Promise.resolve({
      provider, id: model, name: model, inputModalities: ['text', 'image'],
      context: { contextWindow: 100_000 }, ...this.metadata.get(model),
    })
  }
  override queueAvailability(request: LlmQueueRequest): Promise<LlmQueueAvailability> {
    this.probe?.(request)
    return Promise.resolve(this.queues.get(request.model) ?? { kind: 'ready' })
  }
  override async *stream(_request: GenerateOptions): AsyncIterable<StreamChunk> {
    this.streamStarted?.()
    if (this.gate !== undefined) await this.gate
    yield { type: 'text-delta', index: 0, text: 'done' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function fixture(config: OrchestrationConfig = {}) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  provideWorkingDirectoryFixture(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  const adapter = new Adapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  const register = vi.spyOn(ctx.subagents, 'registerModelRouter')
  const { routeCapabilities, ...options } = config
  const mount = ctx.plugin(OrchestrationService, {
    pool,
    ...options,
    routeCapabilities: (routeCapabilities ?? pool.map(route => ({ ...route, capabilities: ['coding' as const] })))
      .map(route => ({ ...route, capabilities: [...route.capabilities] })),
  })
  await mount
  const router = register.mock.calls[0]?.[0]
  if (router === undefined) throw new Error('router registration missing')
  const parent = (await ctx.agents.create({
    sessionId: SessionId('parent'), agentOptions: { provider: 'mock', model: 'lead' },
  })).agent
  parent.session.append('subagent/model-selection-policy', { allowedModels: pool })
  let child = 0
  const request = (overrides: Partial<SubagentModelRoutingContext> = {}): SubagentModelRoutingContext => ({
    parent, childId: SessionId('child-' + String(++child)), prompt,
    taskAssessment: assessment,
    agentOptions: { provider: 'mock', model: 'lead' },
    signal: new AbortController().signal,
    ...overrides,
  })
  const resolve = async (overrides: Partial<SubagentModelRoutingContext> = {}): Promise<SubagentModelRouting> => {
    const resolved = await router.resolve(request(overrides))
    if (resolved === undefined) throw new Error('router did not return an admission snapshot')
    return resolved
  }
  return { ctx, adapter, parent, service: ctx.orchestrations, mount, router, resolve, request }
}

function preStep(ctx: Context, agent: Agent, options: { reject?: boolean; signal?: AbortSignal; empty?: boolean } = {}) {
  const messages = options.empty ? [] : [createUserMessage({ content: prompt, source: { kind: 'user' } })]
  return agentEvents(ctx, agent).waterfall('agent/pre-step', {
    messages, turn: 0, step: 1,
    signal: options.signal ?? new AbortController().signal,
    modelSelection: { provider: 'mock', model: 'lead' },
  }, async () => options.reject ? { kind: 'reject' } : { kind: 'enter', messages, startsRequestSeries: true })
}

describe('session-scoped normal delegation routing', () => {
  it('logs defaults and leaves OFF delegation on its captured inherited route', async () => {
    const f = await fixture()
    expect(f.service.modeOf(f.parent)).toBe(false)
    expect(f.parent.session.snapshotEvents().find(event => event.type === 'orchestration/mode')?.data).toEqual({ active: false })
    const route = await f.resolve()
    expect(route).not.toHaveProperty('agentOptions')
    expect(f.ctx.subagents.modelRoutingDefaults()).toEqual(pool)
    expect(f.parent.session.snapshotEvents().some(event => pluginRecordOf(event)?.type === 'plugin:orchestration/route')).toBe(false)
  })

  it('requires an assessment in ON mode and applies every requested specialty', async () => {
    const f = await fixture()
    f.service.setMode(f.parent, true)
    const { taskAssessment: _assessment, ...missing } = f.request()
    await expect(f.router.resolve(missing)).rejects.toMatchObject({
      name: 'OrchestrationError', code: 'ORCHESTRATION_ASSESSMENT_REQUIRED',
    })
    await expect(f.resolve({ taskAssessment: { ...assessment, requiredCapabilities: ['coding', 'reasoning'] } }))
      .rejects.toMatchObject({ code: 'ORCHESTRATION_NO_CAPABLE_ROUTE' })
  })

  it.each([
    { ...assessment, requiredCapabilities: ['codign'] },
    { ...assessment, preferredCapabilities: ['resoning'] },
    { ...assessment, requiredModalities: ['video'] },
  ])('rejects unsupported assessment labels before inspecting routes: %j', async (taskAssessment) => {
    const f = await fixture()
    f.service.setMode(f.parent, true)
    const lookup = vi.spyOn(f.adapter, 'resolveModel')
    await expect(f.resolve({ taskAssessment })).rejects.toMatchObject({
      name: 'OrchestrationError', code: 'ORCHESTRATION_INVALID_ASSESSMENT',
    })
    expect(lookup).not.toHaveBeenCalled()
  })

  it('counts complete context and output allowances before considering a route', async () => {
    const f = await fixture()
    f.service.setMode(f.parent, true)
    f.adapter.metadata.set('code', { context: { contextWindow: 13_287 } })
    const requests: LlmQueueRequest[] = []
    f.adapter.probe = (request) => { requests.push(request) }
    const route = await f.resolve()
    expect(route.agentOptions?.model).toBe('mixed')
    expect(requests).toMatchObject([{ provider: 'mock', model: 'mixed', inputTokens: 9192, maxTokens: 4096 }])
    route.release?.()
  })

  it('accounts for a large initial prompt and preserves the actual requested output cap', async () => {
    const f = await fixture()
    f.service.setMode(f.parent, true)
    f.adapter.metadata.set('code', { context: { contextWindow: 30_000 } })
    const requests: LlmQueueRequest[] = []
    f.adapter.probe = (request) => { requests.push(request) }
    const route = await f.resolve({
      prompt: [{ type: 'text', text: 'x'.repeat(40_000) }],
      taskAssessment: { ...assessment, contextTokens: 1, outputTokens: 100 },
      agentOptions: { provider: 'mock', model: 'lead', maxTokens: 20_000 },
    })
    expect(route.agentOptions).toMatchObject({ model: 'mixed', maxTokens: 20_000 })
    expect(requests).toMatchObject([{ model: 'mixed', inputTokens: 18_192, maxTokens: 20_000 }])
    route.release?.()
  })

  it('requires image capability for actual prompt images even when the assessment omits it', async () => {
    const f = await fixture()
    f.service.setMode(f.parent, true)
    f.adapter.metadata.set('code', { inputModalities: ['text'] })
    const image: ImageBlock = {
      type: 'image',
      attachment: { attachmentId: brandString<ImageBlock['attachment']['attachmentId']>('image'),
        bytes: 100, width: 100, height: 100, mediaType: 'image/png' },
    }
    const route = await f.resolve({ prompt: [image], taskAssessment: { ...assessment, contextTokens: 1 } })
    expect(route.agentOptions?.model).toBe('mixed')
    const record = f.parent.session.snapshotEvents().map(pluginRecordOf).find(item => item?.type === 'plugin:orchestration/route')
    expect(record?.data).toMatchObject({
      assessment: { requiredCapabilities: ['coding', 'vision'], requiredModalities: ['text', 'image'] },
      inputTokens: 9192,
    })
    route.release?.()
  })

  it('rejects routes without positive context/modality facts or outside the recorded policy', async () => {
    const f = await fixture()
    f.service.setMode(f.parent, true)
    f.adapter.unknownModels.add('code')
    f.adapter.metadata.set('mixed', { inputModalities: ['text'] })
    await expect(f.resolve({ taskAssessment: { ...assessment, requiredModalities: ['image'] } }))
      .rejects.toMatchObject({ code: 'ORCHESTRATION_NO_CAPABLE_ROUTE' })
    f.service.setPool([{ provider: 'mock', model: 'unauthorized' }])
    await expect(f.resolve()).rejects.toMatchObject({ code: 'ORCHESTRATION_NO_CAPABLE_ROUTE' })
  })

  it('spreads live assignments across sessions and releases load after completion', async () => {
    const f = await fixture()
    f.service.setMode(f.parent, true)
    const other = (await f.ctx.agents.create({
      sessionId: SessionId('other-parent'), agentOptions: { provider: 'mock', model: 'lead' },
    })).agent
    other.session.append('subagent/model-selection-policy', { allowedModels: pool })
    f.service.setMode(other, true)
    const first = await f.resolve()
    const second = await f.resolve({ parent: other })
    expect([first.agentOptions?.model, second.agentOptions?.model]).toEqual(['code', 'mixed'])
    first.release?.()
    first.release?.()
    const third = await f.resolve()
    expect(third.agentOptions?.model).toBe('code')
    second.release?.()
    third.release?.()
    const records = f.parent.session.snapshotEvents().flatMap((event) => {
      const record = pluginRecordOf(event)
      return record?.type === 'plugin:orchestration/route' ? [record] : []
    })
    expect(records[0]?.data).toMatchObject({
      assessment, selected: pool[0], reason: 'pool-order', inputTokens: 9192, outputTokens: 4096,
    })
    expect(f.parent.session.snapshotEvents().filter(event => pluginRecordOf(event)?.type === 'plugin:orchestration/route')
      .every(event => event.ignorable === true)).toBe(true)
  })

  it('uses another capable route immediately when the best route is rate limited', async () => {
    const f = await fixture()
    f.service.setMode(f.parent, true)
    f.adapter.queues.set('code', { kind: 'wait', waitMs: 60_000 })
    const route = await f.resolve()
    expect(route.agentOptions?.model).toBe('mixed')
    route.release?.()
    f.adapter.queues.set('mixed', { kind: 'impossible', estimatedTokens: 13_288, tokenLimit: 10_000 })
    f.adapter.queues.set('code', { kind: 'impossible', estimatedTokens: 13_288, tokenLimit: 10_000 })
    await expect(f.resolve()).rejects.toMatchObject({ code: 'ORCHESTRATION_NO_CAPABLE_ROUTE' })
  })

  it('prefers verified ready capacity and uses unknown capacity before waiting on throttled routes', async () => {
    const f = await fixture()
    f.service.setMode(f.parent, true)
    f.adapter.queues.set('code', { kind: 'unknown' })
    const verified = await f.resolve()
    expect(verified.agentOptions?.model).toBe('mixed')
    verified.release?.()
    f.adapter.queues.set('mixed', { kind: 'wait', waitMs: 60_000 })
    const fallback = await f.resolve()
    expect(fallback.agentOptions?.model).toBe('code')
    fallback.release?.()
  })

  it('waits without spawning when every capable route is busy and cancels that wait', async () => {
    const f = await fixture()
    f.service.setMode(f.parent, true)
    vi.useFakeTimers()
    try {
      f.adapter.queues.set('code', { kind: 'wait', waitMs: 1000 })
      f.adapter.queues.set('mixed', { kind: 'wait', waitMs: 1000 })
      const probed = Promise.withResolvers<undefined>()
      f.adapter.probe = () => { probed.resolve(undefined) }
      const abort = new AbortController()
      const operation = f.resolve({ signal: abort.signal })
      const rejected = expect(operation).rejects.toMatchObject({ name: 'AbortError' })
      await probed.promise
      await vi.advanceTimersByTimeAsync(0)
      expect(vi.getTimerCount()).toBe(1)
      abort.abort(new DOMException('cancelled', 'AbortError'))
      await rejected
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rechecks shared queue capacity after its wait and accepts unknown adapters', async () => {
    const f = await fixture()
    f.service.setMode(f.parent, true)
    vi.useFakeTimers()
    try {
      f.adapter.queues.set('code', { kind: 'wait', waitMs: 1000 })
      f.adapter.queues.set('mixed', { kind: 'impossible', estimatedTokens: 2000, tokenLimit: 1000 })
      const probed = Promise.withResolvers<undefined>()
      f.adapter.probe = () => { probed.resolve(undefined) }
      const operation = f.resolve()
      await probed.promise
      await vi.advanceTimersByTimeAsync(0)
      f.adapter.queues.set('code', { kind: 'unknown' })
      await vi.advanceTimersByTimeAsync(1000)
      const route = await operation
      expect(route.agentOptions?.model).toBe('code')
      route.release?.()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rechecks early capacity refunds before the original rolling-window estimate expires', async () => {
    const f = await fixture({ availabilityPollMs: 250 })
    f.service.setMode(f.parent, true)
    vi.useFakeTimers()
    try {
      f.adapter.queues.set('code', { kind: 'wait', waitMs: 60_000 })
      f.adapter.queues.set('mixed', { kind: 'wait', waitMs: 60_000 })
      const probed = Promise.withResolvers<undefined>()
      f.adapter.probe = () => { probed.resolve(undefined) }
      const admission = f.resolve()
      await probed.promise
      await vi.advanceTimersByTimeAsync(100)
      f.adapter.queues.set('code', { kind: 'ready' })
      await vi.advanceTimersByTimeAsync(150)
      const selected = await admission
      expect(selected.agentOptions?.model).toBe('code')
      selected.release?.()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('counts live child work after selector replacement and excludes the same child once idle', async () => {
    const f = await fixture()
    f.service.setMode(f.parent, true)
    const gate = Promise.withResolvers<undefined>()
    const started = Promise.withResolvers<undefined>()
    f.adapter.gate = gate.promise
    f.adapter.streamStarted = () => { started.resolve(undefined) }
    const child = (await f.ctx.agents.create({
      sessionId: SessionId('live-child'), meta: { origin: 'subagent' },
      agentOptions: { provider: 'mock', model: 'code' },
    })).agent
    child.followup(createUserMessage({ content: prompt, source: { kind: 'user' } }))
    try {
      await started.promise
      await f.mount.dispose()
      const register = vi.spyOn(f.ctx.subagents, 'registerModelRouter')
      await f.ctx.plugin(OrchestrationService, {
        pool, routeCapabilities: pool.map(route => ({ ...route, capabilities: ['coding' as const] })),
      })
      const replacement = register.mock.calls.at(-1)?.[0]
      if (replacement === undefined) throw new Error('replacement router missing')
      const busy = await replacement.resolve(f.request())
      expect(busy?.agentOptions?.model).toBe('mixed')
      busy?.release?.()
      gate.resolve(undefined)
      await child.whenIdle()
      const idle = await replacement.resolve(f.request())
      expect(idle?.agentOptions?.model).toBe('code')
      idle?.release?.()
    } finally {
      gate.resolve(undefined)
      await child.whenIdle()
    }
  })

  it('captures parent mode before an asynchronous metadata lookup and passes it to the child setup', async () => {
    const f = await fixture()
    f.service.setMode(f.parent, true)
    const started = Promise.withResolvers<undefined>()
    const gate = Promise.withResolvers<undefined>()
    f.adapter.lookup = async (provider, model) => {
      started.resolve(undefined)
      await gate.promise
      return { provider, id: model, name: model, inputModalities: ['text'], context: { contextWindow: 100_000 } }
    }
    const operation = f.resolve()
    await started.promise
    f.service.setMode(f.parent, false)
    gate.resolve(undefined)
    const route = await operation
    if (route.agentOptions === undefined) throw new Error('active routing omitted child model options')
    const child = (await f.ctx.agents.create({
      sessionId: SessionId('snapshot-child'), agentOptions: route.agentOptions,
      setup: async (_ctx, agent) => { await route.setup?.(agent) },
    })).agent
    expect(f.service.modeOf(child)).toBe(true)
    route.release?.()
  })

  it('contains metadata failures with the original cause and withdraws the policy on unload', async () => {
    const f = await fixture()
    f.service.setMode(f.parent, true)
    const cause = new Error('provider gone')
    f.adapter.lookup = async () => { throw cause }
    await expect(f.resolve()).rejects.toMatchObject({ code: 'ORCHESTRATION_ROUTE_METADATA_FAILED', cause })
    await f.mount.dispose()
    expect(f.ctx.subagents.modelRoutingDefaults()).toBeUndefined()
  })

  it('aborts pending queue admission and releases its timer when the plugin unloads', async () => {
    const f = await fixture()
    f.service.setMode(f.parent, true)
    vi.useFakeTimers()
    try {
      f.adapter.queues.set('code', { kind: 'wait', waitMs: 1000 })
      f.adapter.queues.set('mixed', { kind: 'wait', waitMs: 1000 })
      const probed = Promise.withResolvers<undefined>()
      f.adapter.probe = () => { probed.resolve(undefined) }
      const admission = f.resolve()
      const rejected = expect(admission).rejects.toMatchObject({ name: 'AbortError' })
      await probed.promise
      await vi.advanceTimersByTimeAsync(0)
      expect(vi.getTimerCount()).toBe(1)
      await f.mount.dispose()
      await rejected
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('durable mode selections', () => {
  it('commits pending mode only at an accepted nonempty nonaborted pre-step', async () => {
    const f = await fixture()
    f.parent.session.append('turn/start', { turn: 0 })
    expect(f.service.select(f.parent, true)).toBe('queued')
    expect(f.ctx.sessionProjections.snapshot(f.parent.session).values.orchestration).toEqual({ active: false, pending: true })
    await preStep(f.ctx, f.parent, { reject: true })
    expect(f.service.modeOf(f.parent)).toBe(false)
    await preStep(f.ctx, f.parent, { signal: AbortSignal.abort() })
    expect(f.service.modeOf(f.parent)).toBe(false)
    await preStep(f.ctx, f.parent, { empty: true })
    expect(f.service.modeOf(f.parent)).toBe(false)
    const result = await preStep(f.ctx, f.parent)
    expect(result).toMatchObject({ kind: 'enter', startsRequestSeries: true })
    expect(f.service.modeOf(f.parent)).toBe(true)
    expect(f.ctx.sessionProjections.snapshot(f.parent.session).values.orchestration).toEqual({ active: true, pending: false })
  })

  it('recovers queued selections across plugin replacement and lets an opposite selection cancel them', async () => {
    const f = await fixture()
    f.parent.session.append('turn/start', { turn: 0 })
    f.service.select(f.parent, true)
    expect(f.service.select(f.parent, true)).toBe('noop')
    await f.mount.dispose()
    await f.ctx.plugin(OrchestrationService)
    expect(f.ctx.sessionProjections.snapshot(f.parent.session).values.orchestration).toEqual({ active: false, pending: true })
    expect(f.ctx.orchestrations.select(f.parent, false)).toBe('cancelled')
    expect(f.ctx.sessionProjections.snapshot(f.parent.session).values.orchestration).toEqual({ active: false, pending: false })
    f.ctx.orchestrations.select(f.parent, true)
    await preStep(f.ctx, f.parent)
    expect(f.ctx.orchestrations.modeOf(f.parent)).toBe(true)
  })

  it('restores historical successful command intent and logs the applied mode', async () => {
    const f = await fixture()
    f.parent.session.append('turn/start', { turn: 0 })
    const commandId = CommandId('historical')
    f.parent.session.append('command/run', { commandId, name: 'orchestration', args: 'on', source: { kind: 'user' } })
    f.parent.session.append('command/done', { commandId, kind: 'success' })
    await preStep(f.ctx, f.parent)
    expect(f.service.modeOf(f.parent)).toBe(true)
    expect(f.parent.session.snapshotEvents().at(-1)).toMatchObject({ type: 'orchestration/mode', data: { active: true } })
  })

  it('preserves historical pending intent that predates the first applied mode record', async () => {
    const f = await fixture({ defaultToOrchestrator: true })
    const commandId = CommandId('before-mode-record')
    const restored = (await f.ctx.agents.create({
      sessionId: SessionId('old-pending'), agentOptions: { provider: 'mock', model: 'lead' },
      seed: [
        { type: 'turn/start', seq: SessionSeq(0), time: 0, data: { turn: 0 } },
        { type: 'command/run', seq: SessionSeq(1), time: 1,
          data: { commandId, name: 'orchestration', args: 'on', source: { kind: 'user' } } },
        { type: 'command/done', seq: SessionSeq(2), time: 2, data: { commandId, kind: 'success' } },
      ],
    })).agent
    expect(f.ctx.sessionProjections.snapshot(restored.session).values.orchestration).toEqual({ active: false, pending: true })
    await preStep(f.ctx, restored)
    expect(f.service.modeOf(restored)).toBe(true)
  })

  it('recovers a pending selection from a restored Session log', async () => {
    const f = await fixture()
    f.parent.session.append('turn/start', { turn: 0 })
    f.service.select(f.parent, true)
    const restored = (await f.ctx.agents.create({
      sessionId: SessionId('restored'), seed: f.parent.session.snapshotEvents(),
      agentOptions: { provider: 'mock', model: 'lead' },
    })).agent
    expect(f.ctx.sessionProjections.snapshot(restored.session).values.orchestration).toEqual({ active: false, pending: true })
    await preStep(f.ctx, restored)
    expect(f.service.modeOf(restored)).toBe(true)
  })

  it('keeps malformed stored intent visibly invalid instead of guessing a mode', async () => {
    const f = await fixture()
    // A historical writer may have persisted an owner-version field the current parser does not support.
    appendPluginRecord(f.parent.session, 'plugin:orchestration/mode-request', Object.assign({ active: true }, { newer: true }))
    expect(() => f.service.modeOf(f.parent)).toThrow()
  })
})

describe('pool settings and configuration', () => {
  it('applies defaults, replaces the pool, and warns when persistence is unavailable', async () => {
    const f = await fixture()
    const warning = vi.spyOn(f.ctx.logger, 'warn')
    await expect(f.service.persistPool([])).resolves.toBe(true)
    expect(f.service.getPool()).toEqual([])
    expect(warning).toHaveBeenCalled()
  })

  it('rejects invalid allowances and duplicate exact specialty declarations', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    expect(() => new OrchestrationService(ctx, { outputReserveTokens: 0 })).toThrow('outputReserveTokens')
    const duplicate = new Context()
    onTestFinished(() => duplicate.fiber.dispose())
    expect(() => new OrchestrationService(duplicate, {
      routeCapabilities: [{ ...pool[0]!, capabilities: ['coding'] }, { ...pool[0]!, capabilities: ['coding'] }],
    })).toThrow('routeCapabilities must not repeat')
  })
})
