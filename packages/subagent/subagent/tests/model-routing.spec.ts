/** Fresh-child routing participates in admission, authorization, and settled cleanup. */

import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import SubagentRuntime from '../src/index.ts'
import type { SubagentActivationSpec, SubagentModelRoutingContext } from '../src/types.ts'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { mountLocalActivations } from './local-activation.ts'

const ASSESSMENT = { requiredCapabilities: ['coding'], contextTokens: 100 }

async function setup() {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await mountLocalActivations(ctx)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new MockAdapter([textResponse('done'), textResponse('done')])
  ctx.llm.registerAdapter(['models'], adapter)
  ctx.subagents.registerProvider({
    name: 'spawn',
    capabilities: { agentOptions: true, agentPreset: true, outputSchema: true, depthLimit: true },
    inheritsParentContext: false,
    prepareContinuable: () => Promise.resolve({}),
  })
  const { agent: parent } = await ctx.agents.create({
    sessionId: brandString<SessionId>('parent'),
    agentOptions: { provider: 'models', model: 'lead' },
  })
  return { ctx, parent, adapter }
}

function request(parent: Agent, extra: Partial<SubagentActivationSpec> = {}): SubagentActivationSpec {
  return {
    provider: 'spawn', label: 'implement change', delivery: 'caller', parent,
    prompt: [{ type: 'text', text: 'implement the change' }], taskAssessment: ASSESSMENT,
    signal: new AbortController().signal,
    ...extra,
  }
}

