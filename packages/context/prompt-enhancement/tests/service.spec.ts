/** One-shot dispatch, persistence, and recovery for prompt enhancement. */
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type {} from '@deepseek-ai/dsh-agent-instructions/discovery'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LlmAdapter, type GenerateOptions, type LlmEgressId, type LlmResolvedModelInfo, type PreparedAdapterCall,
  type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { expect, it, onTestFinished, vi } from 'vitest'
import PromptEnhancement, { PromptEnhancementRemote } from '../src/index.ts'
import type { PromptEnhancementRequest } from '../src/types.ts'

class Adapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  readonly entered = Promise.withResolvers<undefined>()
  readonly release = Promise.withResolvers<undefined>()
  readonly closed = Promise.withResolvers<undefined>()
  hold = false
  output = 'Please fix the parser.'
  tokenLimit: number | undefined

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text'],
      context: { contextWindow: 32_000 }, maxOutputTokens: 512 })
  }

  override async prepareCall(provider: string, model: string): Promise<PreparedAdapterCall> {
    return {
      model: await this.resolveModel(provider, model),
      requestTokenBudget: (options) => {
        if (this.tokenLimit === undefined) return undefined
        const inputTokens = Math.ceil(Buffer.byteLength(JSON.stringify(options.messages), 'utf8') / 4)
        const outputTokens = options.maxTokens ?? 0
        return { tokenLimit: this.tokenLimit, inputTokens, outputTokens, estimatedTokens: inputTokens + outputTokens }
      },
      stream: options => this.stream(options),
    }
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    try {
      this.requests.push(options)
      this.entered.resolve(undefined)
      if (this.hold) await this.release.promise
      yield { type: 'block-end', index: 0, block: { type: 'text', text: this.output } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } finally { this.closed.resolve(undefined) }
  }
}

async function fixture(config: { enabled?: boolean; maxPromptWords?: number; maxPromptCharacters?: number } = {}) {
  const ctx = new Context()
  const adapter = new Adapter()
  onTestFinished(async () => {
    adapter.release.resolve(undefined)
    if (adapter.requests.length > 0) await adapter.closed.promise
    await ctx.fiber.dispose()
  })
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['enhancer-test'], adapter)
  await ctx.plugin(PromptEnhancement, config)
  if (!ctx.promptEnhancement.catalogReady()) throw new Error('Generate the Session event catalog before running enhancement tests')
  const agent = (await ctx.agents.create({ sessionId: SessionId('enhancement-main'),
    agentOptions: { provider: 'enhancer-test', model: 'model' } })).agent
  const snapshots: string[][] = []
  const flush = vi.spyOn(ctx.sessions, 'flush').mockImplementation(async (session) => {
    snapshots.push(session.snapshotEvents().map(event => event.type))
    return true
  })
  const request: PromptEnhancementRequest = { sessionId: agent.id, id: brandString<SessionRequestId>('request-1'),
    original: 'Fix parser', displayOriginal: 'Fix parser', attachments: ['notes.txt'],
    provider: 'enhancer-test', model: 'model', expectedEgress: null }
  return { ctx, agent, adapter, request, flush, snapshots }
}

it('flushes before dispatch and reuses the settled result for the same submission', async () => {
  const { ctx, agent, adapter, request, snapshots } = await fixture()
  const signal = new AbortController().signal
  ctx.on('llm/stream', (options, next) => {
    expect(Object.isFrozen(options)).toBe(true)
    expect(Object.isFrozen(options.messages)).toBe(true)
    return next()
  })
  const result = await ctx.promptEnhancement.enhance(agent, request, signal)
  expect(result).toEqual({ status: 'enhanced', text: 'Please fix the parser.' })
  expect(snapshots[0]).toContain('prompt-enhancement/request')
  expect(snapshots[0]).not.toContain('prompt-enhancement/result')
  expect(adapter.requests).toHaveLength(1)
  expect(adapter.requests[0]?.purpose).toBe('prompt-enhancement')
  const input = adapter.requests[0]?.messages[0]?.content[0]
  expect(input?.type === 'text' && input.text).toContain('notes.txt')
  expect(await ctx.promptEnhancement.enhance(agent, request, signal)).toEqual(result)
  expect(adapter.requests).toHaveLength(1)
  expect(await ctx.promptEnhancement.enhance(agent, { ...request, original: 'Different prompt' }, signal))
    .toMatchObject({ status: 'failed', code: 'PROMPT_ENHANCEMENT_ID_CONFLICT' })
})

it('never dispatches when the request cannot be flushed', async () => {
  const { ctx, agent, adapter, request, flush } = await fixture()
  flush.mockResolvedValueOnce(false)
  expect(await ctx.promptEnhancement.enhance(agent, request, new AbortController().signal))
    .toMatchObject({ status: 'failed', code: 'PROMPT_ENHANCEMENT_DURABILITY_REQUIRED' })
  expect(adapter.requests).toHaveLength(0)
})

it('skips recognized credentials without logging or sending another copy', async () => {
  const { ctx, agent, adapter, request } = await fixture()
  const original = 'password=abcdefghijklmnop'
  expect(await ctx.promptEnhancement.enhance(agent, { ...request, original }, new AbortController().signal))
    .toMatchObject({ status: 'failed', code: 'PROMPT_ENHANCEMENT_SENSITIVE_OR_EMPTY' })
  expect(adapter.requests).toHaveLength(0)
  expect(agent.session.snapshotEvents().some(event => event.type.startsWith('prompt-enhancement/'))).toBe(false)
})

