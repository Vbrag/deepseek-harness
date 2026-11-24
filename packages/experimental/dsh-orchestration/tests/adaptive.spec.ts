/** Real-child phase changes and bounded request recovery preserve identity, permissions, and tool effects. */

import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brandString } from '@deepseek-ai/dsh-brand'
import { expect, it, onTestFinished, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, LlmAdapter, LlmError, resolveRetryPolicy, ToolCallId, type GenerateOptions, type ImageBlock, type LlmBillingBudgetId, type LlmCallConfig, type LlmQueueAvailability,
  type LlmQueueRequest, type LlmRequestTokenBudget, type LlmResolvedModelInfo, type ResolvedRetryPolicy, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { appendPluginRecord, pluginRecordOf, Session, SessionId, SessionLogOffset, type EpochHeader, type SessionSeq } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Subagents, { type SubagentActivationSpec, type SubagentTaskAssessment } from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as ImageOffload from '@deepseek-ai/dsh-compaction-image-offload'
import CompactionEngine, { type CompactionAgentContext, type CompactionPressureBudget, type CompactionResult,
  type CompactionTrigger, type ManualCompactAgentContext } from '@deepseek-ai/dsh-compaction'
import { imageOffloadProjection } from '@deepseek-ai/dsh-compaction-image-offload/projection'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { TestSessionQuery } from '../../../subagent/subagent/tests/test-session-query.ts'
import { loadStoredSession } from '../../../subagent/subagent/tests/persistence-helpers.ts'
import Orchestration from '../src/index.ts'
import { adaptiveRoutingProjection } from '../src/adaptive-state.ts'
import type { OrchestrationConfig, OrchestrationRoutingState, PoolRoute } from '../src/types.ts'

const pool: PoolRoute[] = [{ provider: 'models', model: 'visual' }, { provider: 'models', model: 'solver' }]
const coding: SubagentTaskAssessment = { requiredCapabilities: ['coding'], contextTokens: 1000, outputTokens: 4096 }
const reasoning: SubagentTaskAssessment = { requiredCapabilities: ['reasoning'], contextTokens: 2000, outputTokens: 4096 }

function text(value: string): StreamChunk[] {
  return [{ type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text: value } }, { type: 'finish', reason: { kind: 'stop' } }]
}

function tool(name: string): StreamChunk[] {
  return [{ type: 'block-start', index: 0, blockType: 'tool-call' }, { type: 'block-end', index: 0,
    block: { type: 'tool-call', id: ToolCallId(name + '-call'), name, arguments: '{}' } },
  { type: 'finish', reason: { kind: 'tool-calls' } }]
}

type Script = StreamChunk[] | ((request: GenerateOptions) => Promise<StreamChunk[]>)
class Adapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  readonly facts = new Map<string, Partial<LlmResolvedModelInfo>>()
  readonly queues = new Map<string, LlmQueueAvailability>()
  readonly tokenLimits = new Map<string, number>()
  readonly failures = new Map<string, LlmError>()
  constructor(private readonly script: Script[], private readonly retryPolicy?: ResolvedRetryPolicy) { super() }
  override providerRetryPolicy(_provider: string): ResolvedRetryPolicy | undefined { return this.retryPolicy }
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const failure = this.failures.get(model)
    if (failure !== undefined) throw failure
    return { provider, id: model, name: model, inputModalities: ['text', 'image'],
      context: { contextWindow: 400_000 }, defaultMaxTokens: 128_000, maxOutputTokens: 131_072, ...this.facts.get(model) }
  }
  override queueAvailability(request: LlmQueueRequest): Promise<LlmQueueAvailability> {
    return Promise.resolve(this.queues.get(request.model) ?? { kind: 'unknown' })
  }
  override requestTokenBudget(request: LlmQueueRequest): Promise<LlmRequestTokenBudget | undefined> {
    const tokenLimit = this.tokenLimits.get(request.model)
    if (tokenLimit === undefined) return Promise.resolve(undefined)
    const outputTokens = request.maxTokens ?? 0
    return Promise.resolve({ tokenLimit, inputTokens: request.inputTokens, outputTokens, estimatedTokens: request.inputTokens + outputTokens })
  }
  override async * stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(request)
    const next = this.script.shift()
    if (next === undefined) throw new Error('Adaptive routing script exhausted')
    yield* typeof next === 'function' ? await next(request) : next
  }
}

async function fixture(script: Script[], config: OrchestrationConfig = {}, persistent = false, granted?: PoolRoute[],
  retryPolicy?: ResolvedRetryPolicy) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  if (persistent) {
    const root = await mkdtemp(join(tmpdir(), 'dsh-adaptive-cold-'))
    onTestFinished(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
    await ctx.plugin(JsonlSessionPersistence, { root })
    await ctx.plugin(TestSessionQuery)
  }
  const flush = vi.spyOn(ctx.sessions, 'flush')
  if (!persistent) flush.mockResolvedValue(true)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Subagents)
  await ctx.plugin(Spawn, { providerName: 'spawn' })
  await ctx.plugin(ImageOffload)
  const adapter = new Adapter(script, retryPolicy)
  ctx.llm.registerAdapter(['models'], adapter)
  const { routeCapabilities, ...policy } = config
  const defaults: NonNullable<OrchestrationConfig['routeCapabilities']> = [
    { ...pool[0]!, capabilities: ['coding', 'vision'] }, { ...pool[1]!, capabilities: ['coding', 'reasoning'] },
  ]
  await ctx.plugin(Orchestration, { pool, routeCapabilities: (routeCapabilities ?? defaults)
    .map(route => ({ ...route, capabilities: [...route.capabilities] })), ...policy })
  const parent = (await ctx.agents.create({ sessionId: SessionId('adaptive-parent'),
    agentOptions: { provider: 'models', model: 'lead' } })).agent
  parent.session.append('subagent/model-selection-policy', { allowedModels: granted ?? config.pool ?? pool })
  ctx.orchestrations.setMode(parent, true)
  const children: Agent[] = []
  ctx.on('agent/created', ({ agent }) => { if (agent.session.header.origin === 'subagent') children.push(agent) })
  const start = (extra: Partial<SubagentActivationSpec> = {}) => ctx.subagents.startActivation({
    parent, provider: 'spawn', delivery: 'caller', label: 'implement', prompt: [{ type: 'text', text: 'Implement the task' }],
    taskAssessment: coding, signal: new AbortController().signal, ...extra,
  })
  const state = (child: Agent): OrchestrationRoutingState => {
    const value = ctx.sessionProjections.snapshot(child.session).values.orchestrationRouting
    if (value === undefined) throw new Error('The child has no routing projection')
    return value
  }
  return { ctx, parent, adapter, children, start, state, flush }
}

function changes(child: Agent) {
  return child.session.snapshotEvents().flatMap((event) => {
    const record = pluginRecordOf(event)
    return record?.type === 'plugin:orchestration/routing-state' ? [adaptiveRoutingProjection.wire.viewSchema.parse(record.data)] : []
  })
}

it('ignores inherited phase requests and recovery counters while admitting the child own revision', async () => {
  const test = await fixture([])
  const inherited: OrchestrationRoutingState = {
    revision: 7, assessment: reasoning,
    request: { revision: 7, assessment: reasoning, reason: 'Ancestor phase', checkpoint: 'Ancestor checkpoint.' },
    route: pool[1]!, previous: pool[0]!, status: 'queued', reason: 'Ancestor phase', checkpoint: 'Ancestor checkpoint.',
    maxTokens: 8192, automaticChanges: 2, tried: [...pool], emptyLimits: 2, observedInputTokens: 120_000,
  }
  appendPluginRecord(test.parent.session, 'plugin:orchestration/routing-state', inherited)
  const seed = test.parent.session.snapshotEvents()
  const id = SessionId('seeded-phase-child')
  const child = Session.create(id, seed, { ...test.parent.session.header, id, isSeeded: true }, SessionLogOffset(seed.length))
  const initial = test.ctx.sessionProjections.snapshot(child).values.orchestrationRouting
  if (initial === undefined) throw new Error('The seeded child has no routing view')
  expect(initial).toMatchObject({ revision: 0, assessment: null, request: null, route: null,
    status: 'idle', checkpoint: '', maxTokens: null, automaticChanges: 0, tried: [], emptyLimits: 0, observedInputTokens: 0 })
  appendPluginRecord(child, 'plugin:orchestration/routing-state', {
    ...initial, revision: 1, assessment: coding, route: pool[0]!, reason: 'Child coding phase',
  })
  expect(test.ctx.sessionProjections.snapshot(child).values.orchestrationRouting).toMatchObject({
    revision: 1, assessment: coding, route: pool[0], request: null, automaticChanges: 0, tried: [], emptyLimits: 0,
  })
  expect(test.adapter.requests).toEqual([])
})