describe('fresh-child model routing', () => {
  it('routes before preflight and persists only the effective model', async () => {
    const { ctx, parent, adapter } = await setup()
    parent.session.append('subagent/model-selection-policy', { allowedModels: [{ provider: 'models', model: 'coder' }] })
    const release = vi.fn()
    const setupChild = vi.fn((_child: Agent) => {})
    const resolve = vi.fn(async (context: SubagentModelRoutingContext) => ({
      agentOptions: { ...context.agentOptions, provider: 'models', model: 'coder' }, setup: setupChild, release,
    }))
    ctx.subagents.registerModelRouter({ resolve })
    const activation = await ctx.subagents.startActivation(request(parent, { agentOptions: { provider: 'missing', model: 'missing' } }))
    await activation.result
    expect(resolve.mock.calls[0]?.[0].taskAssessment).toEqual(ASSESSMENT)
    expect(adapter.requests[0]).toMatchObject({ provider: 'models', model: 'coder' })
    const child = setupChild.mock.calls[0]![0]
    expect(child.session.snapshotEvents().find(event => event.type === 'subagent/descriptor')?.data)
      .toMatchObject({ agentProvider: 'models', agentModel: 'coder' })
    expect(release).toHaveBeenCalledOnce()
  })

  it('preserves ordinary inheritance and authorized explicit choices when the policy selects no model', async () => {
    const { ctx, parent, adapter } = await setup()
    parent.session.append('subagent/model-selection-policy', { allowedModels: [{ provider: 'models', model: 'coder' }] })
    ctx.subagents.registerModelRouter({ resolve: async () => ({ setup() {} }) })
    const activation = await ctx.subagents.startActivation(request(parent))
    await activation.result
    expect(adapter.requests[0]?.model).toBe('lead')
    const explicit = await ctx.subagents.startActivation(request(parent, { agentOptions: { provider: 'models', model: 'coder' } }))
    await explicit.result
    expect(adapter.requests[1]?.model).toBe('coder')
  })

  it.each([false, true])('rejects unauthorized final selection when historical policy exists: %s', async (recorded) => {
    const { ctx, parent } = await setup()
    if (recorded) parent.session.append('subagent/model-selection-policy', { allowedModels: [{ provider: 'models', model: 'allowed' }] })
    const release = vi.fn()
    ctx.subagents.registerModelRouter({ resolve: async () => ({ agentOptions: { provider: 'models', model: 'denied' }, release }) })
    await expect(ctx.subagents.startActivation(request(parent))).rejects.toMatchObject({ code: 'MODEL_ROUTE_NOT_ALLOWED' })
    expect(ctx.agents.list()).toEqual([parent])
    expect(release).toHaveBeenCalledOnce()
  })

  it('releases an assignment only after child teardown completes', async () => {
    const { ctx, parent } = await setup()
    const disposing = Promise.withResolvers<undefined>()
    const finish = Promise.withResolvers<undefined>()
    onTestFinished(() => { finish.resolve(undefined) })
    const release = vi.fn()
    ctx.subagents.registerModelRouter({ resolve: async context => ({
      agentOptions: context.agentOptions,
      release,
      setup(child) { child.ctx.effect(() => async () => { disposing.resolve(undefined); await finish.promise }) },
    }) })
    const activation = await ctx.subagents.startActivation(request(parent))
    await disposing.promise
    expect(release).not.toHaveBeenCalled()
    finish.resolve(undefined)
    await activation.result
    expect(release).toHaveBeenCalledOnce()
  })

  it('cancels routing waits and joins rollback when the root drains', async () => {
    const { ctx, parent } = await setup()
    const entered = Promise.withResolvers<undefined>()
    ctx.subagents.registerModelRouter({ resolve: async ({ signal }) => {
      entered.resolve(undefined)
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => { reject(new DOMException('routing cancelled', 'AbortError')) }, { once: true })
      })
      return undefined
    } })
    const starting = ctx.subagents.startActivation(request(parent))
    const rejected = expect(starting).rejects.toBeDefined()
    await entered.promise
    await ctx.subagents.drainDescendants([parent])
    await rejected
    expect(ctx.agents.list()).toEqual([parent])
  })

  it('releases a failed unpublished initialization', async () => {
    const { ctx, parent } = await setup()
    const release = vi.fn()
    ctx.subagents.registerModelRouter({ resolve: async context => ({
      agentOptions: context.agentOptions, release,
      setup() { throw new Error('initialization failed') },
    }) })
    await expect(ctx.subagents.startActivation(request(parent))).rejects.toThrow('initialization failed')
    expect(release).toHaveBeenCalledOnce()
    expect(ctx.agents.list()).toEqual([parent])
  })

  it('releases a selected assignment if its provider disappears before preparation', async () => {
    const { ctx, parent } = await setup()
    const withdraw = ctx.subagents.registerProvider({
      name: 'ephemeral', inheritsParentContext: false,
      capabilities: { agentOptions: true, agentPreset: true, outputSchema: true, depthLimit: true },
      prepareContinuable: () => Promise.resolve({}),
    })
    const release = vi.fn()
    ctx.subagents.registerModelRouter({ resolve: async (context) => {
      withdraw()
      return { agentOptions: context.agentOptions, release }
    } })
    await expect(ctx.subagents.startActivation(request(parent, { provider: 'ephemeral' })))
      .rejects.toMatchObject({ code: 'PROVIDER_CHANGED' })
    expect(release).toHaveBeenCalledOnce()
    expect(ctx.agents.list()).toEqual([parent])
  })

  it('withdraws routing and future-root defaults when its owner unloads', async () => {
    const { ctx } = await setup()
    const owner = ctx.inject(['subagents'], (scope) => {
      scope.subagents.registerModelRouter({
        resolve: async () => undefined,
        newRootPolicyDefaults: () => [{ provider: 'models', model: 'coder' }],
      })
    })
    await owner
    expect(ctx.subagents.routesModelsFor('spawn')).toBe(true)
    expect(ctx.subagents.modelRoutingDefaults()).toEqual([{ provider: 'models', model: 'coder' }])
    await owner.dispose()
    expect(ctx.subagents.routesModelsFor('spawn')).toBe(false)
    expect(ctx.subagents.modelRoutingDefaults()).toBeUndefined()
  })
})