it('skips an over-limit prompt before resolving the model or recording an attempt', async () => {
  const { ctx, agent, adapter, request } = await fixture({ enabled: true })
  const prompt = 'word '.repeat(101).trim()
  const preview = vi.fn()
  ctx.on('agent-instructions/preview', async () => { preview(); return undefined })
  const providers = vi.spyOn(ctx.llm, 'listProviders')
  const remote = new PromptEnhancementRemote(ctx)
  const preflight = { sessionId: agent.id, id: request.id, original: prompt, displayOriginal: prompt }
  expect(await remote.preflight(preflight, new AbortController().signal)).toEqual({ status: 'skipped', reason: 'length' })
  expect(await ctx.promptEnhancement.enhance(
    agent, { ...request, original: prompt, displayOriginal: prompt }, new AbortController().signal,
  ))
    .toEqual({ status: 'skipped', reason: 'length' })
  expect(providers).not.toHaveBeenCalled()
  expect(preview).not.toHaveBeenCalled()
  expect(adapter.requests).toHaveLength(0)
  expect(agent.session.snapshotEvents().some(event => event.type.startsWith('prompt-enhancement/'))).toBe(false)
})

it('applies configured limits to expanded as well as displayed text', async () => {
  const { ctx, agent, adapter, request } = await fixture({ maxPromptWords: 2, maxPromptCharacters: 100 })
  expect(await ctx.promptEnhancement.enhance(agent, { ...request, original: 'one two three', displayOriginal: 'one' }, new AbortController().signal))
    .toEqual({ status: 'skipped', reason: 'length' })
  expect(await ctx.promptEnhancement.enhance(agent, { ...request, original: 'one', displayOriginal: 'one two three' }, new AbortController().signal))
    .toEqual({ status: 'skipped', reason: 'length' })
  expect(adapter.requests).toHaveLength(0)
})

it.each([undefined, 'cancelled by the user'])('coalesces requests and preserves cancellation reason %s', async (reason) => {
  const { ctx, agent, adapter, request } = await fixture()
  adapter.hold = true
  const cancellation = new AbortController()
  const first = ctx.promptEnhancement.enhance(agent, request, cancellation.signal)
  await adapter.entered.promise
  const second = ctx.promptEnhancement.enhance(agent, request, cancellation.signal)
  cancellation.abort(reason)
  expect(await first).toEqual({ status: 'cancelled' })
  expect(await second).toEqual({ status: 'cancelled' })
  adapter.release.resolve(undefined)
  await adapter.closed.promise
  expect(adapter.requests).toHaveLength(1)
})

it('rejects a changed endpoint and a shared exhausted budget before dispatch', async () => {
  const { ctx, agent, adapter, request } = await fixture()
  const signal = new AbortController().signal
  expect(await ctx.promptEnhancement.enhance(agent, { ...request, expectedEgress: brandString<LlmEgressId>('old-endpoint') }, signal))
    .toMatchObject({ status: 'failed', code: 'PROMPT_ENHANCEMENT_PROVIDER_CHANGED' })
  const failure = ctx.llm.billingHealth.begin()
  failure.record(undefined)
  failure.dispose()
  expect(await ctx.promptEnhancement.enhance(agent, { ...request, id: brandString<SessionRequestId>('request-2') }, signal))
    .toMatchObject({ status: 'failed', code: 'PROMPT_ENHANCEMENT_BILLING_UNAVAILABLE' })
  expect(adapter.requests).toHaveLength(0)
})

it('rejects an empty model response and does not retry it', async () => {
  const { ctx, agent, adapter, request } = await fixture()
  adapter.output = ''
  const signal = new AbortController().signal
  const result = await ctx.promptEnhancement.enhance(agent, request, signal)
  expect(result).toMatchObject({ status: 'failed', code: 'PROMPT_ENHANCEMENT_INVALID_OUTPUT' })
  expect(await ctx.promptEnhancement.enhance(agent, request, signal)).toEqual(result)
  expect(adapter.requests).toHaveLength(1)
})

it('removes optional context before exceeding the request budget and keeps the output reservation', async () => {
  const { ctx, agent, adapter, request } = await fixture()
  adapter.tokenLimit = 800
  ctx.on('agent-instructions/preview', async () => `# Parser\n${'parser relevant detail '.repeat(100)}`)
  expect(await ctx.promptEnhancement.enhance(agent, request, new AbortController().signal))
    .toEqual({ status: 'enhanced', text: 'Please fix the parser.' })
  expect(adapter.requests).toHaveLength(1)
  expect(adapter.requests[0]?.maxTokens).toBe(512)
  expect(JSON.stringify(adapter.requests[0]?.messages)).not.toContain('relevant detail')
  expect(JSON.stringify(adapter.requests[0]?.messages)).toContain('Fix parser')
})

it('does not dispatch if the output reservation alone exceeds the model budget', async () => {
  const { ctx, agent, adapter, request } = await fixture()
  adapter.tokenLimit = 512
  expect(await ctx.promptEnhancement.enhance(agent, request, new AbortController().signal))
    .toMatchObject({ status: 'failed', code: 'PROMPT_ENHANCEMENT_TOO_LARGE' })
  expect(adapter.requests).toHaveLength(0)
})