it('saves a stopped child phase without waking it and applies the requested model on normal resume', async () => {
  const test = await fixture([text('initial task complete'), text('resumed reasoning complete'), text('parent notified')], {}, true)
  const activation = await test.start()
  await activation.result
  await activation.dispose()
  const id = activation.childId
  expect(test.ctx.agents.get(id)).toBeUndefined()
  expect(test.ctx.sessions.get(id)).toBeUndefined()
  expect(test.adapter.requests.map(request => request.model)).toEqual(['visual'])
  const before = await loadStoredSession(test.ctx.sessionPersistence, id)
  await expect(test.ctx.subagents.requestModelChange({ caller: test.parent, target: id, taskAssessment: reasoning,
    reason: 'Continue with reasoning', checkpoint: 'Initial task is complete; preserve its result and analyze the next input.',
    preferredRoute: pool[1]!, maxTokens: 8192, signal: new AbortController().signal }))
    .resolves.toEqual({ status: 'queued', target: id })
  expect(test.ctx.agents.get(id)).toBeUndefined()
  expect(test.ctx.sessions.get(id)).toBeUndefined()
  expect(test.children).toHaveLength(1)
  expect(test.adapter.requests).toHaveLength(1)
  const saved = await loadStoredSession(test.ctx.sessionPersistence, id)
  const detached = Session.create(id, saved.events, saved.meta, saved.inheritedEventCount, [imageOffloadProjection])
  expect(test.ctx.sessionProjections.snapshot(detached).values.orchestrationRouting).toMatchObject({
    status: 'queued', request: { assessment: reasoning, preferredRoute: pool[1], maxTokens: 8192 },
  })
  expect(saved.events.filter(event => event.type === 'user/message')).toHaveLength(before.events.filter(event => event.type === 'user/message').length)
  const ended = Promise.withResolvers<undefined>()
  test.ctx.on('subagent/end', (info) => { if (info.id === id) ended.resolve(undefined) })
  await test.ctx.subagents.sendMessage(test.parent, id, [{ type: 'text', text: 'Now analyze the preserved result.' }],
    { signal: new AbortController().signal })
  await ended.promise
  expect(test.adapter.requests.filter(request => request.sessionId === id).map(request => [request.model, request.maxTokens]))
    .toEqual([['visual', 128_000], ['solver', 8192]])
  expect(test.children.map(child => child.id)).toEqual([id, id])
})

it('admits against the actual adapter output default rather than the smaller assessment allowance', async () => {
  const test = await fixture([text('done')])
  test.adapter.facts.set('visual', { context: { contextWindow: 100_000 } })
  const activation = await test.start()
  await activation.result
  expect(test.adapter.requests.map(request => [request.model, request.maxTokens])).toEqual([['solver', 128_000]])
  expect(test.children).toHaveLength(1)
})

it('shares a provider retry delay with fresh delegations after the recovered child releases its assignment', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
  onTestFinished(() => { clock.mockRestore() })
  const test = await fixture([
    [{ type: 'finish', reason: { kind: 'error', failure: {
      code: 'RATE_LIMIT', message: 'Provider capacity exhausted', providerRetryAfterMs: 60_000,
    } } }], text('recovered'), text('new child'), text('cooldown expired'),
  ])
  test.adapter.queues.set('visual', { kind: 'ready' })
  test.adapter.queues.set('solver', { kind: 'ready' })
  const first = await test.start()
  try {
    expect((await first.result).stopReason).toBe('completed')
    expect(test.adapter.requests.map(request => request.model)).toEqual(['visual', 'solver'])
  } finally { await first.dispose() }
  const second = await test.start()
  try {
    expect((await second.result).stopReason).toBe('completed')
    expect(test.adapter.requests.map(request => request.model)).toEqual(['visual', 'solver', 'solver'])
  } finally { await second.dispose() }
  clock.mockReturnValue(61_001)
  const third = await test.start()
  try {
    expect((await third.result).stopReason).toBe('completed')
    expect(test.adapter.requests.map(request => request.model)).toEqual(['visual', 'solver', 'solver', 'visual'])
  } finally { await third.dispose() }
})

it('changes a queued current route before dispatching the next request and preserves the completed tool', async () => {
  const test = await fixture([tool('consume_capacity'), text('available route completed')])
  test.adapter.queues.set('visual', { kind: 'ready' })
  test.adapter.queues.set('solver', { kind: 'ready' })
  const effect = vi.fn(async () => {
    test.adapter.queues.set('visual', { kind: 'wait', waitMs: 60_000 })
    return []
  })
  test.ctx.tools.register(defineContentToolFixture({ name: 'consume_capacity', description: 'Consume current provider capacity',
    parameters: {}, execute: effect }))
  const activation = await test.start()
  try {
    expect((await activation.result).stopReason).toBe('completed')
    expect(test.adapter.requests.map(request => request.model)).toEqual(['visual', 'solver'])
    expect(effect).toHaveBeenCalledOnce()
    const child = test.children[0]
    if (child === undefined) throw new Error('No child was created')
    expect(changes(child).findLast(state => state.reason === 'quota-pressure')).toMatchObject({ route: pool[1] })
    expect(child.session.snapshotEvents().filter(event => event.type === 'assistant/attempt')).toHaveLength(0)
    expect(child.session.snapshotEvents().filter(event => event.type === 'tool/result')).toHaveLength(1)
  } finally { await activation.dispose() }
})

it('offers TPM pressure to compaction before switching after a completed tool', async () => {
  class TpmCompaction extends CompactionEngine {
    override tpmThreshold(_config: LlmCallConfig, limit: number): number { return Math.floor(limit * 0.9) }
    override compactIfNeeded(_agent: CompactionAgentContext, _trigger: CompactionTrigger,
      _signal: AbortSignal): Promise<CompactionResult | null> { return Promise.resolve(null) }
    override compactNow(_agent: ManualCompactAgentContext, _signal: AbortSignal): Promise<CompactionResult | null> {
      return Promise.resolve(null)
    }
    override compactRegion(_start: SessionSeq, _end: SessionSeq, _agent: CompactionAgentContext,
      _signal?: AbortSignal): Promise<CompactionResult> { return Promise.reject(new Error('Unexpected summary')) }
  }
  const failure: StreamChunk[] = [{ type: 'finish', reason: { kind: 'error', failure: {
    code: 'RATE_LIMIT_REQUEST_TOO_LARGE', message: 'The compacted request cannot fit.',
  } } }]
  const test = await fixture([tool('exhaust_tpm'), failure, text('recovered on another route')])
  test.adapter.queues.set('visual', { kind: 'ready' })
  test.adapter.queues.set('solver', { kind: 'ready' })
  test.adapter.tokenLimits.set('visual', 150_000)
  await test.ctx.plugin(TpmCompaction)
  const effect = vi.fn(async () => {
    test.adapter.queues.set('visual', { kind: 'impossible', estimatedTokens: 160_000, tokenLimit: 150_000 })
    return []
  })
  test.ctx.tools.register(defineContentToolFixture({ name: 'exhaust_tpm', description: 'Exhaust the current request budget',
    parameters: {}, execute: effect }))
  const activation = await test.start()
  try {
    expect((await activation.result).stopReason).toBe('completed')
    expect(test.adapter.requests.map(request => request.model)).toEqual(['visual', 'visual', 'solver'])
    expect(effect).toHaveBeenCalledOnce()
    expect(test.children[0]?.session.snapshotEvents().filter(event => event.type === 'tool/result')).toHaveLength(1)
  } finally { await activation.dispose() }
})

