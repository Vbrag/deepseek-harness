import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { agentEvents, assembleContextFor, type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LlmAdapter, createUserMessage, type GenerateOptions, type LlmResolvedModelInfo,
  type ImageBlock, type LlmQueueAvailability, type LlmQueueRequest, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { appendPluginRecord, SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import SubagentRuntime, {
  type SubagentActivation, type SubagentActivationSpec, type SubagentModelRouting, type SubagentModelRoutingContext,
} from '@deepseek-ai/dsh-subagent'
import * as SpawnInProcess from '@deepseek-ai/dsh-subagent-spawn-in-process'
import SubagentModelSelectionConfig from '@deepseek-ai/dsh-tool-subagent/model-selection-settings'
import { CommandId } from '@deepseek-ai/dsh-commands'
import OrchestrationService from '../src/index.ts'
import type { OrchestrationConfig, PoolRoute } from '../src/types.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    'plugin:orchestration/mode-request': { active: boolean }
  }
}

const pool: PoolRoute[] = [{ provider: 'mock', model: 'code' }, { provider: 'mock', model: 'mixed' }]
const assessment = { requiredCapabilities: ['coding'], contextTokens: 1000, requiredModalities: ['text'] }
const prompt = [{ type: 'text' as const, text: 'implement the parser' }]
const orchestrationGuidance = 'Orchestration mode is active. '
  + 'Proactively identify independent work that can make useful progress in parallel. '
  + 'When the available subagent tools and delegation limits allow it, prefer delegating bounded tasks '
  + 'with clear goals and expected results without waiting for the user to request delegation. '
  + 'Start independent delegations early and continue useful work yourself when possible. '
  + 'Respect the user\'s instructions, delegation depth, and active-child limits. '
  + 'Handle work directly when it is small, sequential, or delegation would add overhead without useful parallel progress. '
  + 'For every fresh local child, supply task_assessment with requiredCapabilities '
  + '(coding, reasoning, vision, allrounder, european), contextTokens for expected input including files the child '
  + 'will read, and requiredModalities for inputs needed throughout the task. Require coding for ordinary implementation tasks. '
  + 'Prefer reasoning when it would help; require it only when the task specifically needs that capability. Include image for screenshots '
  + 'the child may capture later. Use preferredCapabilities for optional strengths and outputTokens for the '
  + 'expected response allowance. Every required capability must be supported; reasoning alone does not '
  + 'establish coding ability. Model selection automatically considers the allowed pool, capabilities, '
  + 'live load, and request/token queue availability.'

class Adapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
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
  override async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(request)
    this.streamStarted?.()
    if (this.gate !== undefined) await this.gate
    yield { type: 'text-delta', index: 0, text: 'done' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function fixture(config: OrchestrationConfig = {}) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SubagentModelSelectionConfig, { enabled: false, allowedModels: [] })
  await ctx.plugin(SpawnInProcess, { providerName: 'spawn' })
  const adapter = new Adapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  const register = vi.spyOn(ctx.subagents, 'registerModelRouter')
  const { routeCapabilities, userRouteCapabilities, ...options } = config
  const mount = ctx.plugin(OrchestrationService, {
    pool,
    ...options,
    ...userRouteCapabilities === undefined ? {} : {
      userRouteCapabilities: userRouteCapabilities.map(route => ({ ...route, capabilities: [...route.capabilities] })),
    },
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

async function orchestrationContext(ctx: Context, agent?: Agent) {
  const assembly = await ctx.systemPrompt.assemble(agent === undefined ? undefined : assembleContextFor(agent))
  return assembly.contexts.find(context => context.name === 'orchestration')
}

function activation(f: Awaited<ReturnType<typeof fixture>>, options: Partial<SubagentActivationSpec> = {}) {
  return f.ctx.subagents.startActivation({ provider: 'spawn', label: 'implement parser', delivery: 'caller',
    parent: f.parent, prompt, taskAssessment: assessment, signal: new AbortController().signal, ...options })
}

async function settleActivations(starts: readonly Promise<SubagentActivation>[]) {
  const settled = await Promise.allSettled(starts)
  await Promise.allSettled(settled.flatMap(item => item.status === 'fulfilled' ? [item.value.result] : []))
}

function routeRecords(agent: Agent) {
  return agent.session.snapshotEvents().flatMap((event) => {
    return event.type === 'orchestration/route' ? [event] : []
  })
}

describe('session-scoped normal delegation routing', () => {
  it('guides proactive parallel delegation only while Orchestration mode is active', async () => {
    const f = await fixture()
    expect(await orchestrationContext(f.ctx)).toEqual({ name: 'orchestration', text: '' })
    expect(await orchestrationContext(f.ctx, f.parent)).toEqual({ name: 'orchestration', text: '' })
    f.service.setMode(f.parent, true)
    expect(await orchestrationContext(f.ctx, f.parent)).toEqual({ name: 'orchestration', text: orchestrationGuidance })
    f.service.setMode(f.parent, false)
    expect(await orchestrationContext(f.ctx, f.parent)).toEqual({ name: 'orchestration', text: '' })
  })

  it('logs defaults and leaves OFF delegation on its captured inherited route', async () => {
    const f = await fixture()
    expect(f.service.modeOf(f.parent)).toBe(false)
    expect(f.parent.session.snapshotEvents().find(event => event.type === 'orchestration/mode')?.data).toEqual({ active: false })
    const route = await f.resolve()
    expect(route).not.toHaveProperty('agentOptions')
    expect(f.ctx.subagents.modelRoutingDefaults()).toEqual(pool)
    expect(f.parent.session.snapshotEvents().some(event => event.type === 'orchestration/route')).toBe(false)
  })

  it('keeps the shared-base inactive default out of new Session logs and grants', async () => {
    const f = await fixture({ recordDisabledDefault: false, seedPoolAsRootPolicy: false })
    const fresh = (await f.ctx.agents.create({ sessionId: SessionId('quiet-default'),
      agentOptions: { provider: 'mock', model: 'lead' } })).agent
    expect(f.service.modeOf(fresh)).toBe(false)
    expect(f.ctx.subagents.modelSelectionPolicyOf(fresh.session)).toBeUndefined()
    expect(fresh.session.snapshotEvents().some(event => event.type === 'orchestration/mode')).toBe(false)
    expect(await f.resolve({ parent: fresh })).toEqual({})
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
    const f = await fixture({ routeCapabilities: [
      { ...pool[0]!, capabilities: ['coding'] }, { ...pool[1]!, capabilities: ['coding', 'vision'] },
    ] })
    f.service.setMode(f.parent, true)
    f.adapter.metadata.set('code', { inputModalities: ['text'] })
    const image: ImageBlock = {
      type: 'image',
      attachment: { attachmentId: brandString<ImageBlock['attachment']['attachmentId']>('image'),
        bytes: 100, width: 100, height: 100, mediaType: 'image/png' },
    }
    const route = await f.resolve({ prompt: [image], taskAssessment: { ...assessment, contextTokens: 1 } })
    expect(route.agentOptions?.model).toBe('mixed')
    const record = f.parent.session.snapshotEvents().find(item => item.type === 'orchestration/route')
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
      return event.type === 'orchestration/route' ? [event] : []
    })
    expect(records[0]?.data).toMatchObject({
      assessment, selected: pool[0], reason: 'pool-order', inputTokens: 9192, outputTokens: 4096,
    })
    expect(f.parent.session.snapshotEvents().filter(event => event.type === 'orchestration/route')
      .every(event => event.ignorable === undefined)).toBe(true)
  })

  it('balances simultaneous reservations after overlapping metadata lookups', async () => {
    const f = await fixture()
    f.service.setMode(f.parent, true)
    const entered = Promise.withResolvers<undefined>()
    const gate = Promise.withResolvers<undefined>()
    let lookups = 0
    f.adapter.lookup = async (provider, model) => {
      if (++lookups === 4) entered.resolve(undefined)
      await gate.promise
      return { provider, id: model, name: model, inputModalities: ['text'], context: { contextWindow: 100_000 } }
    }
    const starts = [f.resolve(), f.resolve()]
    try {
      await entered.promise
      gate.resolve(undefined)
      const routes = await Promise.all(starts)
      expect(new Set(routes.map(route => route.agentOptions?.model))).toEqual(new Set(['code', 'mixed']))
      for (const route of routes) route.release?.()
    } finally {
      gate.resolve(undefined)
      const settled = await Promise.allSettled(starts)
      for (const item of settled) if (item.status === 'fulfilled') item.value.release?.()
    }
  })

  it('chooses idle unknown capacity before loaded preferred ready capacity', async () => {
    const f = await fixture({ routeCapabilities: [
      { ...pool[0]!, capabilities: ['coding', 'reasoning'] }, { ...pool[1]!, capabilities: ['coding', 'vision'] },
    ] })
    f.service.setMode(f.parent, true)
    f.adapter.queues.set('mixed', { kind: 'unknown' })
    const first = await f.resolve({ taskAssessment: { ...assessment, preferredCapabilities: ['reasoning'] } })
    const second = await f.resolve({ taskAssessment: { ...assessment, preferredCapabilities: ['reasoning'] } })
    expect([first.agentOptions?.model, second.agentOptions?.model]).toEqual(['code', 'mixed'])
    const records = f.parent.session.snapshotEvents().filter(record => record.type === 'orchestration/route')
    expect(records.at(-1)?.data).toMatchObject({ reason: 'active-load', eligibleCount: 2, selectedLoad: 0,
      selectedReadiness: 'unknown', alternatives: [{ model: 'code', activeAssignments: 1, availability: { kind: 'ready' } }] })
    first.release?.()
    second.release?.()
    const equal = await f.resolve({ taskAssessment: { ...assessment, preferredCapabilities: ['vision'] } })
    expect(equal.agentOptions?.model).toBe('code')
    const last = routeRecords(f.parent).at(-1)
    expect(last?.data).toMatchObject({ reason: 'queue-readiness', selectedReadiness: 'ready' })
    equal.release?.()
  })

  it('reuses the sole capable route while retaining strict required specialties', async () => {
    const f = await fixture({ routeCapabilities: [
      { ...pool[0]!, capabilities: ['coding', 'reasoning'] }, { ...pool[1]!, capabilities: ['coding'] },
    ] })
    f.service.setMode(f.parent, true)
    const taskAssessment = { ...assessment, requiredCapabilities: ['coding', 'reasoning'] }
    const first = await f.resolve({ taskAssessment })
    const second = await f.resolve({ taskAssessment })
    expect([first.agentOptions?.model, second.agentOptions?.model]).toEqual(['code', 'code'])
    const record = routeRecords(f.parent).at(-1)
    expect(record?.data).toMatchObject({ eligibleCount: 1, selectedLoad: 1,
      alternatives: [{ model: 'mixed', exclusions: ['missing-required-capability'] }] })
    first.release?.()
    second.release?.()
  })

  it('retains the published startup reservation through initial-message admission and counts live work once', async () => {
    const f = await fixture({ routeCapabilities: [
      { ...pool[0]!, capabilities: ['coding', 'reasoning'] }, { ...pool[1]!, capabilities: ['coding'] },
    ] })
    f.service.setMode(f.parent, true)
    const published = Promise.withResolvers<undefined>()
    const admit = Promise.withResolvers<undefined>()
    const work = Promise.withResolvers<undefined>()
    f.adapter.gate = work.promise
    let children = 0
    f.ctx.on('agent/created', async ({ agent }) => {
      if (agent.session.header.origin !== 'subagent' || ++children !== 1) return undefined
      published.resolve(undefined)
      await admit.promise
      return undefined
    })
    const taskAssessment = { ...assessment, preferredCapabilities: ['reasoning'] }
    const starts: Promise<SubagentActivation>[] = [activation(f, { taskAssessment })]
    try {
      await Promise.race([published.promise, starts[0]!.then(() => { throw new Error('Child startup skipped its publication barrier') })])
      starts.push(activation(f, { taskAssessment }))
      const second = await starts[1]!
      expect(f.ctx.agents.get(second.childId)?.model.current()?.model).toBe('mixed')
      const record = routeRecords(f.parent).at(-1)
      expect(record?.data).toMatchObject({ reason: 'active-load', alternatives: [{ model: 'code', activeAssignments: 1 }] })
      admit.resolve(undefined)
      await starts[0]
      const next = await f.resolve({ taskAssessment })
      expect(next.agentOptions?.model).toBe('code')
      const counted = routeRecords(f.parent).at(-1)
      expect(counted?.data).toMatchObject({ selectedLoad: 1, alternatives: [{ model: 'mixed', activeAssignments: 1 }] })
      next.release?.()
    } finally {
      admit.resolve(undefined)
      work.resolve(undefined)
      await settleActivations(starts)
    }
  })

  it('counts startup work observed by a listener before its own created listener', async () => {
    const f = await fixture()
    f.service.setMode(f.parent, true)
    let observed: SubagentModelRouting | undefined
    f.ctx.on('agent/created', async ({ agent }) => {
      if (agent.session.header.origin !== 'subagent') return undefined
      observed = await f.resolve()
      return undefined
    }, { prepend: true })
    try {
      const child = await activation(f)
      await child.result
      expect(observed?.agentOptions?.model).toBe('mixed')
    } finally {
      observed?.release?.()
    }
  })

  it('retains a completed child assignment until its teardown settles', async () => {
    const f = await fixture({ routeCapabilities: [
      { ...pool[0]!, capabilities: ['coding', 'reasoning'] }, { ...pool[1]!, capabilities: ['coding'] },
    ] })
    f.service.setMode(f.parent, true)
    const disposing = Promise.withResolvers<undefined>()
    const finish = Promise.withResolvers<undefined>()
    f.ctx.on('agent/created', ({ agent }) => {
      if (agent.session.header.origin === 'subagent') agent.ctx.effect(() => async () => {
        disposing.resolve(undefined)
        await finish.promise
      })
      return undefined
    })
    const starts = [activation(f, { taskAssessment: { ...assessment, preferredCapabilities: ['reasoning'] } })]
    try {
      await starts[0]
      await disposing.promise
      const during = await f.resolve({ taskAssessment: { ...assessment, preferredCapabilities: ['reasoning'] } })
      expect(during.agentOptions?.model).toBe('mixed')
      expect(routeRecords(f.parent).at(-1)?.data).toMatchObject({ alternatives: [{ model: 'code', activeAssignments: 1 }] })
      during.release?.()
      finish.resolve(undefined)
      await (await starts[0]!).result
      const after = await f.resolve({ taskAssessment: { ...assessment, preferredCapabilities: ['reasoning'] } })
      expect(after.agentOptions?.model).toBe('code')
      expect(routeRecords(f.parent).at(-1)?.data).toMatchObject({ selectedLoad: 0 })
      after.release?.()
    } finally {
      finish.resolve(undefined)
      await settleActivations(starts)
    }
  })

  it('shares live loads across roots and nested delegations using ordinary child lifecycles', async () => {
    const f = await fixture()
    f.service.setMode(f.parent, true)
    const work = Promise.withResolvers<undefined>()
    f.adapter.gate = work.promise
    const other = (await f.ctx.agents.create({ sessionId: SessionId('other-root'),
      agentOptions: { provider: 'mock', model: 'lead' } })).agent
    other.session.append('subagent/model-selection-policy', { allowedModels: pool })
    f.service.setMode(other, true)
    const starts: Promise<SubagentActivation>[] = [activation(f)]
    try {
      const child = f.ctx.agents.get((await starts[0]!).childId)
      if (child === undefined) throw new Error('The first child was not published')
      starts.push(activation(f, { parent: child }))
      const grandchild = await starts[1]!
      expect(f.ctx.agents.get(grandchild.childId)?.model.current()?.model).toBe('mixed')
      starts.push(activation(f, { parent: other }))
      const third = await starts[2]!
      expect(f.ctx.agents.get(third.childId)?.model.current()?.model).toBe('code')
      const evidence = other.session.snapshotEvents().find(record => record.type === 'orchestration/route')
      expect(evidence?.data).toMatchObject({ selectedLoad: 1, alternatives: [{ model: 'mixed', activeAssignments: 1 }] })
    } finally {
      work.resolve(undefined)
      await settleActivations(starts)
    }
  })

  it('releases failed startup reservations after caller cancellation', async () => {
    const f = await fixture({ routeCapabilities: [
      { ...pool[0]!, capabilities: ['coding', 'reasoning'] }, { ...pool[1]!, capabilities: ['coding'] },
    ] })
    f.service.setMode(f.parent, true)
    const entered = Promise.withResolvers<undefined>()
    const finish = Promise.withResolvers<undefined>()
    f.ctx.on('agent/created', async ({ agent }) => {
      if (agent.session.header.origin !== 'subagent') return undefined
      entered.resolve(undefined)
      await finish.promise
      return undefined
    })
    const cancel = new AbortController()
    const taskAssessment = { ...assessment, preferredCapabilities: ['reasoning'] }
    const starting = activation(f, { taskAssessment, signal: cancel.signal })
    const rejected = expect(starting).rejects.toBeDefined()
    try {
      await Promise.race([entered.promise, starting.then(() => { throw new Error('Child startup skipped its cancellation barrier') })])
      cancel.abort(new DOMException('cancelled startup', 'AbortError'))
      finish.resolve(undefined)
      await rejected
      const next = await f.resolve({ taskAssessment })
      expect(next.agentOptions?.model).toBe('code')
      const record = routeRecords(f.parent).at(-1)
      expect(record?.data).toMatchObject({ selectedLoad: 0, alternatives: [{ activeAssignments: 0 }] })
      next.release?.()
    } finally {
      finish.resolve(undefined)
      await settleActivations([starting])
      await rejected
    }
  })

  it('leaves existing reservations intact when another route inspection fails', async () => {
    const f = await fixture()
    f.service.setMode(f.parent, true)
    const first = await f.resolve()
    f.adapter.lookup = async () => { throw new Error('metadata unavailable') }
    await expect(f.resolve()).rejects.toMatchObject({ code: 'ORCHESTRATION_ROUTE_METADATA_FAILED' })
    f.adapter.lookup = undefined
    const second = await f.resolve()
    expect(second.agentOptions?.model).toBe('mixed')
    const record = routeRecords(f.parent).at(-1)
    expect(record?.data).toMatchObject({ selectedLoad: 0, alternatives: [{ model: 'code', activeAssignments: 1 }] })
    first.release?.()
    second.release?.()
  })

  it('records hard and queue exclusions without inspecting unauthorized route metadata', async () => {
    const f = await fixture()
    f.service.setMode(f.parent, true)
    f.service.setPool([...pool, { provider: 'mock', model: 'denied' }])
    const inspect = vi.spyOn(f.adapter, 'resolveModel')
    f.adapter.queues.set('code', { kind: 'impossible', estimatedTokens: 20_000, tokenLimit: 10_000 })
    const route = await f.resolve()
    const record = routeRecords(f.parent).at(-1)
    expect(record?.data).toMatchObject({ eligibleCount: 1, selectedReadiness: 'ready', alternatives: [
      { model: 'code', exclusions: ['request-token-capacity'], contextWindow: 100_000,
        availability: { kind: 'impossible', estimatedTokens: 20_000, tokenLimit: 10_000 } },
      { model: 'denied', exclusions: ['unauthorized'] },
    ] })
    expect(inspect.mock.calls.some(call => call[1] === 'denied')).toBe(false)
    route.release?.()
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
    expect(await orchestrationContext(f.ctx, child)).toEqual({ name: 'orchestration', text: orchestrationGuidance })
    expect(await orchestrationContext(f.ctx, f.parent)).toEqual({ name: 'orchestration', text: '' })
    route.release?.()
  })

  it('contains metadata failures with the original cause and withdraws the policy on unload', async () => {
    const f = await fixture()
    f.service.setMode(f.parent, true)
    const cause = new Error('provider gone')
    f.adapter.lookup = async () => { throw cause }
    await expect(f.resolve()).rejects.toMatchObject({ code: 'ORCHESTRATION_ROUTE_METADATA_FAILED', cause })
    expect(await orchestrationContext(f.ctx, f.parent)).toEqual({ name: 'orchestration', text: orchestrationGuidance })
    await f.mount.dispose()
    expect(f.ctx.subagents.modelRoutingDefaults()).toBeUndefined()
    expect(await orchestrationContext(f.ctx, f.parent)).toBeUndefined()
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
    expect(await orchestrationContext(f.ctx, f.parent)).toEqual({ name: 'orchestration', text: '' })
    await preStep(f.ctx, f.parent, { reject: true })
    expect(f.service.modeOf(f.parent)).toBe(false)
    expect(await orchestrationContext(f.ctx, f.parent)).toEqual({ name: 'orchestration', text: '' })
    await preStep(f.ctx, f.parent, { signal: AbortSignal.abort() })
    expect(f.service.modeOf(f.parent)).toBe(false)
    expect(await orchestrationContext(f.ctx, f.parent)).toEqual({ name: 'orchestration', text: '' })
    await preStep(f.ctx, f.parent, { empty: true })
    expect(f.service.modeOf(f.parent)).toBe(false)
    expect(await orchestrationContext(f.ctx, f.parent)).toEqual({ name: 'orchestration', text: '' })
    const result = await preStep(f.ctx, f.parent)
    expect(result).toMatchObject({ kind: 'enter', startsRequestSeries: true })
    expect(f.service.modeOf(f.parent)).toBe(true)
    expect(f.ctx.sessionProjections.snapshot(f.parent.session).values.orchestration).toEqual({ active: true, pending: false })
    expect(await orchestrationContext(f.ctx, f.parent)).toEqual({ name: 'orchestration', text: orchestrationGuidance })
    expect(f.service.select(f.parent, false)).toBe('queued')
    expect(await orchestrationContext(f.ctx, f.parent)).toEqual({ name: 'orchestration', text: orchestrationGuidance })
    await preStep(f.ctx, f.parent)
    expect(await orchestrationContext(f.ctx, f.parent)).toEqual({ name: 'orchestration', text: '' })
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
    f.parent.session.append('orchestration/mode-request', Object.assign({ active: true }, { newer: true }))
    expect(() => f.service.modeOf(f.parent)).toThrow()
  })

  it('replays a legacy experimental pending-mode record', async () => {
    const f = await fixture()
    appendPluginRecord(f.parent.session, 'plugin:orchestration/mode-request', { active: true })
    expect(f.ctx.sessionProjections.snapshot(f.parent.session).values.orchestration).toEqual({ active: false, pending: true })
    await preStep(f.ctx, f.parent)
    expect(f.service.modeOf(f.parent)).toBe(true)
  })
})

