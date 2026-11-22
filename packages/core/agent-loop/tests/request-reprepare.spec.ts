/** Safe route recapture, request-only interruption, and same-step recovery. */

import { Context } from '@deepseek-ai/cordis'
import { expect, it, onTestFinished, vi } from 'vitest'
import AgentRegistry, { installModelSelection, type Agent } from '@deepseek-ai/dsh-agent'
import LlmRuntime, {
  LlmAdapter, LlmError, ToolCallId, createUserMessage, type GenerateOptions, type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { HarnessError } from '@deepseek-ai/dsh-error'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import AgentLoop from '../src/index.ts'
import { MockAdapter, maxTokensResponse, textResponse, toolCallResponse } from './mock-adapter.ts'

async function fixture(adapter: LlmAdapter) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['models'], adapter)
  const agent = await ctx.agentLoop.create(SessionId('request-reprepare'), { provider: 'models', model: 'vision' })
  installModelSelection(agent.ctx)
  const run = async (text = 'Inspect the image and solve the task') => {
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }))
    await agent.whenIdle()
  }
  return { ctx, agent, run }
}

function userInputs(agent: Agent) {
  return agent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'user')
}

function fail(code = 'RATE_LIMIT'): StreamChunk[] {
  return [{ type: 'finish', reason: { kind: 'error', failure: { code, message: 'Request rejected' } } }]
}

it('awaits step routing before capturing model-dependent tools and prompt', async () => {
  const adapter = new MockAdapter([textResponse('done')])
  const test = await fixture(adapter)
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  test.ctx.on('agent/step-preparing', async ({ agent, messages }) => {
    expect(messages[0]?.source.kind).toBe('user')
    entered.resolve(undefined)
    await release.promise
    agent.model.select({ provider: 'models', model: 'reasoning' })
  })
  test.ctx.tools.register(defineContentToolFixture({ name: 'reasoning_tool', description: 'Reasoning route tool',
    parameters: {}, execute: async () => [] }), { when: ({ modelSelection }) => modelSelection.model === 'reasoning' })
  const run = test.run()
  try {
    await entered.promise
    expect(adapter.requests).toHaveLength(0)
    release.resolve(undefined)
    await run
    expect(adapter.requests[0]?.model).toBe('reasoning')
    expect(adapter.requests[0]?.tools?.map(tool => tool.name)).toContain('reasoning_tool')
  } finally {
    release.resolve(undefined)
    await run
  }
})

it('reprepares a failed request with new tools and a switch notice without duplicate input', async () => {
  const adapter = new MockAdapter([fail(), textResponse('solved')])
  const test = await fixture(adapter)
  for (const model of ['vision', 'reasoning']) {
    test.ctx.tools.register(defineContentToolFixture({ name: model + '_tool', description: model,
      parameters: {}, execute: async () => [] }), { when: ({ modelSelection }) => modelSelection.model === model })
  }
  const preparing: string[] = []
  test.ctx.on('agent/step-preparing', ({ agent }) => { preparing.push(agent.model.current()?.model ?? '') })
  test.ctx.on('agent/request-error', ({ agent, provider, model, stage }) => {
    expect({ provider, model, stage }).toEqual({ provider: 'models', model: 'vision', stage: 'stream' })
    agent.model.select({ provider: 'models', model: 'reasoning' })
    return Promise.resolve({ kind: 'reprepare' })
  })
  await test.run()
  expect(adapter.requests.map(request => request.model)).toEqual(['vision', 'reasoning'])
  expect(adapter.requests[0]?.tools?.map(tool => tool.name)).toEqual(['vision_tool'])
  expect(adapter.requests[1]?.tools?.map(tool => tool.name)).toEqual(['reasoning_tool'])
  expect(preparing).toEqual(['vision', 'reasoning'])
  expect(userInputs(test.agent)).toHaveLength(1)
  expect(test.agent.session.snapshotEvents().filter(event => event.type === 'step/start')).toHaveLength(1)
  const notices = test.agent.session.snapshotEvents().filter(event => event.type === 'user/message'
    && event.data.source.kind === 'model-selection')
  expect(notices).toHaveLength(1)
  expect(JSON.stringify(adapter.requests[1]?.messages)).toContain('session continues with reasoning')
})