it.each([false, true])('offers pressure to compaction only after checking a ready larger route (larger: %s)', async (larger) => {
  class PressureCompaction extends CompactionEngine {
    readonly admittedRoutes: (string | undefined)[] = []
    constructor(ctx: Context) {
      super(ctx)
      ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
        this.admittedRoutes.push(agent.model.current()?.model)
        await this.compactIfNeeded(agent, 'pressure', signal)
        return next()
      })
    }
    override pressureBudget(_agent: CompactionAgentContext, header: EpochHeader,
      _signal: AbortSignal): Promise<CompactionPressureBudget> {
      return Promise.resolve({ thresholdTokens: header.config.model === 'visual' ? 5000 : 500_000, retainTokens: 1000 })
    }
    override compactIfNeeded(_agent: CompactionAgentContext, _trigger: CompactionTrigger,
      _signal: AbortSignal): Promise<CompactionResult | null> { return Promise.resolve(null) }
    override compactNow(_agent: ManualCompactAgentContext, _signal: AbortSignal): Promise<CompactionResult | null> {
      return Promise.resolve(null)
    }
    override compactRegion(_start: SessionSeq, _end: SessionSeq, _agent: CompactionAgentContext,
      _signal?: AbortSignal): Promise<CompactionResult> { return Promise.reject(new Error('Unexpected summary request')) }
  }
  const test = await fixture([text('completed without a summary')])
  test.adapter.facts.set('solver', { context: { contextWindow: larger ? 800_000 : 400_000 } })
  test.adapter.queues.set('visual', { kind: 'ready' })
  test.adapter.queues.set('solver', { kind: 'ready' })
  await test.ctx.plugin(PressureCompaction)
  const compaction = test.ctx.compaction as PressureCompaction
  const compact = vi.spyOn(compaction, 'compactIfNeeded')
  const summary = vi.spyOn(compaction, 'compactRegion')
  const activation = await test.start()
  try {
    expect((await activation.result).stopReason).toBe('completed')
    expect(test.adapter.requests.map(request => request.model)).toEqual([larger ? 'solver' : 'visual'])
    expect(compaction.admittedRoutes).toEqual([larger ? 'solver' : 'visual'])
    expect(compact).toHaveBeenCalledOnce()
    expect(summary).not.toHaveBeenCalled()
    expect(test.adapter.requests.every(request => request.purpose === undefined)).toBe(true)
    const child = test.children[0]
    if (child === undefined) throw new Error('No child was created')
    expect(changes(child).some(state => state.reason === 'context-pressure' && state.route?.model === 'solver')).toBe(larger)
  } finally { await activation.dispose() }
})

it('changes an explicitly assessed visual/coding phase to reasoning at the next step in the same child', async () => {
  const test = await fixture([tool('next_phase'), text('reasoned result')])
  test.adapter.facts.set('solver', { inputModalities: ['text'] })
  let queued = false
  test.ctx.tools.register(defineContentToolFixture({ name: 'next_phase', description: 'Request the assessed reasoning phase', parameters: {},
    execute: async (_args, exec) => {
      const child = exec.agent
      if (child === undefined) throw new Error('The phase requires a child')
      const result = await test.ctx.subagents.requestModelChange({ caller: child, target: child.id, taskAssessment: reasoning,
        reason: 'Reason about the inspected controls', checkpoint: 'Visual inspection complete; preserve the observed control labels.',
        maxTokens: 8192, signal: exec.signal })
      expect(result).toMatchObject({ status: 'queued', target: child.id })
      expect(test.state(child).status).toBe('queued')
      expect(child.model.current()?.model).toBe('visual')
      queued = true
      return []
    } }))
  const image: ImageBlock = { type: 'image', attachment: {
    attachmentId: brandString<ImageBlock['attachment']['attachmentId']>('visual-phase-image'),
    bytes: 100, width: 10, height: 10, mediaType: 'image/png',
  } }
  const activation = await test.start({ taskAssessment: { ...coding, requiredCapabilities: ['coding', 'vision'] },
    prompt: [{ type: 'text', text: 'Inspect this image before reasoning about the controls.' }, image] })
  await activation.result
  const child = test.children[0]
  if (child === undefined) throw new Error('No child was created')
  expect(queued).toBe(true)
  expect(test.adapter.requests.map(request => [request.model, request.maxTokens])).toEqual([['visual', 128_000], ['solver', 8192]])
  expect(test.adapter.requests[0]?.messages.some(message => message.content.some(block => block.type === 'image'))).toBe(true)
  expect(test.adapter.requests[1]?.messages.some(message => message.content.some(block => block.type === 'image' && block.offloaded !== true)))
    .toBe(false)
  expect(child.session.snapshotEvents().filter(event => event.type === 'image/offload')).toHaveLength(1)
  expect(new Set(test.adapter.requests.map(request => request.sessionId))).toEqual(new Set([child.id]))
  expect(test.children).toHaveLength(1)
  expect(test.state(child)).toMatchObject({ status: 'idle', route: pool[1], request: null, maxTokens: 8192 })
  const restored = Session.create(child.id, child.session.snapshotEvents(), { ...child.session.header },
    child.session.inheritedEventCount, [imageOffloadProjection])
  expect(test.ctx.sessionProjections.snapshot(restored).values.orchestrationRouting).toEqual(test.state(child))
  expect(test.adapter.requests).toHaveLength(2)
})

it('interrupts a current generation for an acknowledged parent phase without ending or replacing the child', async () => {
  const started = Promise.withResolvers<undefined>()
  const test = await fixture([async (request) => {
    await new Promise<void>((resolve) => {
      request.signal?.addEventListener('abort', () => { resolve() }, { once: true })
      started.resolve(undefined)
    })
    return []
  }, text('new phase complete')])
  const activation = await test.start()
  try {
    await started.promise
    const child = test.children[0]
    if (child === undefined) throw new Error('No child was created')
    await test.ctx.subagents.requestModelChange({ caller: test.parent, target: child.id, taskAssessment: reasoning,
      reason: 'Proceed to reasoning', checkpoint: 'Preserve completed visual findings.', interruptCurrentRequest: true,
      signal: new AbortController().signal })
    const result = await activation.result
    expect(result.stopReason).toBe('completed')
    expect(test.adapter.requests.map(request => request.model)).toEqual(['visual', 'solver'])
    expect(test.children).toHaveLength(1)
    expect(child.session.snapshotEvents().filter(event => event.type === 'turn/start')).toHaveLength(1)
    expect(child.session.snapshotEvents().filter(event => event.type === 'assistant/attempt')).toHaveLength(1)
  } finally {
    await activation.dispose()
    await activation.result
  }
})

it.each(['RATE_LIMIT', 'CONTEXT_WINDOW_EXCEEDED'] as const)('recovers %s without replaying an executed tool', async (code) => {
  const test = await fixture([tool('write_once'), [{ type: 'finish', reason: { kind: 'error', failure: { code, message: 'Rejected request' } } }],
    text('recovered')])
  const write = vi.fn(async () => [])
  test.ctx.tools.register(defineContentToolFixture({ name: 'write_once', description: 'Perform the task effect once', parameters: {}, execute: write }))
  const activation = await test.start()
  const result = await activation.result
  expect(result.stopReason).toBe('completed')
  expect(test.adapter.requests.map(request => request.model)).toEqual(['visual', 'visual', 'solver'])
  expect(write).toHaveBeenCalledTimes(1)
  const child = test.children[0]
  if (child === undefined) throw new Error('No child was created')
  expect(child.session.snapshotEvents().filter(event => event.type === 'tool/result')).toHaveLength(1)
  expect(changes(child).findLast(state => state.reason === code)).toMatchObject({ route: pool[1] })
  expect(test.children).toHaveLength(1)
})

