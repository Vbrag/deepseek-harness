import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { toolPairingBalancedAfter, toolPairingBalancedBefore } from '@deepseek-ai/dsh-compaction'
import { createUserMessage, createSystemMessage, CONTEXT_WINDOW_EXCEEDED_CODE, LlmError, resolveRetryPolicy , createMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, LlmQueueAvailability, LlmQueueRequest, LlmRequestTokenBudget, LlmResolvedModelInfo, PreparedAdapterCall, ResolvedRetryPolicy, StreamChunk } from '@deepseek-ai/dsh-llm'
import { estimateRequestInputTokens } from '@deepseek-ai/dsh-llm/input-estimate'
import { brandString } from '@deepseek-ai/dsh-brand'
import { type ToolCallId, LlmAdapter } from '@deepseek-ai/dsh-llm'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import * as LlmRetry from '@deepseek-ai/dsh-llm-retry'
import { Session, type SessionId, type SessionEvent, type SurfaceEvent } from '@deepseek-ai/dsh-session'

/**
 * CBR-001 regression through the real loop. A replacement checkpoint has a high
 * log seq at the surface head and carries no tool pair, so both adjacent cuts
 * must be safe and re-compacting that checkpoint alone must succeed. This pins
 * surface-position semantics rather than raw-log scanning.
 */

class ReproCompactionEngine extends BasicCompactionEngine {
  override async summarize(): Promise<{ summary: ContentBlock[]; provider: string; model: string }> {
    return {
      summary: [{ type: 'text', text: 'CHECKPOINT SUMMARY' }],
      provider: 'mock',
      model: 'stub',
    }
  }
}

/** Each call emits one tool-call until exhausted, then a final text answer. */
class StepwiseToolAdapter extends LlmAdapter {
  calls = 0
  constructor(private toolSteps: number) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      context: { contextWindow: 400 },
    })
  }

  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    const n = this.calls
    this.calls += 1
    if (n < this.toolSteps) {
      const id = brandString<ToolCallId>(`c${n}`)
      const args = `{"i":${n}}`
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: `step ${n}` } }
      yield { type: 'block-start', index: 1, blockType: 'tool-call' }
      yield { type: 'block-end', index: 1, block: { type: 'tool-call', id, name: 'work', arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'all done' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** First conversation request overflows, then the rebuilt retry succeeds. */
class OverflowRecoveryAdapter extends LlmAdapter {
  readonly conversationRequests: GenerateOptions[] = []
  readonly summaryRequests: GenerateOptions[] = []
  private readonly retryPolicy = resolveRetryPolicy({
    mode: 'normal',
    maxRetries: 1,
    backoff: { initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 },
  }, 'compaction test provider retryPolicy')

  constructor(
    private readonly delivery: 'thrown' | 'in-band',
    private readonly transientAfterOverflow = false,
  ) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      context: { contextWindow: 128 },
    })
  }

  override providerRetryPolicy(_provider: string): ResolvedRetryPolicy {
    return this.retryPolicy
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    // The cache-reusing summarizer replays the conversation prefix and marks
    // its call only by the compaction instruction in the trailing user message.
    const trailing = options.messages.at(-1)?.content
      .map(block => (block.type === 'text' ? block.text : ''))
      .join('') ?? ''
    if (trailing.includes('acting as a compaction engine')) {
      this.summaryRequests.push(options)
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'RECOVERY CHECKPOINT' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }

    this.conversationRequests.push(options)
    if (this.conversationRequests.length === 1) {
      if (this.delivery === 'thrown') {
        throw new LlmError('request too large for model context', CONTEXT_WINDOW_EXCEEDED_CODE)
      }
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: {
            message: 'request too large for model context',
            code: CONTEXT_WINDOW_EXCEEDED_CODE,
          },
        },
      }
      return
    }
    if (this.transientAfterOverflow && this.conversationRequests.length === 2) {
      throw new LlmError('temporary provider outage', 'SERVER')
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'recovered' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function harness(toolSteps: number): Promise<{ ctx: Context; compact: ReproCompactionEngine }> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(TokenMeter)
  ctx.llm.registerAdapter(['mock'], new StepwiseToolAdapter(toolSteps))
  ctx.tools.register(defineContentToolFixture({
    name: 'work',
    description: 'does work',
    parameters: { i: { type: 'number' } },
    async execute() {
      return [{ type: 'text', text: 'work result' }]
    },
  }))
  // Small window so several tool steps cross the threshold and compaction
  // fires within the runaway turn after enough history can shrink.
  const compact = new ReproCompactionEngine(ctx, {
    auto: true,
    headroomTokens: 0,
    thresholdRatio: 0.5,
    retainTokens: 50,
    maxTokens: 8192,
    compactionRetries: 1,
  })
  return { ctx, compact }
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

function overflowHistorySeed(turns = 2): readonly SessionEvent[] {
  const session = Session.create(brandString<SessionId>('overflow-history-seed'))
  for (let turn = 1; turn <= turns; turn += 1) {
    const sentinel = turn === 1 ? 'OLD HISTORY SENTINEL' : 'RECENT HISTORY'
    session.append('turn/start', {
      turn,
    })
    session.append('step/start', { turn, step: 1 })
    if (turn === 1) {
      session.append('system/message', {
        turn, step: 1, message: createMessage({ role: 'system', content: [], source: { kind: 'system-prompt', sections: [] } }),
      }, { surfaceOp: 'append' })
    }
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `${sentinel} ${'old context '.repeat(200)}` }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('assistant/message', {
      stream: [],
      turn,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: `historical response ${turn} ${'detail '.repeat(200)}` }],
        source: {
          kind: 'model',
          ...{ provider: 'mock', model: 'mock' },
        },
      }),
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn, step: 1 })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
  return session.snapshotEvents()
}