it('keeps ordinary retry on its captured route even when a future selection changes', async () => {
  const adapter = new MockAdapter([fail(), textResponse('retried')])
  const test = await fixture(adapter)
  const preparing = vi.fn()
  test.ctx.on('agent/step-preparing', preparing)
  test.ctx.on('agent/request-error', ({ agent }) => {
    agent.model.select({ provider: 'models', model: 'reasoning' })
    return Promise.resolve({ kind: 'retry' })
  })
  await test.run()
  expect(adapter.requests.map(request => request.model)).toEqual(['vision', 'vision'])
  expect(preparing).toHaveBeenCalledTimes(1)
  expect(userInputs(test.agent)).toHaveLength(1)
})

it('recovers structured call preparation failure before admitting the input', async () => {
  const adapter = new MockAdapter([textResponse('recovered')])
  const test = await fixture(adapter)
  vi.spyOn(test.ctx.llm, 'prepareCall').mockRejectedValueOnce(new LlmError('Context is too large', 'CONTEXT_WINDOW_EXCEEDED'))
  test.ctx.on('agent/request-error', ({ agent, model, stage }) => {
    expect(model).toBe('vision')
    expect(stage).toBe('request-preparation')
    expect(userInputs(agent)).toHaveLength(0)
    agent.model.select({ provider: 'models', model: 'reasoning' })
    return Promise.resolve({ kind: 'reprepare' })
  })
  await test.run()
  expect(adapter.requests.map(request => request.model)).toEqual(['reasoning'])
  expect(userInputs(test.agent)).toHaveLength(1)
})

it('recovers a structured pre-step compaction failure before step admission', async () => {
  const adapter = new MockAdapter([textResponse('recovered')])
  const test = await fixture(adapter)
  test.ctx.on('agent/pre-step', ({ modelSelection }, next) => {
    if (modelSelection.model === 'vision') throw new HarnessError('The compaction budget cannot fit', 'COMPACTION_INVALID_BUDGET')
    return next()
  })
  test.ctx.on('agent/request-error', ({ agent, failure, stage }) => {
    expect(failure.code).toBe('COMPACTION_INVALID_BUDGET')
    expect(stage).toBe('step-preparation')
    agent.model.select({ provider: 'models', model: 'reasoning' })
    return Promise.resolve({ kind: 'reprepare' })
  })
  await test.run()
  expect(adapter.requests.map(request => request.model)).toEqual(['reasoning'])
  expect(userInputs(test.agent)).toHaveLength(1)
  expect(test.agent.session.snapshotEvents().filter(event => event.type === 'step/start')).toHaveLength(1)
})

it('recovers a routing preparation failure with the claimed input still available', async () => {
  const adapter = new MockAdapter([textResponse('recovered')])
  const test = await fixture(adapter)
  test.ctx.on('agent/step-preparing', ({ agent }) => {
    if (agent.model.current()?.model === 'vision') throw new HarnessError('The provider is unavailable', 'NO_ADAPTER')
  })
  test.ctx.on('agent/request-error', ({ agent, failure, stage, messages }) => {
    expect(failure.code).toBe('NO_ADAPTER')
    expect(stage).toBe('step-preparation')
    expect(messages?.[0]?.content).toEqual([{ type: 'text', text: 'Inspect the image and solve the task' }])
    expect(userInputs(agent)).toHaveLength(0)
    agent.model.select({ provider: 'models', model: 'reasoning' })
    return Promise.resolve({ kind: 'reprepare' })
  })
  await test.run()
  expect(adapter.requests.map(request => request.model)).toEqual(['reasoning'])
  expect(userInputs(test.agent)).toHaveLength(1)
})