describe('GUI activation authorization', () => {
  it('requires explicit approval and durably adds the new routes', async () => {
    const f = await fixture()
    const extra = { provider: 'mock', model: 'other' }
    f.service.setPool([...pool, extra])
    f.ctx.provide('settings', { describe: () => [{ ns: 'orchestration', revision: 4 }] } as never)
    const flush = vi.spyOn(f.ctx.sessions, 'flush').mockResolvedValue(true)
    const first = await f.service.prepareActivation(f.parent.id)
    expect(first).toMatchObject({ status: 'authorize', additionalRoutes: [extra] })
    if (first.status !== 'authorize') throw new Error('Expected authorization review')
    await expect(f.service.activateReviewed(f.parent.id, first.reviewId, false)).resolves.toEqual({ status: 'authorization-required' })
    expect(f.ctx.subagents.modelSelectionPolicyOf(f.parent.session)).toEqual(pool)
    const next = await f.service.prepareActivation(f.parent.id)
    if (next.status !== 'authorize') throw new Error('Expected authorization review')
    await expect(f.service.activateReviewed(f.parent.id, next.reviewId, true)).resolves.toEqual({ status: 'applied' })
    expect(flush).toHaveBeenCalledOnce()
    expect(f.ctx.subagents.modelSelectionPolicyOf(f.parent.session)).toEqual([...pool, extra])
    expect(f.parent.session.snapshotEvents().filter(event => event.type === 'subagent/model-selection-policy-authorized')).toHaveLength(1)
    expect(f.service.modeOf(f.parent)).toBe(true)
  })

  it('blocks new authorization while a failed checkpoint has an unknown outcome', async () => {
    const f = await fixture()
    f.service.setPool([...pool, { provider: 'mock', model: 'other' }])
    f.ctx.provide('settings', { describe: () => [{ ns: 'orchestration', revision: 1 }] } as never)
    const flush = vi.spyOn(f.ctx.sessions, 'flush').mockRejectedValueOnce(new Error('storage offline')).mockResolvedValue(true)
    const review = await f.service.prepareActivation(f.parent.id)
    if (review.status !== 'authorize') throw new Error('Expected authorization review')
    await expect(f.service.activateReviewed(f.parent.id, review.reviewId, true)).resolves.toEqual({ status: 'failed' })
    expect(() => f.ctx.subagents.modelSelectionPolicyOf(f.parent.session)).toThrow(expect.objectContaining({ code: 'PERSISTENCE_UNAVAILABLE' }))
    expect(f.service.modeOf(f.parent)).toBe(false)
    await expect(f.service.prepareActivation(f.parent.id)).resolves.toEqual({ status: 'durability' })
    await expect(f.service.retryActivationStorage(f.parent.id)).resolves.toBe(true)
    expect(flush).toHaveBeenCalledTimes(2)
    expect(f.ctx.subagents.modelSelectionPolicyOf(f.parent.session)).toEqual([...pool, { provider: 'mock', model: 'other' }])
  })

  it('rejects a review after the pool changes', async () => {
    const f = await fixture()
    f.ctx.provide('settings', { describe: () => [{ ns: 'orchestration', revision: 1 }] } as never)
    const review = await f.service.prepareActivation(f.parent.id)
    if (review.status !== 'ready') throw new Error('Expected an authorized pool')
    f.service.setPool([pool[0]!])
    await expect(f.service.activateReviewed(f.parent.id, review.reviewId, false)).resolves.toEqual({ status: 'stale' })
    expect(f.service.modeOf(f.parent)).toBe(false)
  })

  it('does not activate when the lead model changes during the authorization checkpoint', async () => {
    const f = await fixture()
    f.service.setPool([...pool, { provider: 'mock', model: 'other' }])
    f.ctx.provide('settings', { describe: () => [{ ns: 'orchestration', revision: 1 }] } as never)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    vi.spyOn(f.ctx.sessions, 'flush').mockImplementation(async () => {
      entered.resolve(undefined)
      await release.promise
      return true
    })
    const review = await f.service.prepareActivation(f.parent.id)
    if (review.status !== 'authorize') throw new Error('Expected authorization review')
    const activation = f.service.activateReviewed(f.parent.id, review.reviewId, true)
    try {
      await entered.promise
      f.parent.model.select({ provider: 'mock', model: 'other-lead' })
    } finally { release.resolve(undefined) }
    await expect(activation).resolves.toEqual({ status: 'stale' })
    expect(f.service.modeOf(f.parent)).toBe(false)
  })

  it('replays authorization when a saved policy checkpoint predates route additions', async () => {
    const f = await fixture()
    const extra = { provider: 'mock', model: 'other' }
    f.parent.session.append('subagent/model-selection-policy-authorized', { allowedModels: [extra] })
    const checkpoint = f.ctx.sessionProjections.checkpoint(f.parent.session)
    const policy = checkpoint['subagentModelSelectionPolicy']
    if (policy === undefined) throw new Error('Missing model-selection checkpoint')
    const older = { ...checkpoint, subagentModelSelectionPolicy: { ...policy, ver: 1, val: pool } }
    expect(f.ctx.sessionProjections.restoreFloor(older)).toBe(0)
    const replayed = f.ctx.sessionProjections.restore(older, f.parent.session.snapshotEvents(), SessionLogOffset(0),
      f.parent.session.header, f.parent.session.inheritedEventCount)
    expect(replayed.checkpoint['subagentModelSelectionPolicy']).toMatchObject({ ver: 2, val: [...pool, extra] })
  })
})