it('continues a child on a known-free route after a billing failure without replaying its tool', async () => {
  const test = await fixture([tool('write_once'),
    [{ type: 'finish', reason: { kind: 'error', failure: { code: 'BILLING_EXHAUSTED', message: 'budget exhausted', status: 422 } } }],
    text('recovered')])
  test.adapter.facts.set('visual', { billing: { free: false } })
  test.adapter.facts.set('solver', { billing: { free: true } })
  const write = vi.fn(async () => [])
  test.ctx.tools.register(defineContentToolFixture({ name: 'write_once', description: 'Perform the task effect once', parameters: {}, execute: write }))
  const activation = await test.start()
  const result = await activation.result
  expect(result.stopReason).toBe('completed')
  expect(test.adapter.requests.map(request => request.model)).toEqual(['visual', 'visual', 'solver'])
  expect(write).toHaveBeenCalledTimes(1)
  expect(changes(test.children[0]!).findLast(state => state.reason === 'BILLING_EXHAUSTED')).toMatchObject({ route: pool[1] })
})

it('blocks rather than retrying a depleted unknown billing account', async () => {
  const test = await fixture([[{ type: 'finish', reason: { kind: 'error',
    failure: { code: 'BILLING_EXHAUSTED', message: 'budget exhausted' } } }]])
  const activation = await test.start()
  const result = await activation.result
  expect(result.stopReason).toBe('error')
  expect(test.adapter.requests).toHaveLength(1)
  expect(test.state(test.children[0]!)).toMatchObject({ status: 'blocked' })
})

it('does not select another paid model sharing the exhausted billing account', async () => {
  const test = await fixture([[{ type: 'finish', reason: { kind: 'error',
    failure: { code: 'BILLING_EXHAUSTED', message: 'budget exhausted' } } }]])
  const budgetId = brandString<LlmBillingBudgetId>('shared-account')
  test.adapter.facts.set('visual', { billing: { free: false, budgetId } })
  test.adapter.facts.set('solver', { billing: { free: false, budgetId } })
  const activation = await test.start()
  expect((await activation.result).stopReason).toBe('error')
  expect(test.adapter.requests.map(request => request.model)).toEqual(['visual'])
  expect(test.state(test.children[0]!)).toMatchObject({ status: 'blocked' })
})

it('can select an authorized paid model with a separate billing account', async () => {
  const test = await fixture([[{ type: 'finish', reason: { kind: 'error',
    failure: { code: 'BILLING_EXHAUSTED', message: 'budget exhausted' } } }], text('recovered')])
  test.adapter.facts.set('visual', { billing: { free: false, budgetId: brandString<LlmBillingBudgetId>('depleted') } })
  test.adapter.facts.set('solver', { billing: { free: false, budgetId: brandString<LlmBillingBudgetId>('independent') } })
  const activation = await test.start()
  expect((await activation.result).stopReason).toBe('completed')
  expect(test.adapter.requests.map(request => request.model)).toEqual(['visual', 'solver'])
})

it('does not expand a child route grant when billing recovery finds a free model', async () => {
  const test = await fixture([[{ type: 'finish', reason: { kind: 'error',
    failure: { code: 'BILLING_EXHAUSTED', message: 'budget exhausted' } } }]], {}, false, [pool[0]!])
  test.adapter.facts.set('visual', { billing: { free: false } })
  test.adapter.facts.set('solver', { billing: { free: true } })
  const activation = await test.start()
  expect((await activation.result).stopReason).toBe('error')
  expect(test.adapter.requests.map(request => request.model)).toEqual(['visual'])
  expect(test.state(test.children[0]!)).toMatchObject({ status: 'blocked' })
})

it('honors the configured automatic reassignment limit', async () => {
  const failure: StreamChunk[] = [{ type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: 'busy' } } }]
  const test = await fixture([failure, failure], { maxAutomaticReassignments: 1 })
  const activation = await test.start()
  expect((await activation.result).stopReason).toBe('error')
  expect(test.adapter.requests.map(request => request.model)).toEqual(['visual', 'solver'])
  expect(test.state(test.children[0]!)).toMatchObject({ status: 'blocked', automaticChanges: 1 })
})

it('permits a corrected billing account to be retried after a user reset', async () => {
  const test = await fixture([[{ type: 'finish', reason: { kind: 'error',
    failure: { code: 'BILLING_EXHAUSTED', message: 'budget exhausted' } } }], text('account restored')])
  const budgetId = brandString<LlmBillingBudgetId>('shared-account')
  test.adapter.facts.set('visual', { billing: { free: false, budgetId } })
  test.adapter.facts.set('solver', { billing: { free: false, budgetId } })
  const first = await test.start()
  expect((await first.result).stopReason).toBe('error')
  await first.dispose()
  test.ctx.orchestrations.resetBillingHealth()
  const second = await test.start()
  expect((await second.result).stopReason).toBe('completed')
  expect(test.adapter.requests).toHaveLength(2)
  await second.dispose()
})

it('shares billing failures between simultaneous children', async () => {
  const bothEntered = Promise.withResolvers<undefined>()
  const barrier = Promise.withResolvers<undefined>()
  let count = 0
  const fail = async (): Promise<StreamChunk[]> => {
    if (++count === 2) bothEntered.resolve(undefined)
    await barrier.promise
    return [{ type: 'finish', reason: { kind: 'error', failure: { code: 'BILLING_EXHAUSTED', message: 'budget exhausted' } } }]
  }
  const free = { provider: 'models', model: 'free' }
  const test = await fixture([fail, fail, text('first recovered'), text('second recovered')], {
    pool: [...pool, free], routeCapabilities: [...pool, free].map(route => ({ ...route, capabilities: ['coding'] })),
  })
  const budgetId = brandString<LlmBillingBudgetId>('shared-account')
  test.adapter.facts.set('visual', { billing: { free: false, budgetId } })
  test.adapter.facts.set('solver', { billing: { free: false, budgetId } })
  test.adapter.facts.set('free', { billing: { free: true, budgetId } })
  const activations = await Promise.all([test.start(), test.start()])
  try {
    await bothEntered.promise
    barrier.resolve(undefined)
    expect((await Promise.all(activations.map(activation => activation.result))).map(result => result.stopReason))
      .toEqual(['completed', 'completed'])
    expect(test.adapter.requests.slice(2).map(request => request.model)).toEqual(['free', 'free'])
  } finally {
    barrier.resolve(undefined)
    await Promise.all(activations.map(activation => activation.dispose()))
  }
})

it('records the failed child billing budget from the dispatched adapter generation', async () => {
  const exhausted = brandString<LlmBillingBudgetId>('exhausted')
  const replacement = brandString<LlmBillingBudgetId>('replacement')
  const free = { provider: 'models', model: 'free' }
  let adapter: Adapter | undefined
  const test = await fixture([async () => {
    if (adapter === undefined) throw new Error('Adapter not ready')
    adapter.facts.set('visual', { billing: { free: false, budgetId: replacement } })
    return [{ type: 'finish', reason: { kind: 'error', failure: { code: 'BILLING_EXHAUSTED', message: 'budget exhausted' } } }]
  }, text('recovered')], {
    pool: [...pool, free], routeCapabilities: [...pool, free].map(route => ({ ...route, capabilities: ['coding'] })),
  })
  adapter = test.adapter
  adapter.facts.set('visual', { billing: { free: false, budgetId: exhausted } })
  adapter.facts.set('solver', { billing: { free: false, budgetId: exhausted } })
  adapter.facts.set('free', { billing: { free: true } })
  const activation = await test.start()
  try {
    expect((await activation.result).stopReason).toBe('completed')
    expect(test.adapter.requests.map(request => request.model)).toEqual(['visual', 'free'])
  } finally {
    await activation.dispose()
  }
})

