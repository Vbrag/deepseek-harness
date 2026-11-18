/** Persisted-child model control owns storage without activating task recovery. */
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { appendPluginRecord, SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import SubagentRuntime, { snapshotSubagentDescriptor } from '../src/index.ts'
import type { SubagentColdModelChangeContext, SubagentModelChangeRequest } from '../src/index.ts'
import { establishCatalogChild } from '../src/catalog.ts'
import { mountLocalActivations } from './local-activation.ts'
import { TestSessionQuery } from './test-session-query.ts'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    'plugin:subagent-test/cold-phase': { checkpoint: string; cancelled?: boolean }
  }
}

const ORIGINAL = { provider: 'models', model: 'original' }
const ROUTES = [ORIGINAL, { provider: 'models', model: 'coder' }]

async function setup() {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await mountLocalActivations(ctx)
  await ctx.plugin(TestSessionQuery)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new MockAdapter([])
  ctx.llm.registerAdapter(['models'], adapter)
  const rootHandle = await ctx.agents.create({ sessionId: SessionId('cold-root'), agentOptions: ORIGINAL })
  const root = rootHandle.agent
  const childId = SessionId('cold-child')
  const child = await ctx.agents.create({ sessionId: childId, agentOptions: ORIGINAL,
    meta: { parentSession: root.id, origin: 'subagent', delegationDepth: 1 } })
  const descriptor = snapshotSubagentDescriptor({ mode: 'continuable', provider: 'spawn', label: 'cold child',
    agentProvider: ORIGINAL.provider, agentModel: ORIGINAL.model })
  child.agent.session.append('subagent/descriptor', descriptor)
  establishCatalogChild(root.session, child.agent.session.header, descriptor, 'cold-child')
  const stop = async () => {
    await ctx.sessions.flush(root.session)
    await child.dispose()
  }
  const request = (caller = root, extra: Partial<SubagentModelChangeRequest> = {}): SubagentModelChangeRequest => ({
    caller, target: childId, taskAssessment: { requiredCapabilities: ['coding'], contextTokens: 100 },
    reason: 'Implement the remaining change', checkpoint: 'Design and constraints are saved',
    signal: new AbortController().signal, ...extra,
  })
  const register = (change: (context: SubagentColdModelChangeContext) => Promise<void> = async ({ request, session, flush }) => {
    appendPluginRecord(session, 'plugin:subagent-test/cold-phase', { checkpoint: request.checkpoint })
    await flush()
  }) => {
    const handler = vi.fn(async (context: SubagentColdModelChangeContext) => {
      await change(context)
      return { status: 'queued' as const, target: context.session.id }
    })
    ctx.subagents.registerModelRouter({ resolve: async () => undefined, requestColdChange: handler })
    return handler
  }
  return { ctx, root, rootHandle, child, childId, adapter, stop, request, register }
}