describe('pool settings and configuration', () => {
  it('distinguishes an explicitly empty pool from an inherited default', () => {
    const ctx = new Context()
    const emptyCtx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose(); await emptyCtx.fiber.dispose() })
    const inherited = new OrchestrationService(ctx, { pool, userPool: [] })
    expect(inherited.getPool()).toEqual(pool)
    const empty = new OrchestrationService(emptyCtx, { pool, userPool: [], userPoolConfigured: true })
    expect(empty.getPool()).toEqual([])
  })
  it('keeps the current pool when persistence is unavailable', async () => {
    const f = await fixture()
    const original = f.service.getPool()
    await expect(f.service.persistPool([], 0)).resolves.toMatchObject({ status: 'failed' })
    expect(f.service.getPool()).toEqual(original)
  })

  it('confirms saved routes and specialties regardless of object key order', async () => {
    const f = await fixture()
    const route = { provider: 'mock', model: 'worker' }
    f.ctx.provide('settings', { update: vi.fn().mockResolvedValue(undefined),
      describe: () => [{ ns: 'orchestration', revision: 2 }] } as never)
    vi.spyOn(f.service, 'getPoolConfiguration').mockReturnValue({
      pool: [{ model: 'worker', provider: 'mock' }], revision: 2,
      capabilityOverrides: [{ capabilities: ['coding'], model: 'worker', provider: 'mock' }],
    })
    await expect(f.service.persistPoolConfiguration([route], [{ ...route, capabilities: ['coding'] }], 1))
      .resolves.toMatchObject({ status: 'saved' })
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