it('blocks the selected lead after a child exhausts their shared budget and resumes it after reset', async () => {
  const test = await fixture([tool('hold_lead'), [{ type: 'finish', reason: { kind: 'error',
    failure: { code: 'BILLING_EXHAUSTED', message: 'budget exhausted' } } }], text('child recovered'), text('lead recovered')])
  const budgetId = brandString<LlmBillingBudgetId>('shared-account')
  test.adapter.facts.set('lead', { billing: { free: false, budgetId } })
  test.adapter.facts.set('visual', { billing: { free: false, budgetId } })
  test.adapter.facts.set('solver', { billing: { free: true } })
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  test.ctx.tools.register(defineContentToolFixture({ name: 'hold_lead', description: 'Hold the lead between requests', parameters: {},
    execute: async () => { entered.resolve(undefined); await release.promise; return [] } }))
  test.parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Continue the task' }], source: { kind: 'user' } }))
  let activation: Awaited<ReturnType<typeof test.start>> | undefined
  try {
    await entered.promise
    activation = await test.start()
    expect((await activation.result).stopReason).toBe('completed')
    release.resolve(undefined)
    await test.parent.whenIdle()
    expect(test.adapter.requests.map(request => request.model)).toEqual(['lead', 'visual', 'solver'])
    expect(test.parent.session.snapshotEvents().filter(event => event.type === 'tool/result')).toHaveLength(1)
    expect(test.state(test.parent)).toMatchObject({ status: 'blocked', reason: 'BILLING_UNAVAILABLE', route: { provider: 'models', model: 'lead' } })
    test.ctx.orchestrations.resetBillingHealth()
    test.parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Resume after correcting billing.' }], source: { kind: 'user' } }))
    await test.parent.whenIdle()
    expect(test.adapter.requests.map(request => request.model)).toEqual(['lead', 'visual', 'solver', 'lead'])
    expect(test.parent.session.snapshotEvents().filter(event => event.type === 'tool/result')).toHaveLength(1)
    expect(test.state(test.parent)).toMatchObject({ status: 'idle', route: { provider: 'models', model: 'lead' } })
  } finally {
    release.resolve(undefined)
    await activation?.dispose()
    await test.parent.whenIdle()
  }
})

it('records a new lead prompt before shared billing blocks dispatch', async () => {
  const test = await fixture([[{ type: 'finish', reason: { kind: 'error',
    failure: { code: 'BILLING_EXHAUSTED', message: 'budget exhausted' } } }], text('child recovered'), text('lead resumed')])
  const budgetId = brandString<LlmBillingBudgetId>('shared-account')
  test.adapter.facts.set('lead', { billing: { free: false, budgetId } })
  test.adapter.facts.set('visual', { billing: { free: false, budgetId } })
  test.adapter.facts.set('solver', { billing: { free: true } })
  const activation = await test.start()
  try {
    expect((await activation.result).stopReason).toBe('completed')
    const prompt = 'Preserve this task while billing is blocked.'
    test.parent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }))
    await test.parent.whenIdle()
    expect(test.adapter.requests.map(request => request.model)).toEqual(['visual', 'solver'])
    expect(test.state(test.parent)).toMatchObject({ status: 'blocked', reason: 'BILLING_UNAVAILABLE' })
    expect(test.parent.session.snapshotEvents().filter(event => event.type === 'user/message'
      && event.data.content.some(block => block.type === 'text' && block.text === prompt))).toHaveLength(1)
    expect(test.parent.session.snapshotEvents().findLast(event => event.type === 'turn/end')).toMatchObject({
      data: { reason: { kind: 'error', error: { code: 'ORCHESTRATION_BILLING_UNAVAILABLE' } } },
    })
    test.ctx.orchestrations.resetBillingHealth()
    test.parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Resume.' }], source: { kind: 'user' } }))
    await test.parent.whenIdle()
    expect(test.adapter.requests.map(request => request.model)).toEqual(['visual', 'solver', 'lead'])
    expect(test.adapter.requests.at(-1)?.messages.some(message => message.content.some(block => block.type === 'text' && block.text === prompt))).toBe(true)
  } finally {
    await activation.dispose()
  }
})

it.each([true, false])('checks shared billing using the prepared lead model facts (free: %s)', async (preparedFree) => {
  const test = await fixture([[{ type: 'finish', reason: { kind: 'error',
    failure: { code: 'BILLING_EXHAUSTED', message: 'budget exhausted' } } }], text('child recovered'), text('lead completed')])
  const budgetId = brandString<LlmBillingBudgetId>('shared-account')
  test.adapter.facts.set('visual', { billing: { free: false, budgetId } })
  test.adapter.facts.set('solver', { billing: { free: true } })
  test.adapter.facts.set('lead', { billing: { free: preparedFree, budgetId } })
  const activation = await test.start()
  try {
    expect((await activation.result).stopReason).toBe('completed')
    test.ctx.on('agent/request-ready', ({ agent }, next) => {
      if (agent === test.parent) test.adapter.facts.set('lead', { billing: { free: !preparedFree, budgetId } })
      return next()
    }, { prepend: true })
    test.parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Continue.' }], source: { kind: 'user' } }))
    await test.parent.whenIdle()
    expect(test.adapter.requests.map(request => request.model)).toEqual(preparedFree ? ['visual', 'solver', 'lead'] : ['visual', 'solver'])
    expect(test.state(test.parent).status).toBe(preparedFree ? 'idle' : 'blocked')
  } finally {
    await activation.dispose()
  }
})

it('keeps the selected lead after billing exhaustion until the user selects a new model', async () => {
  const test = await fixture([[{ type: 'finish', reason: { kind: 'error',
    failure: { code: 'BILLING_EXHAUSTED', message: 'budget exhausted' } } }], text('lead recovered')])
  test.adapter.facts.set('lead', { billing: { free: false } })
  test.adapter.facts.set('visual', { billing: { free: true } })
  test.adapter.facts.set('solver', { billing: { free: true } })
  test.parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Continue the task' }], source: { kind: 'user' } }))
  await test.parent.whenIdle()
  expect(test.adapter.requests.map(request => request.model)).toEqual(['lead'])
  expect(test.parent.model.current()).toMatchObject({ provider: 'models', model: 'lead' })
  expect(test.state(test.parent)).toMatchObject({ status: 'blocked', reason: 'BILLING_EXHAUSTED' })
  expect(test.parent.session.snapshotEvents().filter(event => event.type === 'turn/start')).toHaveLength(1)
  expect(test.parent.session.snapshotEvents().filter(event => event.type === 'assistant/attempt')).toHaveLength(1)
  test.parent.model.select({ provider: 'models', model: 'visual' })
  test.parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Retry with my selected model.' }], source: { kind: 'user' } }))
  await test.parent.whenIdle()
  expect(test.adapter.requests.map(request => request.model)).toEqual(['lead', 'visual'])
  expect(test.state(test.parent)).toMatchObject({ status: 'idle', reason: '', route: pool[0] })
})

it('clears a blocked lead when an explicit retry is admitted after disabling orchestration', async () => {
  const test = await fixture([[{ type: 'finish', reason: { kind: 'error',
    failure: { code: 'BILLING_EXHAUSTED', message: 'budget exhausted' } } }], text('continued')])
  test.parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Continue.' }], source: { kind: 'user' } }))
  await test.parent.whenIdle()
  expect(test.state(test.parent)).toMatchObject({ status: 'blocked' })
  test.ctx.orchestrations.setMode(test.parent, false)
  test.parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Retry.' }], source: { kind: 'user' } }))
  await test.parent.whenIdle()
  expect(test.adapter.requests.map(request => request.model)).toEqual(['lead', 'lead'])
  expect(test.state(test.parent)).toMatchObject({ status: 'idle', reason: '' })
})