describe('cold child model changes', () => {
  it('queues a durable phase on the same identity without publishing or waking an Agent', async () => {
    const test = await setup()
    test.root.session.append('subagent/model-selection-policy', { allowedModels: ROUTES })
    const pending = createUserMessage({ content: [{ type: 'text', text: 'Authorized work waiting for explicit resume' }], source: { kind: 'user' } })
    test.child.agent.session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [pending] })
    await test.stop()
    const created = vi.fn()
    test.ctx.on('agent/created', ({ agent }) => {
      created()
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Creation recovery would wake this agent' }], source: { kind: 'user' } }))
    })
    const sessionCreated = vi.fn()
    test.ctx.on('session/created', sessionCreated)
    const handler = test.register()
    const before = await test.ctx.sessionPersistence.list()
    expect(await test.ctx.subagents.requestModelChange(test.request())).toEqual({ status: 'queued', target: test.childId })
    expect(handler).toHaveBeenCalledOnce()
    expect(handler.mock.calls[0]?.[0].allowedRoutes).toEqual(ROUTES)
    expect(test.ctx.agents.get(test.childId)).toBeUndefined()
    expect(test.ctx.sessions.get(test.childId)).toBeUndefined()
    expect(test.adapter.requests).toHaveLength(0)
    expect(created).not.toHaveBeenCalled()
    expect(sessionCreated).not.toHaveBeenCalled()
    expect((await test.ctx.sessionPersistence.list()).map(row => row.header.id)).toEqual(before.map(row => row.header.id))
    const read = await test.ctx.sessionPersistence.open(test.childId, 'read')
    try {
      const records = (await read.read()).events
      expect(records.filter(event => event.type === 'subagent/running-model-policy')).toHaveLength(1)
      expect(records.at(-1)).toMatchObject({ type: 'plugin:subagent-test/cold-phase', data: { checkpoint: test.request().checkpoint } })
      expect(records.some(event => event.type === 'agent/inbox/spliced' && event.data.inserted?.some(message => message.id === pending.id))).toBe(true)
    } finally { await read.close() }
  })

  it('retains an existing child grant even when the parent grants more models', async () => {
    const test = await setup()
    test.root.session.append('subagent/model-selection-policy', { allowedModels: ROUTES })
    test.child.agent.session.append('subagent/running-model-policy', { allowedModels: [ORIGINAL] })
    await test.stop()
    const handler = test.register()
    await test.ctx.subagents.requestModelChange(test.request())
    expect(handler.mock.calls[0]?.[0].allowedRoutes).toEqual([ORIGINAL])
  })

  it('preserves parent-only legacy authority when no parent policy was recorded', async () => {
    const test = await setup()
    await test.stop()
    const handler = test.register()
    await test.ctx.subagents.requestModelChange(test.request())
    expect(handler.mock.calls[0]?.[0].allowedRoutes).toEqual([ORIGINAL])
  })

  it('rejects a sibling without modifying the cold child', async () => {
    const test = await setup()
    await test.stop()
    const sibling = await test.ctx.agents.create({ sessionId: SessionId('cold-sibling'), agentOptions: ORIGINAL,
      meta: { parentSession: test.root.id, origin: 'subagent', delegationDepth: 1 } })
    const handler = test.register()
    await expect(test.ctx.subagents.requestModelChange(test.request(sibling.agent))).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(handler).not.toHaveBeenCalled()
    const writer = await test.ctx.sessionPersistence.open(test.childId, 'write')
    await writer.close()
  })

  it('refuses a writer already owned elsewhere instead of materializing another lifecycle', async () => {
    const test = await setup()
    await test.stop()
    const handler = test.register()
    const owner = await test.ctx.sessionPersistence.open(test.childId, 'write')
    try {
      await expect(test.ctx.subagents.requestModelChange(test.request())).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' })
      expect(handler).not.toHaveBeenCalled()
      expect(test.ctx.agents.get(test.childId)).toBeUndefined()
    } finally { await owner.close() }
  })

  it.each(['caller-cancel', 'root-drain', 'caller-dispose'] as const)('%s at the permission barrier prevents policy and releases the writer', async (cause) => {
    const test = await setup()
    await test.stop()
    const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
    const open = test.ctx.sessionPersistence.open.bind(test.ctx.sessionPersistence)
    vi.spyOn(test.ctx.sessionPersistence, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args)
      if (args[0] === test.childId && args[1] === 'write') {
        const flush = handle.flush.bind(handle)
        vi.spyOn(handle, 'flush').mockImplementationOnce(async () => { entered.resolve(undefined); await release.promise; await flush() })
      }
      return handle
    })
    const handler = test.register()
    const abort = new AbortController()
    const operation = test.ctx.subagents.requestModelChange(test.request(test.root, { signal: abort.signal }))
    const failure = cause === 'root-drain' ? { code: 'DRAINING' }
      : cause === 'caller-dispose' ? { code: 'UNAUTHORIZED' } : { name: 'AbortError' }
    const rejected = expect(operation).rejects.toMatchObject(failure)
    await entered.promise
    let stopped: Promise<void> | undefined
    if (cause === 'caller-cancel') abort.abort()
    else if (cause === 'root-drain') stopped = test.ctx.subagents.drainDescendants([test.root])
    else await test.rootHandle.dispose()
    release.resolve(undefined)
    await rejected
    await stopped
    expect(handler).not.toHaveBeenCalled()
    const writer = await test.ctx.sessionPersistence.open(test.childId, 'write')
    await writer.close()
  })

  it('allows the policy to save rollback records after a failed phase flush', async () => {
    const test = await setup()
    await test.stop()
    const open = test.ctx.sessionPersistence.open.bind(test.ctx.sessionPersistence)
    vi.spyOn(test.ctx.sessionPersistence, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args)
      if (args[0] === test.childId && args[1] === 'write') {
        const flush = handle.flush.bind(handle)
        let calls = 0
        vi.spyOn(handle, 'flush').mockImplementation(async () => { if (++calls === 2) throw new Error('checkpoint unavailable'); await flush() })
      }
      return handle
    })
    test.register(async ({ request, session, flush }) => {
      appendPluginRecord(session, 'plugin:subagent-test/cold-phase', { checkpoint: request.checkpoint })
      try { await flush() } catch (error) {
        appendPluginRecord(session, 'plugin:subagent-test/cold-phase', { checkpoint: request.checkpoint, cancelled: true })
        await flush()
        throw error
      }
    })
    await expect(test.ctx.subagents.requestModelChange(test.request())).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' })
    const read = await test.ctx.sessionPersistence.open(test.childId, 'read')
    try { expect((await read.read()).events.at(-1)).toMatchObject({ data: { cancelled: true } }) }
    finally { await read.close() }
  })
})