it('does not offer programming defects to model-request recovery', async () => {
  const test = await fixture(new MockAdapter([]))
  const recovery = vi.fn()
  test.ctx.on('agent/pre-step', () => { throw new TypeError('Broken policy implementation') })
  test.ctx.on('agent/request-error', recovery)
  await test.run()
  expect(recovery).not.toHaveBeenCalled()
  expect(test.agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')?.data.reason.kind).toBe('error')
})

it('honors a rejected preparation after recovery without dispatching or readmitting input', async () => {
  const adapter = new MockAdapter([fail()])
  const test = await fixture(adapter)
  test.ctx.on('agent/request-error', ({ agent }) => {
    agent.model.select({ provider: 'models', model: 'reasoning' })
    return Promise.resolve({ kind: 'reprepare' })
  })
  test.ctx.on('agent/pre-step', ({ modelSelection }, next) => modelSelection.model === 'reasoning'
    ? Promise.resolve({ kind: 'reject' }) : next())
  await test.run()
  expect(adapter.requests).toHaveLength(1)
  expect(userInputs(test.agent)).toHaveLength(1)
  expect(test.agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')?.data.reason.kind).toBe('blocked')
})

it('interrupts metadata preparation without interrupting the owning turn', async () => {
  const adapter = new MockAdapter([textResponse('recovered')])
  const test = await fixture(adapter)
  const entered = Promise.withResolvers<undefined>()
  const finish = Promise.withResolvers<undefined>()
  const original = test.ctx.llm.prepareCall.bind(test.ctx.llm)
  vi.spyOn(test.ctx.llm, 'prepareCall').mockImplementationOnce(async (config, signal) => {
    entered.resolve(undefined)
    await finish.promise
    signal?.throwIfAborted()
    return original(config, signal)
  })
  test.ctx.on('agent/request-error', ({ agent, requestInterrupted, stage }) => {
    expect({ requestInterrupted, stage }).toEqual({ requestInterrupted: true, stage: 'request-preparation' })
    agent.model.select({ provider: 'models', model: 'reasoning' })
    return Promise.resolve({ kind: 'reprepare' })
  })
  const run = test.run()
  try {
    await entered.promise
    expect(test.agent.interruptRequest()).toBe(true)
    finish.resolve(undefined)
    await run
    expect(adapter.requests.map(request => request.model)).toEqual(['reasoning'])
    expect(userInputs(test.agent)).toHaveLength(1)
  } finally {
    finish.resolve(undefined)
    await run
  }
})

it('does not replay an already executed tool when a later model request is reprepared', async () => {
  const adapter = new MockAdapter([toolCallResponse('write-once', 'write_once', {}), fail(), textResponse('done')])
  const test = await fixture(adapter)
  const execute = vi.fn(async () => [])
  test.ctx.tools.register(defineContentToolFixture({ name: 'write_once', description: 'Perform one durable action', parameters: {}, execute }))
  test.ctx.on('agent/request-error', ({ agent }) => {
    agent.model.select({ provider: 'models', model: 'reasoning' })
    return Promise.resolve({ kind: 'reprepare' })
  })
  await test.run()
  expect(execute).toHaveBeenCalledTimes(1)
  expect(adapter.requests.map(request => request.model)).toEqual(['vision', 'vision', 'reasoning'])
  expect(test.agent.session.snapshotEvents().filter(event => event.type === 'tool/result')).toHaveLength(1)
})

it('retains discarded tool blocks as an attempt and executes no rejected generation', async () => {
  const adapter = new MockAdapter([toolCallResponse('discarded', 'effect', {}), textResponse('replacement')])
  const test = await fixture(adapter)
  const execute = vi.fn(async () => [])
  test.ctx.tools.register(defineContentToolFixture({ name: 'effect', description: 'A side effect', parameters: {}, execute }))
  test.ctx.on('agent/request-finished', ({ agent, model, content }) => {
    if (model !== 'vision') return Promise.resolve(undefined)
    expect(content[0]?.type).toBe('tool-call')
    expect(agent.interruptRequest()).toBe(false)
    agent.model.select({ provider: 'models', model: 'reasoning' })
    return Promise.resolve({ kind: 'reprepare' })
  })
  await test.run()
  expect(execute).not.toHaveBeenCalled()
  expect(test.agent.session.snapshotEvents().filter(event => event.type === 'assistant/attempt')).toHaveLength(1)
  expect(test.agent.session.snapshotEvents().filter(event => event.type === 'tool/call')).toHaveLength(0)
})

it('offers output-limit recovery after transport settlement without adding a task turn', async () => {
  const adapter = new MockAdapter([maxTokensResponse(''), textResponse('complete')])
  const test = await fixture(adapter)
  test.ctx.on('agent/request-finished', ({ agent, finish, content, usage }) => {
    if (finish.kind !== 'max-tokens') return Promise.resolve(undefined)
    expect(content.every(block => block.type === 'text' && block.text === '')).toBe(true)
    expect(usage?.inputTokens).toBe(10)
    agent.model.select({ provider: 'models', model: 'reasoning' })
    return Promise.resolve({ kind: 'reprepare' })
  })
  await test.run()
  expect(adapter.requests.map(request => request.model)).toEqual(['vision', 'reasoning'])
  expect(test.agent.session.snapshotEvents().filter(event => event.type === 'turn/start')).toHaveLength(1)
  expect(test.agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')?.data.reason.kind).toBe('completed')
})

it('waits for interrupted transport cleanup before recovery while preserving queued input', async () => {
  const streaming = Promise.withResolvers<undefined>()
  const interrupted = Promise.withResolvers<undefined>()
  const cleanup = Promise.withResolvers<undefined>()
  const requests: GenerateOptions[] = []
  let settled = false
  class Adapter extends LlmAdapter {
    override async * stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
      requests.push(request)
      if (requests.length > 1) { yield* textResponse('complete'); return }
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'partial request' }
      yield { type: 'block-start', index: 1, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 1, id: ToolCallId('interrupted-effect'), name: 'effect', argumentsDelta: '{"unfinished":' }
      try {
        await new Promise<void>((resolve) => {
          request.signal?.addEventListener('abort', () => { interrupted.resolve(undefined); resolve() }, { once: true })
          streaming.resolve(undefined)
        })
        await cleanup.promise
        throw new DOMException('request stopped', 'AbortError')
      } finally {
        settled = true
      }
    }
  }
  const test = await fixture(new Adapter())
  let recoveries = 0
  test.ctx.on('agent/request-error', ({ agent, requestInterrupted, failure, signal }) => {
    expect(settled).toBe(true)
    expect(signal.aborted).toBe(false)
    expect(requestInterrupted).toBe(true)
    expect(failure.code).toBe('REQUEST_INTERRUPTED')
    recoveries++
    agent.model.select({ provider: 'models', model: 'reasoning' })
    return Promise.resolve({ kind: 'reprepare' })
  })
  expect(test.agent.interruptRequest()).toBe(false)
  const run = test.run()
  try {
    await streaming.promise
    test.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Queued task' }] }))
    expect(test.agent.interruptRequest('Change task phase')).toBe(true)
    expect(test.agent.interruptRequest()).toBe(false)
    await interrupted.promise
    expect(recoveries).toBe(0)
    expect(requests).toHaveLength(1)
    cleanup.resolve(undefined)
    await run
    expect(recoveries).toBe(1)
    expect(requests.map(request => request.model)).toEqual(['vision', 'reasoning', 'reasoning'])
    expect(userInputs(test.agent)).toHaveLength(2)
    expect(test.agent.session.snapshotEvents().filter(event => event.type === 'assistant/attempt')).toHaveLength(1)
    expect(test.agent.session.snapshotEvents().filter(event => event.type === 'tool/call')).toHaveLength(0)
    expect(test.agent.session.snapshotEvents().filter(event => event.type === 'turn/end')
      .every(event => event.data.reason.kind === 'completed')).toBe(true)
  } finally {
    cleanup.resolve(undefined)
    test.agent.cancel({ kind: 'user' })
    await run
  }
})

it('clears request interruption before tools and applies a tool-phase choice to the next step', async () => {
  const adapter = new MockAdapter([toolCallResponse('phase', 'phase', {}), textResponse('done')])
  const test = await fixture(adapter)
  test.ctx.tools.register(defineContentToolFixture({ name: 'phase', description: 'Change the next task phase', parameters: {},
    execute: async (_args, exec) => {
      expect(exec.agent?.interruptRequest()).toBe(false)
      exec.agent?.model.select({ provider: 'models', model: 'reasoning' })
      return []
    } }))
  await test.run()
  expect(adapter.requests.map(request => request.model)).toEqual(['vision', 'reasoning'])
})

it('gives whole-turn cancellation precedence over a recovery action', async () => {
  const adapter = new MockAdapter([fail(), textResponse('must not execute')])
  const test = await fixture(adapter)
  test.ctx.on('agent/request-error', ({ agent }) => {
    agent.cancel({ kind: 'user' })
    return Promise.resolve({ kind: 'reprepare' })
  })
  await test.run()
  expect(adapter.requests).toHaveLength(1)
  expect(test.agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')?.data.reason.kind).toBe('aborted')
})