it.each(['step-preparation', 'request-preparation'] as const)(
  'retains a claimed lead prompt after %s fails before admission', async (stage) => {
    const test = await fixture([text('continued')])
    const failure = new LlmError('model preparation failed', 'INVALID_MODEL_INFO')
    let failStep = stage === 'step-preparation'
    if (stage === 'request-preparation') test.adapter.failures.set('lead', failure)
    test.ctx.on('agent/step-preparing', ({ agent }) => {
      if (agent === test.parent && failStep) throw failure
    })
    const prompt = 'Keep this task if preparation fails.'
    test.parent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }))
    await test.parent.whenIdle()
    expect(test.adapter.requests).toHaveLength(0)
    expect(test.state(test.parent)).toMatchObject({ status: 'blocked', reason: 'INVALID_MODEL_INFO' })
    expect(test.parent.session.snapshotEvents().filter(event => event.type === 'user/message'
      && event.data.content.some(block => block.type === 'text' && block.text === prompt))).toHaveLength(1)
    failStep = false
    test.adapter.failures.delete('lead')
    test.parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Retry.' }], source: { kind: 'user' } }))
    await test.parent.whenIdle()
    expect(test.adapter.requests).toHaveLength(1)
    expect(test.adapter.requests[0]?.messages.some(message => message.content.some(block => block.type === 'text' && block.text === prompt))).toBe(true)
  },
)

it.each(['step-preparation', 'request-preparation'] as const)(
  'does not duplicate admitted input when %s fails during repreparation', async (stage) => {
    const test = await fixture([[{ type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: 'busy' } } }]])
    const failure = new LlmError('model preparation failed', 'INVALID_MODEL_INFO')
    let failStep = false
    test.ctx.on('agent/step-preparing', ({ agent }) => {
      if (agent === test.parent && failStep) throw failure
    })
    test.ctx.on('agent/request-error', ({ agent, failure: result }, next) => {
      if (agent !== test.parent || result.code !== 'RATE_LIMIT') return next()
      if (stage === 'step-preparation') failStep = true
      else test.adapter.failures.set('lead', failure)
      return Promise.resolve({ kind: 'reprepare' as const })
    })
    const prompt = 'Keep this task once.'
    test.parent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }))
    await test.parent.whenIdle()
    expect(test.adapter.requests.map(request => request.model)).toEqual(['lead'])
    expect(test.state(test.parent)).toMatchObject({ status: 'blocked', reason: 'INVALID_MODEL_INFO' })
    expect(test.parent.session.snapshotEvents().filter(event => event.type === 'user/message'
      && event.data.content.some(block => block.type === 'text' && block.text === prompt))).toHaveLength(1)
  },
)

it.each(['RATE_LIMIT', 'CONTEXT_WINDOW_EXCEEDED', 'RATE_LIMIT_REQUEST_TOO_LARGE', 'SERVER', 'AUTH'] as const)(
  'blocks the selected lead after %s without selecting a pool route', async (code) => {
    const test = await fixture([[{ type: 'finish', reason: { kind: 'error', failure: { code, message: 'request failed' } } }]])
    test.parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Continue.' }], source: { kind: 'user' } }))
    await test.parent.whenIdle()
    expect(test.adapter.requests.map(request => request.model)).toEqual(['lead'])
    expect(test.parent.model.current()).toMatchObject({ provider: 'models', model: 'lead' })
    expect(test.state(test.parent)).toMatchObject({ status: 'blocked', reason: code })
    expect(test.parent.session.snapshotEvents().filter(event => event.type === 'model/selection')).toHaveLength(0)
    expect(test.parent.session.snapshotEvents().findLast(event => event.type === 'turn/end')).toMatchObject({
      data: { reason: { kind: 'error', error: { code } } },
    })
  },
)

it.each(['RATE_LIMIT', 'CONTEXT_WINDOW_EXCEEDED'] as const)(
  'allows bounded same-model recovery from %s without replaying a completed tool', async (code) => {
    const test = await fixture([tool('lead_write_once'),
      [{ type: 'finish', reason: { kind: 'error', failure: { code, message: 'request failed' } } }], text('recovered')])
    const write = vi.fn(async () => [])
    test.ctx.tools.register(defineContentToolFixture({ name: 'lead_write_once', description: 'Complete the effect once',
      parameters: {}, execute: write }))
    const recover = vi.fn()
    test.ctx.on('agent/request-error', ({ agent, failure }, next) => {
      if (agent !== test.parent || failure.code !== code) return next()
      recover()
      return Promise.resolve({ kind: 'retry' as const })
    })
    test.parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Continue.' }], source: { kind: 'user' } }))
    await test.parent.whenIdle()
    expect(recover).toHaveBeenCalledOnce()
    expect(test.adapter.requests.map(request => request.model)).toEqual(['lead', 'lead', 'lead'])
    expect(write).toHaveBeenCalledOnce()
    expect(test.parent.session.snapshotEvents().filter(event => event.type === 'tool/result')).toHaveLength(1)
    expect(test.parent.session.snapshotEvents().filter(event => event.type === 'turn/start')).toHaveLength(1)
    expect(test.parent.session.snapshotEvents().findLast(event => event.type === 'turn/end')).toMatchObject({
      data: { reason: { kind: 'completed' } },
    })
  },
)

it('does not delegate an unbounded provider retry policy for a failed lead request', async () => {
  const policy = resolveRetryPolicy({ mode: 'always' }, 'lead retry policy')
  const test = await fixture([[{ type: 'finish', reason: { kind: 'error',
    failure: { code: 'SERVER', message: 'server unavailable' } } }], text('unexpected')], {}, false, undefined, policy)
  const downstream = vi.fn(() => Promise.resolve({ kind: 'retry' as const }))
  test.ctx.on('agent/request-error', downstream)
  test.parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Continue.' }], source: { kind: 'user' } }))
  await test.parent.whenIdle()
  expect(downstream).not.toHaveBeenCalled()
  expect(test.adapter.requests.map(request => request.model)).toEqual(['lead'])
  expect(test.state(test.parent)).toMatchObject({ status: 'blocked', reason: 'SERVER' })
})

it('keeps the lead fixed when its bounded same-model retry is exhausted', async () => {
  const failure: StreamChunk[] = [{ type: 'finish', reason: { kind: 'error', failure: { code: 'SERVER', message: 'unavailable' } } }]
  const test = await fixture([failure, failure])
  let offered = 0
  test.ctx.on('agent/request-error', ({ agent, failure: result }, next) => {
    if (agent !== test.parent || result.code !== 'SERVER' || offered++ > 0) return next()
    return Promise.resolve({ kind: 'retry' as const })
  })
  test.parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Continue.' }], source: { kind: 'user' } }))
  await test.parent.whenIdle()
  expect(test.adapter.requests.map(request => request.model)).toEqual(['lead', 'lead'])
  expect(test.state(test.parent)).toMatchObject({ status: 'blocked', reason: 'SERVER' })
  expect(test.parent.session.snapshotEvents().filter(event => event.type === 'turn/start')).toHaveLength(1)
})

it('retains a user selection made during a failing lead request for the next step', async () => {
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const test = await fixture([async () => {
    entered.resolve(undefined)
    await release.promise
    return [{ type: 'finish', reason: { kind: 'error', failure: { code: 'BILLING_EXHAUSTED', message: 'budget exhausted' } } }]
  }, text('continued on the selected model')])
  test.adapter.facts.set('lead', { billing: { free: false } })
  test.adapter.facts.set('visual', { billing: { free: true } })
  try {
    test.parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Continue.' }], source: { kind: 'user' } }))
    await entered.promise
    test.parent.model.select({ provider: 'models', model: 'visual' })
    release.resolve(undefined)
    await test.parent.whenIdle()
    expect(test.adapter.requests.map(request => request.model)).toEqual(['lead'])
    expect(test.parent.model.current()).toMatchObject(pool[0])
    expect(test.state(test.parent)).toMatchObject({ status: 'blocked', reason: 'BILLING_EXHAUSTED', route: pool[0] })
    expect(test.parent.session.snapshotEvents().filter(event => event.type === 'model/selection')).toHaveLength(1)
    test.parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Continue with my selection.' }], source: { kind: 'user' } }))
    await test.parent.whenIdle()
    expect(test.adapter.requests.map(request => request.model)).toEqual(['lead', 'visual'])
    expect(test.state(test.parent)).toMatchObject({ status: 'idle', route: pool[0] })
  } finally {
    release.resolve(undefined)
    await test.parent.whenIdle()
  }
})