describe('CBR-001: a real-loop checkpoint is a valid boundary on both sides', () => {
  it('uses the recorded model selection for post-step pressure', async () => {
    const { ctx } = await harness(8)
    try {
      const agent = await ctx.agentLoop.create(brandString<SessionId>('routed-pressure'), {
        provider: 'unconfigured-agent-fallback',
        model: 'unconfigured-agent-fallback',
      })
      agent.model.select({ provider: 'mock', model: 'mock' })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'do a routed multi-step task' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)

      expect(agent.session.requestHeader()?.config.model).toBe('mock')
      expect(agent.session.snapshotEvents().some(event => event.type === 'compaction/summary')).toBe(true)
      expect(agent.session.snapshotEvents().at(-1)).toMatchObject({
        type: 'turn/end',
        data: { reason: { kind: 'completed' } },
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('runs automatic pressure between the completed tool step and the next step', async () => {
    const { ctx } = await harness(8)
    try {
      const agent = await ctx.agentLoop.create(brandString<SessionId>('post-step-order'), { provider: 'mock', model: 'mock' })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'do tool work' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)

      const events = agent.session.snapshotEvents()
      const compactStart = events.find(event => event.type === 'compaction/start')
      expect(compactStart).toBeDefined()
      const precedingResult = events.findLast(event =>
        event.type === 'tool/result' && event.seq < compactStart!.seq,
      )
      if (precedingResult?.type !== 'tool/result') throw new Error('expected a durable tool result before compaction')
      const precedingStepEnd = events.find(event =>
        event.type === 'step/end'
        && event.data.step === precedingResult.data.step
        && event.seq > precedingResult.seq,
      )
      const nextStepStart = events.find(event =>
        event.type === 'step/start'
        && event.data.step === precedingResult.data.step + 1
        && event.seq > compactStart!.seq,
      )
      expect(precedingResult.seq).toBeLessThan(compactStart!.seq)
      expect(precedingStepEnd!.seq).toBeLessThan(compactStart!.seq)
      expect(compactStart!.seq).toBeLessThan(nextStepStart!.seq)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('the head checkpoint the loop lands is a balanced cut on both sides', async () => {
    const { ctx } = await harness(8)
    try {
      const agent = await ctx.agentLoop.create(brandString<SessionId>('repro'), { provider: 'mock', model: 'mock' })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'do a long multi-step task' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)

      const events = agent.session.snapshotEvents()
      // A compaction ran: at least one checkpoint landed on the surface.
      const checkpoints = events.filter(
        (e): e is SurfaceEvent =>
          e.type === 'user/message'
          && typeof (e as SurfaceEvent).surfaceOp === 'object',
      )
      expect(checkpoints.length).toBeGreaterThan(0)

      // High log position does not make a text-only checkpoint mid-step; both
      // its start and end cuts are balanced in surface order.
      const nodes = agent.session.surface.nodes
      for (const cp of checkpoints) {
        const index = nodes.indexOf(cp.seq)
        if (index === -1) continue // shadowed by a later checkpoint — no longer an edge.
        expect(toolPairingBalancedBefore(agent.session, cp.seq),
          `checkpoint seq ${cp.seq} must be a balanced region START`).toBe(true)
        expect(toolPairingBalancedAfter(agent.session, cp.seq),
          `checkpoint seq ${cp.seq} must be a balanced region END`).toBe(true)
      }
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

describe('token pressure after loop-admitted system prompts', () => {
  it.each([false, true])('counts accumulated prompt updates once with retry=%s', async (retry) => {
    const ctx = new Context()
    const requests: GenerateOptions[] = []
    const usage = { inputTokens: 1000, cacheReadTokens: 100, outputTokens: 10 }
    const adapter = new class extends StepwiseToolAdapter {
      override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        requests.push(options)
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'answer' } }
        yield { type: 'usage', usage }
        yield retry && requests.length === 1
          ? { type: 'finish', reason: { kind: 'error', failure: { code: 'SERVER', message: 'retry me' } } }
          : { type: 'finish', reason: { kind: 'stop' } }
      }
    }(0)
    try {
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(AgentLoop, { agents: [] })
      await ctx.plugin(TokenMeter)
      ctx.llm.registerAdapter(['mock'], adapter)
      let prompt = 'initial guidance '.repeat(8)
      ctx.systemPrompt.section({ name: 'meter-test', order: 0, complete: true, text: () => prompt })
      ctx.on('agent/request', async (_payload, next) => ({ ...await next(), temperature: 0.5 }))
      ctx.on('agent/request-error', async ({ agent, turn, step }, next) => {
        const action = await next()
        if (action !== undefined) return action
        const node = agent.session.surface.nodes[0]!
        agent.session.append('system/message', {
          turn,
          step,
          // Attributed without sections: a message without `source.sections` would request a rebuild.
          message: { ...createSystemMessage('retry guidance'), source: { kind: 'system-prompt', sections: [] } },
        }, { surfaceOp: { op: 'replace', startSeq: node, endSeq: node }, sourceEventSeqs: [node] })
        return { kind: 'retry' }
      })
      const agent = await ctx.agentLoop.create(brandString<SessionId>('prompt-pressure'), { provider: 'mock', model: 'mock' })
      // Eager replay must observe the same anchor as a fresh reader of the finished log.
      ctx.tokenMeter.measure(agent.session)
      for (const nextPrompt of [prompt, 'expanded guidance '.repeat(20), 'short', '']) {
        prompt = nextPrompt
        agent.followup(createUserMessage({ content: [{ type: 'text', text: 'question' }], source: { kind: 'user' } }))
        await agent.whenIdle()
        expect(agent.session.snapshotEvents().at(-1)).toMatchObject({
          type: 'turn/end', data: { reason: { kind: 'completed' } },
        })
        const measured = ctx.tokenMeter.measure(agent.session)
        expect(measured.baseline).toEqual({ kind: 'usage', tokens: 1110, usage })
        expect(measured.surfaceDeltaTokens).toBe(0)
        expect(measured.totalTokens).toBe(1110)
        const replay = Session.create(brandString<SessionId>('prompt-pressure-replay'), agent.session.snapshotEvents())
        expect(ctx.tokenMeter.measure(replay)).toMatchObject({
          baseline: measured.baseline, surfaceDeltaTokens: 0, totalTokens: 1110, nodes: measured.nodes,
        })
      }
      const events = agent.session.snapshotEvents()
      const prompts = events.filter(event => event.type === 'system/message')
      expect(prompts[0]?.surfaceOp).toBe('append')
      expect(prompts.filter(event => typeof event.surfaceOp === 'object')).toHaveLength(retry ? 1 : 0)
      expect(prompts.filter(event => event.surfaceOp === 'append')).toHaveLength(4)
      for (const event of prompts) {
        expect(events.find(start => start.type === 'step/start'
          && start.data.turn === event.data.turn && start.data.step === event.data.step)?.seq)
          .toBeLessThan(event.seq)
      }
      expect(requests).toHaveLength(retry ? 5 : 4)
      expect(requests.every(request => request.temperature === 0.5)).toBe(true)
      expect(events.filter(event => event.type === 'assistant/attempt')).toHaveLength(retry ? 1 : 0)
      expect(events.filter(event => event.type === 'step/start')).toHaveLength(4)
      expect(requests[0]?.messages[0]?.content.at(-1)).toEqual({ type: 'text', text: 'initial guidance '.repeat(8).trim() })
      if (retry) {
        expect(requests[1]?.messages[0]?.content).toEqual([{ type: 'text', text: 'retry guidance' }])
        expect(requests[1]?.messages.filter(message => message.role === 'system')).toHaveLength(1)
      }
      const finalPrompts = requests.at(-1)?.messages.filter(message => message.role === 'system')
      expect(finalPrompts).toHaveLength(4)
      expect(finalPrompts?.at(-1)?.content.map(block => block.type === 'text' ? block.text : '').join(''))
        .toBe('From this point onward, none of the earlier system-prompt sections apply.')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

describe('context-overflow recovery across the real loop and compaction-basic', () => {
  it.each(['thrown', 'in-band'] as const)(
    'force-compacts a %s overflow within the retried step',
    async (delivery) => {
      const ctx = new Context()
      const adapter = new OverflowRecoveryAdapter(delivery)
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(AgentLoop, { agents: [] })
      await ctx.plugin(TokenMeter)
      ctx.llm.registerAdapter(['mock'], adapter)
      await ctx.plugin(BasicCompactionEngine, {
        headroomTokens: 0,
        thresholdRatio: 1,
        retainTokens: 100,
        maxTokens: 64,
        compactionRetries: 0,
        maxOverflowRetries: 1,
      })

      try {
        const { agent } = await ctx.agentLoop.createAgent(ctx, {
          sessionId: brandString<SessionId>(`overflow-${delivery}`),
          seed: overflowHistorySeed(),
          agentOptions: {
            provider: 'unconfigured-agent-fallback',
            model: 'unconfigured-agent-fallback',
          },
        })

        agent.model.select({ provider: 'mock', model: 'mock' })
        agent.followup(createUserMessage({ content: [{ type: 'text', text: 'continue from history' }], source: { kind: 'user' } }))
        await agent.whenIdle()

        expect(adapter.conversationRequests).toHaveLength(2)
        expect(adapter.summaryRequests).toHaveLength(1)
        const instruction = adapter.summaryRequests[0]!.messages.at(-1)?.content
          .map(block => (block.type === 'text' ? block.text : ''))
          .join('') ?? ''
        expect(instruction).toContain('Write concise English engineering prose.')
        expect(instruction).toContain('numeric values, function signatures, and syntax fragments.')
        expect(JSON.stringify(adapter.conversationRequests[0]!.messages)).toContain('OLD HISTORY SENTINEL')
        const retry = JSON.stringify(adapter.conversationRequests[1]!.messages)
        expect(retry).toContain('RECOVERY CHECKPOINT')
        expect(retry).not.toContain('OLD HISTORY SENTINEL')

        const events = agent.session.snapshotEvents()
        const stepStart = events.find(event =>
          event.type === 'step/start' && event.data.turn === 3 && event.data.step === 1,
        )!
        const stepEnd = events.find(event =>
          event.type === 'step/end' && event.data.turn === 3 && event.data.step === 1,
        )!
        const compaction = events.filter(event =>
          event.type === 'compaction/start'
          || event.type === 'compaction/summary'
          || event.type === 'compaction/end',
        )
        expect(compaction.map(event => event.type)).toEqual([
          'compaction/start',
          'compaction/summary',
          'compaction/end',
        ])
        expect(compaction.every(event =>
          event.seq > stepStart.seq && event.seq < stepEnd.seq,
        )).toBe(true)
        expect(events.filter(event => event.type === 'turn/start').slice(-1).map(event => event.data.turn))
          .toEqual([3])
        expect(events.filter(event => event.type === 'step/start' && event.data.turn === 3))
          .toHaveLength(1)
        expect(events.at(-1)).toMatchObject({
          type: 'turn/end',
          data: { reason: { kind: 'completed' } },
        })
      } finally {
        await ctx.fiber.dispose()
      }
    },
  )

  it('keeps context-overflow and transient retry budgets independent in one sequence', async () => {
    const ctx = new Context()
    const adapter = new OverflowRecoveryAdapter('thrown', true)
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(LlmRetry)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(TokenMeter)
    ctx.llm.registerAdapter(['mock'], adapter)
    await ctx.plugin(BasicCompactionEngine, {
      headroomTokens: 0,
      thresholdRatio: 1,
      retainTokens: 100,
      maxTokens: 64,
      compactionRetries: 0,
      maxOverflowRetries: 1,
    })

    try {
      const { agent } = await ctx.agentLoop.createAgent(ctx, {
        sessionId: brandString<SessionId>('alternating-recovery'),
        seed: overflowHistorySeed(),
        agentOptions: { provider: 'mock', model: 'mock' },
      })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'continue from history' }], source: { kind: 'user' } }))
      await agent.whenIdle()

      expect(adapter.conversationRequests).toHaveLength(3)
      expect(adapter.summaryRequests).toHaveLength(1)
      expect(agent.session.snapshotEvents().filter(event => event.type === 'llm/retry').map(event => event.data))
        .toEqual([expect.objectContaining({ turn: 3, step: 1, retry: 1, failure: { message: 'temporary provider outage', code: 'SERVER' } })])
      expect(agent.session.snapshotEvents().filter(event => event.type === 'turn/start').slice(-1).map(event => event.data.turn))
        .toEqual([3])
      expect(agent.session.snapshotEvents().at(-1)).toMatchObject({
        type: 'turn/end',
        data: { reason: { kind: 'completed' } },
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

const SMALL_WINDOW = 4_000

/** `big` accepts every request; `small` counts one token per character and rejects above its window. */
class TwoWindowAdapter extends LlmAdapter {
  readonly requests: Array<{ kind: 'chat' | 'summary'; model: string; overflow: boolean }> = []

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      context: { contextWindow: model === 'small' ? SMALL_WINDOW : 1_000_000 },
    })
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const characters = options.messages.reduce((total, message) => total + message.content
      .reduce((sum, block) => sum + (block.type === 'text' ? block.text.length : 0), 0), 0)
    const kind = options.purpose === 'compaction' ? 'summary' : 'chat'
    const overflow = options.model === 'small' && characters > SMALL_WINDOW
    this.requests.push({ kind, model: options.model, overflow })
    if (overflow) {
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: { message: `prompt is too long: ${characters} tokens > ${SMALL_WINDOW} maximum`, code: CONTEXT_WINDOW_EXCEEDED_CODE },
        },
      }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: kind === 'summary' ? 'SWITCH CHECKPOINT' : 'answer' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

describe('summary route after a switch to a model that undercounts in the estimate', () => {
  /**
   * Four `big` turns of CJK text: the fixed heuristic prices the history near
   * 2,000 tokens, below the 3,200-token `small` threshold, so the switch check
   * admits the request, while `small` counts about 8,000 tokens and rejects it.
   */
  async function switchedHistory(maxOverflowRetries: number): Promise<{
    ctx: Context
    adapter: TwoWindowAdapter
    compact: BasicCompactionEngine
    agent: Agent
    prompt: (text: string) => Promise<void>
  }> {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(TokenMeter)
    const adapter = new TwoWindowAdapter()
    ctx.llm.registerAdapter(['big', 'small', 'other'], adapter)
    const compact = new BasicCompactionEngine(ctx, { headroomTokens: 0, maxTokens: 64, maxOverflowRetries })
    const agent = await ctx.agentLoop.create(brandString<SessionId>(`switch-${maxOverflowRetries}`), { provider: 'big', model: 'big' })
    const prompt = async (text: string): Promise<void> => {
      agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
      await agent.whenIdle()
    }
    for (let turn = 0; turn < 4; turn += 1) await prompt('上下文'.repeat(667))
    adapter.requests.length = 0
    agent.model.select({ provider: 'small', model: 'small' })
    return { ctx, adapter, compact, agent, prompt }
  }

  it('recovers the overflowed request by summarizing on the route that last answered', async () => {
    const { ctx, adapter, agent, prompt } = await switchedHistory(1)
    try {
      await prompt('继续')

      expect(adapter.requests).toEqual([
        { kind: 'chat', model: 'small', overflow: true },
        { kind: 'summary', model: 'big', overflow: false },
        { kind: 'chat', model: 'small', overflow: false },
      ])
      const events = agent.session.snapshotEvents()
      expect(events.findLast(event => event.type === 'compaction/summary')?.data)
        .toMatchObject({ provider: 'big', model: 'big' })
      expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
      expect(agent.session.requestHeader()?.config.model).toBe('small')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('summarizes manual compaction on the route that last answered, not the failed header or a pending selection', async () => {
    const { ctx, adapter, compact, agent, prompt } = await switchedHistory(0)
    try {
      await prompt('继续')
      expect(adapter.requests).toEqual([{ kind: 'chat', model: 'small', overflow: true }])
      expect(agent.session.snapshotEvents().at(-1)).toMatchObject({
        type: 'turn/end', data: { reason: { kind: 'error', error: { code: CONTEXT_WINDOW_EXCEEDED_CODE } } },
      })
      expect(agent.session.requestHeader()?.config.model).toBe('small')

      adapter.requests.length = 0
      agent.model.select({ provider: 'other', model: 'other' })
      const result = await compact.compactNow(agent, new AbortController().signal)

      expect(adapter.requests).toEqual([{ kind: 'summary', model: 'big', overflow: false }])
      expect(result?.summary).toEqual([{ type: 'text', text: 'SWITCH CHECKPOINT' }])
      expect(agent.model.current()).toMatchObject({ provider: 'other', model: 'other' })
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

/** Adapter whose request cap is separate from its much larger context window. */
class TpmAdapter extends LlmAdapter {
  readonly requests: Array<{ request: GenerateOptions; budget: LlmRequestTokenBudget | undefined }> = []
  outputAllowance = 64
  summaryOutputAllowance = 64
  queue: LlmQueueAvailability = { kind: 'unknown' }
  holdSummary: ((request: GenerateOptions) => Promise<void>) | undefined
  toolFirst = false
  private conversationCalls = 0
  constructor(private readonly limit: number | undefined) { super() }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, context: { contextWindow: 1_000_000 } })
  }

  override async prepareCall(provider: string, model: string): Promise<PreparedAdapterCall> {
    const info = await this.resolveModel(provider, model)
    return { model: info, requestTokenBudget: request => this.budget(request), stream: request => this.stream(request) }
  }

  override queueAvailability(_request: LlmQueueRequest): Promise<LlmQueueAvailability> {
    return Promise.resolve(this.queue)
  }

  private budget(request: GenerateOptions): LlmRequestTokenBudget | undefined {
    if (this.limit === undefined) return undefined
    const inputTokens = estimateRequestInputTokens(request.messages, request.system, request.tools)
    const allowance = request.purpose === 'compaction' ? this.summaryOutputAllowance : this.outputAllowance
    const outputTokens = Math.min(request.maxTokens ?? allowance, allowance)
    return { tokenLimit: this.limit, inputTokens, outputTokens, estimatedTokens: inputTokens + outputTokens }
  }

  override async * stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    const budget = this.budget(request)
    this.requests.push({ request, budget })
    if (budget !== undefined && budget.estimatedTokens > budget.tokenLimit) {
      throw new LlmError('request exceeds the TPM limit', 'RATE_LIMIT_REQUEST_TOO_LARGE')
    }
    if (request.purpose === 'compaction') await this.holdSummary?.(request)
    if (request.purpose !== 'compaction' && this.toolFirst && this.conversationCalls++ === 0) {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: brandString<ToolCallId>('once'),
        name: 'write_once', arguments: '{}' } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    const text = request.purpose === 'compaction' ? 'Retained checkpoint.' : 'Task completed.'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

describe('TPM-aware compaction before dispatch', () => {
  async function fixture(limit: number | undefined, turns: number, compactionRetries = 1, summaryMaxTokens = 64) {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(TokenMeter)
    const flush = vi.spyOn(ctx.sessions, 'flush').mockResolvedValue(true)
    const adapter = new TpmAdapter(limit)
    ctx.llm.registerAdapter(['mock'], adapter)
    await ctx.plugin(BasicCompactionEngine, { headroomTokens: 0, maxTokens: summaryMaxTokens,
      thresholdRatio: 1, retainTokens: 100, compactionRetries })
    const { agent } = await ctx.agentLoop.createAgent(ctx, {
      sessionId: brandString<SessionId>(`tpm-${limit ?? 'unknown'}-${turns}`),
      seed: turns === 0 ? [] : overflowHistorySeed(turns),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    return { ctx, adapter, agent, flush }
  }

  it('compacts and reprepares once without dispatching the oversized original request', async () => {
    const test = await fixture(2_000, 2)
    try {
      test.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Continue the task.' }] }))
      await test.agent.whenIdle()
      const summaries = test.adapter.requests.filter(item => item.request.purpose === 'compaction')
      const conversations = test.adapter.requests.filter(item => item.request.purpose !== 'compaction')
      expect(summaries.length).toBeGreaterThan(0)
      expect(conversations).toHaveLength(1)
      expect(conversations[0]?.budget?.estimatedTokens).toBeLessThanOrEqual(2_000)
      expect(test.agent.session.snapshotEvents().filter(event => event.type === 'user/message'
        && event.data.source.kind === 'user' && event.data.content.some(block => block.type === 'text' && block.text === 'Continue the task.')))
        .toHaveLength(1)
      expect(test.agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')?.data.reason.kind).toBe('completed')
    } finally { await test.ctx.fiber.dispose() }
  })

  it('fits each summary chunk into the summarizer budget before dispatch', async () => {
    const test = await fixture(3_000, 6, 5)
    try {
      test.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Continue.' }] }))
      await test.agent.whenIdle()
      const summaries = test.adapter.requests.filter(item => item.request.purpose === 'compaction')
      expect(summaries.length).toBeGreaterThan(1)
      for (const item of summaries) expect(item.budget!.estimatedTokens).toBeLessThanOrEqual(item.budget!.tokenLimit)
      expect(test.agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')?.data.reason.kind).toBe('completed')
    } finally { await test.ctx.fiber.dispose() }
  })

  it('bounds a summary output cap that cannot fit the summarizer TPM budget', async () => {
    const test = await fixture(2_000, 2, 2, 10_000)
    try {
      test.adapter.summaryOutputAllowance = 10_000
      test.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Continue.' }] }))
      await test.agent.whenIdle()
      const summary = test.adapter.requests.find(item => item.request.purpose === 'compaction')
      expect(summary?.request.model).toBe('mock')
      expect(summary?.request.maxTokens).toBeLessThan(10_000)
      expect(summary!.budget!.estimatedTokens).toBeLessThanOrEqual(2_000)
      expect(test.agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')?.data.reason.kind).toBe('completed')
    } finally { await test.ctx.fiber.dispose() }
  })

  it('keeps a completed tool result without replaying the tool during TPM recovery', async () => {
    const test = await fixture(3_000, 2, 3)
    try {
      test.adapter.toolFirst = true
      const effect = vi.fn(async () => [{ type: 'text' as const, text: 'tool output '.repeat(700) }])
      test.ctx.tools.register(defineContentToolFixture({ name: 'write_once', description: 'Complete one effect',
        parameters: {}, execute: effect }))
      test.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Continue.' }] }))
      await test.agent.whenIdle()
      expect(effect).toHaveBeenCalledOnce()
      expect(test.agent.session.snapshotEvents().filter(event => event.type === 'tool/result')).toHaveLength(1)
      expect(test.adapter.requests.some(item => item.request.purpose === 'compaction')).toBe(true)
      expect(test.agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')?.data.reason.kind).toBe('completed')
    } finally { await test.ctx.fiber.dispose() }
  })

  it.each([undefined, 10_000])('does not compact below a known limit or with no limit (%s)', async (limit) => {
    const test = await fixture(limit, 2)
    try {
      test.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Continue.' }] }))
      await test.agent.whenIdle()
      expect(test.adapter.requests.filter(item => item.request.purpose === 'compaction')).toHaveLength(0)
      expect(test.agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')?.data.reason.kind).toBe('completed')
    } finally { await test.ctx.fiber.dispose() }
  })

  it('does not compact merely because the shared rolling-minute ledger is busy', async () => {
    const test = await fixture(10_000, 2)
    try {
      test.adapter.queue = { kind: 'wait', waitMs: 60_000 }
      test.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Continue.' }] }))
      await test.agent.whenIdle()
      expect(test.adapter.requests.filter(item => item.request.purpose === 'compaction')).toHaveLength(0)
    } finally { await test.ctx.fiber.dispose() }
  })

  it('reports an indivisible oversized user message without dispatching or truncating it', async () => {
    const test = await fixture(3_000, 0)
    try {
      test.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'x'.repeat(20_000) }] }))
      await test.agent.whenIdle()
      expect(test.adapter.requests).toHaveLength(0)
      expect(test.agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')).toMatchObject({
        data: { reason: { kind: 'error', error: { code: 'RATE_LIMIT_REQUEST_TOO_LARGE' } } },
      })
    } finally { await test.ctx.fiber.dispose() }
  })

  it('does not summarize when the reserved output alone exceeds the budget', async () => {
    const test = await fixture(3_000, 2)
    try {
      test.adapter.outputAllowance = 4_000
      test.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Continue.' }] }))
      await test.agent.whenIdle()
      expect(test.adapter.requests).toHaveLength(0)
      expect(test.agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')).toMatchObject({
        data: { reason: { kind: 'error', error: { code: 'RATE_LIMIT_REQUEST_TOO_LARGE' } } },
      })
    } finally { await test.ctx.fiber.dispose() }
  })

  it('stops admission when a committed reduction cannot be flushed', async () => {
    const test = await fixture(2_000, 2)
    try {
      test.flush.mockResolvedValue(false)
      test.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Continue.' }] }))
      await test.agent.whenIdle()
      expect(test.adapter.requests.some(item => item.request.purpose === 'compaction')).toBe(true)
      expect(test.adapter.requests.some(item => item.request.purpose !== 'compaction')).toBe(false)
      expect(test.agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')).toMatchObject({
        data: { reason: { kind: 'error', error: { code: 'COMPACTION_DURABILITY_REQUIRED' } } },
      })
    } finally { await test.ctx.fiber.dispose() }
  })

  it('cancels an in-flight TPM summary without starting the conversation request', async () => {
    const test = await fixture(2_000, 2)
    const entered = Promise.withResolvers<undefined>()
    test.adapter.holdSummary = request => new Promise<void>((_resolve, reject) => {
      const signal = request.signal
      if (signal === undefined) throw new Error('Expected summary cancellation')
      const abort = (): void => { reject(signal.reason instanceof Error ? signal.reason : new Error('Summary cancelled')) }
      if (signal.aborted) { abort(); return }
      signal.addEventListener('abort', abort, { once: true })
      entered.resolve(undefined)
    })
    try {
      test.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Continue.' }] }))
      await entered.promise
      test.agent.cancel({ kind: 'user' })
      await test.agent.whenIdle()
      expect(test.adapter.requests.some(item => item.request.purpose !== 'compaction')).toBe(false)
      expect(test.agent.session.snapshotEvents().some(event => event.type === 'compaction/end')).toBe(true)
    } finally {
      test.agent.cancel({ kind: 'user' })
      await test.ctx.fiber.dispose()
    }
  })
})