it('uses an explicit user selection on the next lead step without interrupting a running request', async () => {
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const test = await fixture([async () => {
    entered.resolve(undefined)
    await release.promise
    return tool('lead_finish_step')
  }, text('finished')])
  const effect = vi.fn(async () => [])
  test.ctx.tools.register(defineContentToolFixture({ name: 'lead_finish_step', description: 'Finish the current step',
    parameters: {}, execute: effect }))
  try {
    test.parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Continue.' }], source: { kind: 'user' } }))
    await entered.promise
    test.parent.model.select({ provider: 'models', model: 'visual' })
    release.resolve(undefined)
    await test.parent.whenIdle()
    expect(test.adapter.requests.map(request => request.model)).toEqual(['lead', 'visual'])
    expect(effect).toHaveBeenCalledOnce()
    expect(test.parent.session.snapshotEvents().filter(event => event.type === 'turn/start')).toHaveLength(1)
    expect(test.parent.session.snapshotEvents().filter(event => event.type === 'tool/result')).toHaveLength(1)
  } finally {
    release.resolve(undefined)
    await test.parent.whenIdle()
  }
})

it('blocks the lead after the configured reasoning-only output limit without changing models', async () => {
  const limited: StreamChunk[] = [{ type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'Still reasoning' } },
    { type: 'finish', reason: { kind: 'max-tokens' } }]
  const test = await fixture([limited, limited], { maxEmptyOutputLimits: 2 })
  test.parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Continue.' }], source: { kind: 'user' } }))
  await test.parent.whenIdle()
  expect(test.adapter.requests.map(request => request.model)).toEqual(['lead', 'lead'])
  expect(test.state(test.parent)).toMatchObject({ status: 'blocked', reason: 'MAX_TOKENS' })
  expect(test.parent.session.snapshotEvents().filter(event => event.type === 'assistant/attempt')).toHaveLength(1)
})

it('preserves lead blocked state through projection replay', async () => {
  const test = await fixture([[{ type: 'finish', reason: { kind: 'error',
    failure: { code: 'BILLING_EXHAUSTED', message: 'budget exhausted' } } }]])
  test.parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Continue.' }], source: { kind: 'user' } }))
  await test.parent.whenIdle()
  const session = test.parent.session
  const events = session.snapshotEvents()
  const restored = Session.create(session.id, events, { ...session.header }, session.inheritedEventCount)
  const checkpoint = test.ctx.sessionProjections.checkpoint(session)
  const routing = checkpoint.orchestrationRouting
  if (routing === undefined) throw new Error('Missing orchestration checkpoint')
  expect(routing.ver).toBe(3)
  expect(test.ctx.sessionProjections.snapshot(restored).values.orchestrationRouting).toEqual(test.state(test.parent))
  const older = { ...checkpoint, orchestrationRouting: { ...routing, ver: 2 } }
  expect(test.ctx.sessionProjections.restoreFloor(older)).toBe(0)
  const replayed = test.ctx.sessionProjections.restore(older, events, SessionLogOffset(0), session.header, session.inheritedEventCount)
  expect(replayed.snapshot.values.orchestrationRouting).toEqual(test.state(test.parent))
  expect(replayed.checkpoint.orchestrationRouting?.ver).toBe(3)
})

it('does not mark the lead blocked when a same-model recovery is cancelled', async () => {
  const entered = Promise.withResolvers<undefined>()
  const test = await fixture([[{ type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: 'busy' } } }]])
  test.ctx.on('agent/request-error', async ({ agent, failure, signal }, next) => {
    if (agent !== test.parent || failure.code !== 'RATE_LIMIT') return next()
    await new Promise<void>((resolve) => {
      if (signal.aborted) { resolve(); return }
      signal.addEventListener('abort', () => { resolve() }, { once: true })
      entered.resolve(undefined)
    })
    return next()
  })
  try {
    test.parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Continue.' }], source: { kind: 'user' } }))
    await entered.promise
    test.parent.cancel({ kind: 'user' })
    await test.parent.whenIdle()
    expect(test.state(test.parent).status).not.toBe('blocked')
    expect(test.adapter.requests.map(request => request.model)).toEqual(['lead'])
  } finally {
    test.parent.cancel({ kind: 'user' })
    await test.parent.whenIdle()
  }
})

it('changes models after two reasoning-only output-limit generations and preserves the one task turn', async () => {
  const limited: StreamChunk[] = [{ type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'Still reasoning' } },
    { type: 'usage', usage: { inputTokens: 3000, outputTokens: 128_000 } },
    { type: 'finish', reason: { kind: 'max-tokens' } }]
  const test = await fixture([limited, limited, text('usable result')], { maxEmptyOutputLimits: 2 })
  const activation = await test.start()
  const result = await activation.result
  expect(result.stopReason).toBe('completed')
  expect(test.adapter.requests.map(request => request.model)).toEqual(['visual', 'visual', 'solver'])
  const child = test.children[0]
  if (child === undefined) throw new Error('No child was created')
  expect(child.session.snapshotEvents().filter(event => event.type === 'assistant/attempt')).toHaveLength(2)
  expect(child.session.snapshotEvents().filter(event => event.type === 'turn/start')).toHaveLength(1)
  expect(changes(child).findLast(state => state.reason === 'incomplete-output-limit')).toMatchObject({ route: pool[1] })
  expect(test.state(child).emptyLimits).toBe(0)
})

it('queues a parent phase while tools run and applies it only after their result is committed', async () => {
  const test = await fixture([tool('held_tool'), text('next phase')])
  const entered = Promise.withResolvers<Agent>()
  const release = Promise.withResolvers<undefined>()
  test.ctx.tools.register(defineContentToolFixture({ name: 'held_tool', description: 'Hold current work', parameters: {},
    execute: async (_args, exec) => {
      if (exec.agent === undefined) throw new Error('No child')
      entered.resolve(exec.agent)
      await release.promise
      return []
    } }))
  const activation = await test.start()
  try {
    const child = await entered.promise
    await test.ctx.subagents.requestModelChange({ caller: test.parent, target: child.id, taskAssessment: reasoning,
      reason: 'Continue with analysis', checkpoint: 'Current tool will finish before the new phase.', signal: new AbortController().signal })
    expect(test.state(child).status).toBe('queued')
    expect(child.model.current()?.model).toBe('visual')
    expect(test.adapter.requests).toHaveLength(1)
    release.resolve(undefined)
    await activation.result
    expect(test.adapter.requests.map(request => request.model)).toEqual(['visual', 'solver'])
    const events = child.session.snapshotEvents()
    const resultAt = events.findIndex(event => event.type === 'tool/result')
    const selectedAt = events.findIndex(event => event.type === 'model/selection' && event.data.model === 'solver')
    expect(selectedAt).toBeGreaterThan(resultAt)
  } finally {
    release.resolve(undefined)
    await activation.result
  }
})

it('keeps a queued phase unapplied when mode is switched off during the current tool', async () => {
  const test = await fixture([tool('hold_before_mode_off'), text('original route completed')])
  const entered = Promise.withResolvers<Agent>()
  const release = Promise.withResolvers<undefined>()
  test.ctx.tools.register(defineContentToolFixture({ name: 'hold_before_mode_off', description: 'Hold work before mode changes',
    parameters: {}, execute: async (_args, exec) => {
      if (exec.agent === undefined) throw new Error('No child')
      entered.resolve(exec.agent)
      await release.promise
      return []
    } }))
  const activation = await test.start()
  try {
    const child = await entered.promise
    await test.ctx.subagents.requestModelChange({ caller: test.parent, target: child.id, taskAssessment: reasoning,
      reason: 'Requested reasoning phase', checkpoint: 'Keep this phase queued if Orchestration is disabled.', maxTokens: 8192,
      signal: new AbortController().signal })
    expect(test.ctx.orchestrations.select(child, false)).toBe('queued')
    release.resolve(undefined)
    expect((await activation.result).stopReason).toBe('completed')
    expect(test.adapter.requests.map(request => [request.model, request.maxTokens])).toEqual([['visual', 128_000], ['visual', 128_000]])
    expect(test.ctx.sessionProjections.snapshot(child.session).values.orchestration).toEqual({ active: false, pending: false })
    expect(test.state(child)).toMatchObject({ status: 'queued', route: pool[0], previous: null,
      request: { assessment: reasoning, maxTokens: 8192 } })
    expect(child.session.snapshotEvents().filter(event => event.type === 'model/selection' && event.data.model === 'solver')).toHaveLength(0)
  } finally {
    release.resolve(undefined)
    await activation.dispose()
  }
})

it('withdraws an in-flight phase admission when mode is switched off during its checkpoint flush', async () => {
  const test = await fixture([tool('hold_before_admission'), text('original route completed')])
  const entered = Promise.withResolvers<Agent>()
  const release = Promise.withResolvers<undefined>()
  const saving = Promise.withResolvers<undefined>()
  const saved = Promise.withResolvers<boolean>()
  test.ctx.tools.register(defineContentToolFixture({ name: 'hold_before_admission', description: 'Hold work before phase admission',
    parameters: {}, execute: async (_args, exec) => {
      if (exec.agent === undefined) throw new Error('No child')
      entered.resolve(exec.agent)
      await release.promise
      return []
    } }))
  const activation = await test.start()
  try {
    const child = await entered.promise
    await test.ctx.subagents.requestModelChange({ caller: test.parent, target: child.id, taskAssessment: reasoning,
      reason: 'Requested reasoning phase', checkpoint: 'Preserve this phase if mode changes while it is saved.', maxTokens: 8192,
      signal: new AbortController().signal })
    test.flush.mockImplementationOnce(() => { saving.resolve(undefined); return saved.promise })
    release.resolve(undefined)
    await saving.promise
    expect(test.state(child).status).toBe('changing')
    expect(child.model.current()?.model).toBe('visual')
    expect(test.ctx.orchestrations.select(child, false)).toBe('queued')
    saved.resolve(true)
    expect((await activation.result).stopReason).toBe('completed')
    expect(test.adapter.requests.map(request => [request.model, request.maxTokens])).toEqual([['visual', 128_000], ['visual', 128_000]])
    expect(test.ctx.sessionProjections.snapshot(child.session).values.orchestration).toEqual({ active: false, pending: false })
    expect(test.state(child)).toMatchObject({ status: 'queued', route: pool[0], previous: null,
      request: { assessment: reasoning, maxTokens: 8192 } })
    expect(child.session.snapshotEvents().filter(event => event.type === 'model/selection' && event.data.model === 'solver')).toHaveLength(0)
  } finally {
    release.resolve(undefined)
    saved.resolve(true)
    await activation.dispose()
  }
})

it('does not turn a wider descendant policy or current pool into permission for the running child', async () => {
  const test = await fixture([tool('held_tool'), text('original phase')], { routeCapabilities: [
    { ...pool[0]!, capabilities: ['coding'] }, { ...pool[1]!, capabilities: ['coding'] },
    { provider: 'models', model: 'ungranted', capabilities: ['reasoning'] },
  ] })
  const entered = Promise.withResolvers<Agent>()
  const release = Promise.withResolvers<undefined>()
  test.ctx.tools.register(defineContentToolFixture({ name: 'held_tool', description: 'Hold work', parameters: {},
    execute: async (_args, exec) => { if (exec.agent === undefined) throw new Error('No child'); entered.resolve(exec.agent); await release.promise; return [] } }))
  const activation = await test.start()
  try {
    const child = await entered.promise
    const widened = [...pool, { provider: 'models', model: 'ungranted' }]
    child.session.append('subagent/model-selection-policy', { allowedModels: widened })
    test.ctx.orchestrations.setPool(widened)
    expect(test.ctx.subagents.modelSelectionPolicyOf(child.session)).toEqual(widened)
    expect(test.ctx.subagents.runningModelPolicyOf(child.session)).toEqual(pool)
    await test.ctx.subagents.requestModelChange({ caller: child, target: child.id, taskAssessment: reasoning,
      reason: 'Need a new phase', checkpoint: 'Permission must remain within the original grant.', signal: new AbortController().signal })
    release.resolve(undefined)
    const result = await activation.result
    expect(result.stopReason).toBe('error')
    expect(test.adapter.requests.map(request => request.model)).toEqual(['visual'])
    expect(child.model.current()?.model).toBe('visual')
  } finally {
    release.resolve(undefined)
    await activation.result
  }
})

it('clears a failed durable phase admission without selecting or dispatching the requested route', async () => {
  const test = await fixture([tool('held_tool'), text('original phase')])
  const entered = Promise.withResolvers<Agent>()
  const release = Promise.withResolvers<undefined>()
  test.ctx.tools.register(defineContentToolFixture({ name: 'held_tool', description: 'Hold work', parameters: {},
    execute: async (_args, exec) => { if (exec.agent === undefined) throw new Error('No child'); entered.resolve(exec.agent); await release.promise; return [] } }))
  const activation = await test.start()
  try {
    const child = await entered.promise
    test.flush.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    await expect(test.ctx.subagents.requestModelChange({ caller: child, target: child.id, taskAssessment: reasoning,
      reason: 'Need reasoning', checkpoint: 'Do not admit the phase without durable state.', signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'ORCHESTRATION_DURABILITY_REQUIRED' })
    expect(test.state(child)).toMatchObject({ request: null, status: 'blocked' })
    expect(child.model.current()?.model).toBe('visual')
    release.resolve(undefined)
    await activation.result
    expect(test.adapter.requests.map(request => request.model)).toEqual(['visual', 'visual'])
  } finally {
    release.resolve(undefined)
    await activation.result
  }
})

it('removes an explicitly cancelled phase while its durable acknowledgement is pending', async () => {
  const test = await fixture([tool('held_tool'), text('original phase')])
  const entered = Promise.withResolvers<Agent>()
  const release = Promise.withResolvers<undefined>()
  test.ctx.tools.register(defineContentToolFixture({ name: 'held_tool', description: 'Hold work', parameters: {},
    execute: async (_args, exec) => { if (exec.agent === undefined) throw new Error('No child'); entered.resolve(exec.agent); await release.promise; return [] } }))
  const activation = await test.start()
  const saving = Promise.withResolvers<undefined>()
  const saved = Promise.withResolvers<boolean>()
  const cancel = new AbortController()
  let rejected: Promise<unknown> | undefined
  try {
    const child = await entered.promise
    test.flush.mockClear()
    test.flush.mockResolvedValueOnce(true).mockImplementationOnce(() => { saving.resolve(undefined); return saved.promise })
    const phase = test.ctx.subagents.requestModelChange({ caller: child, target: child.id, taskAssessment: reasoning,
      reason: 'Cancelled phase', checkpoint: 'Keep the original phase after cancellation.', signal: cancel.signal })
    rejected = expect(phase).rejects.toBeDefined()
    await Promise.race([saving.promise, phase.then(() => { throw new Error('Phase admission skipped its checkpoint barrier') })])
    cancel.abort(new DOMException('cancelled phase', 'AbortError'))
    saved.resolve(true)
    await rejected
    expect(test.state(child)).toMatchObject({ request: null, status: 'idle' })
    expect(test.flush).toHaveBeenCalledTimes(3)
    release.resolve(undefined)
    await activation.result
    expect(test.adapter.requests.map(request => request.model)).toEqual(['visual', 'visual'])
  } finally {
    saved.resolve(true)
    release.resolve(undefined)
    await activation.result
    await rejected
  }
})
