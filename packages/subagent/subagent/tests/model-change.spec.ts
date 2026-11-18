/** Running-child reassignment preserves recorded authority and exact live lineage. */

import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId, Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import SubagentRuntime, { snapshotSubagentDescriptor } from '../src/index.ts'
import type { SubagentModelChangeContext, SubagentModelChangeRequest, SubagentModelChangeResult } from '../src/types.ts'
import { runningModelPolicyProjectionDefinition as projection, runningModelRoutes, type RunningModelPolicyState } from '../src/running-model-policy.ts'
import { bindSubagentActivation, managerState } from './manager-internals.ts'
import { mountLocalActivations } from './local-activation.ts'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const ORIGINAL = { provider: 'models', model: 'original' }
const ROUTES = [ORIGINAL, { provider: 'models', model: 'coder' }]
const ASSESSMENT = { requiredCapabilities: ['coding'], contextTokens: 100 }

async function setup() {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await mountLocalActivations(ctx)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(AgentLoop, { agents: [] })
  const { agent: root } = await ctx.agents.create({ sessionId: SessionId('root'), agentOptions: ORIGINAL })
  const child = async (id: string, parent = root, ancestors = [root.id]) => {
    const { agent } = await ctx.agents.create({ sessionId: SessionId(id), agentOptions: ORIGINAL,
      meta: { parentSession: parent.id, origin: 'subagent', delegationDepth: ancestors.length } })
    agent.session.append('subagent/descriptor', snapshotSubagentDescriptor({
      mode: 'continuable', provider: 'fixture', label: id, agentProvider: ORIGINAL.provider, agentModel: ORIGINAL.model,
    }))
    bindSubagentActivation(ctx, agent, root, ancestors)
    return agent
  }
  return { ctx, root, child }
}

function request(caller: Agent, target: Agent, extra: Partial<SubagentModelChangeRequest> = {}): SubagentModelChangeRequest {
  return { caller, target: target.id, taskAssessment: ASSESSMENT, reason: 'Implementation needs coding',
    checkpoint: 'Design approved; implement the remaining change', signal: new AbortController().signal, ...extra }
}

function register(ctx: Context) {
  const change = vi.fn(async (context: SubagentModelChangeContext): Promise<SubagentModelChangeResult> => ({ status: 'queued', target: context.child.id }))
  ctx.subagents.registerModelRouter({ resolve: async () => undefined, requestChange: change })
  return change
}

describe('running-child model changes', () => {
  it('keeps self requests pinned to the original route despite newer requests and descendant permissions', async () => {
    const { ctx, root, child } = await setup()
    root.session.append('subagent/model-selection-policy', { allowedModels: ROUTES })
    const target = await child('child')
    target.session.append('subagent/model-selection-policy', { allowedModels: ROUTES })
    target.session.append('request/header', { header: { config: { provider: 'models', model: 'later' } }, reason: 'initial' })
    const change = register(ctx)
    expect(await ctx.subagents.requestModelChange(request(target, target))).toEqual({ status: 'queued', target: target.id })
    const context = change.mock.calls[0]?.[0]
    expect(context?.caller).toBe(target)
    expect(context?.child).toBe(target)
    expect(context?.allowedRoutes).toEqual([ORIGINAL])
    expect(context?.taskAssessment).toEqual(ASSESSMENT)
    expect(target.session.snapshotEvents().filter(event => event.type === 'subagent/running-model-policy')).toHaveLength(0)
  })

  it('captures only the direct creator recorded policy for an authorized ancestor and never widens it again', async () => {
    const { ctx, root, child } = await setup()
    root.session.append('subagent/model-selection-policy', { allowedModels: [{ provider: 'models', model: 'root-only' }] })
    const parent = await child('parent')
    parent.session.append('subagent/model-selection-policy', { allowedModels: ROUTES })
    const target = await child('nested', parent, [root.id, parent.id])
    const change = register(ctx)
    await ctx.subagents.requestModelChange(request(root, target))
    parent.session.append('subagent/model-selection-policy', { allowedModels: [{ provider: 'models', model: 'new' }] })
    await ctx.subagents.requestModelChange(request(parent, target))
    expect(change.mock.calls.map(([context]) => context.allowedRoutes)).toEqual([ROUTES, ROUTES])
    expect(target.session.snapshotEvents().filter(event => event.type === 'subagent/running-model-policy')).toHaveLength(1)
    const detached = ctx.subagents.runningModelPolicyOf(target.session)
    expect(detached).toEqual(ROUTES)
    expect(detached[0]).not.toBe(ROUTES[0])
  })

  it('rejects siblings, unrelated roots, ordinary members, and forged caller objects', async () => {
    const { ctx, root, child } = await setup()
    const target = await child('child')
    const sibling = await child('sibling')
    const { agent: outsider } = await ctx.agents.create({ sessionId: SessionId('outsider') })
    register(ctx)
    for (const caller of [sibling, outsider, { ...root }]) {
      await expect(Promise.resolve().then(() => ctx.subagents.requestModelChange(request(caller, target))))
        .rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    }
    await expect(Promise.resolve().then(() => ctx.subagents.requestModelChange(request(root, root))))
      .rejects.toMatchObject({ code: 'NOT_CONTINUABLE' })
  })

  it('refuses unavailable direct-parent authority instead of substituting the requesting ancestor', async () => {
    const { ctx, root, child } = await setup()
    const target = await child('child', root, [root.id, SessionId('unavailable-parent')])
    root.session.append('subagent/model-selection-policy', { allowedModels: ROUTES })
    const change = register(ctx)
    await expect(ctx.subagents.requestModelChange(request(root, target))).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' })
    expect(change).not.toHaveBeenCalled()
  })

  it('refuses external execution and unsupported policy handlers without creating a child', async () => {
    const { ctx, root, child } = await setup()
    const target = await child('child')
    await expect(Promise.resolve().then(() => ctx.subagents.requestModelChange(request(root, target))))
      .rejects.toMatchObject({ code: 'MODEL_CHANGE_UNAVAILABLE' })
    const resident = managerState(ctx).resident
    const local = resident.get(target.id)!
    const external = { ...local, kind: 'external' as const, controller: new AbortController(),
      run: { id: target.id, result: Promise.resolve({ output: [], stopReason: 'completed' as const }), async dispose() {} } }
    resident.set(target.id, external)
    register(ctx)
    await expect(Promise.resolve().then(() => ctx.subagents.requestModelChange(request(root, target))))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
    resident.set(target.id, local)
    expect(ctx.agents.list()).toHaveLength(2)
  })

  it('cancels and joins an in-flight reassignment before its routing owner unloads', async () => {
    const { ctx, root, child } = await setup()
    const target = await child('child')
    const entered = Promise.withResolvers<undefined>()
    const settled = vi.fn()
    const owner = ctx.inject(['subagents'], (scope) => {
      scope.subagents.registerModelRouter({ resolve: async () => undefined,
        async requestChange({ signal }) {
          entered.resolve(undefined)
          try {
            return await new Promise<never>((_resolve, reject) => {
              signal.addEventListener('abort', () => { reject(new DOMException('router unloaded', 'AbortError')) }, { once: true })
            })
          } finally { settled() }
        },
      })
    })
    await owner
    const operation = ctx.subagents.requestModelChange(request(root, target))
    const rejected = expect(operation).rejects.toMatchObject({ name: 'AbortError' })
    await entered.promise
    await owner.dispose()
    await rejected
    expect(settled).toHaveBeenCalledOnce()
    expect(ctx.subagents.routesModelsFor('fixture')).toBe(false)
  })

  it('does not call the router after cancellation during its permission checkpoint', async () => {
    const { ctx, root, child } = await setup()
    const target = await child('child')
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    ctx.on('session/flush', async (session) => {
      if (session !== target.session) return
      entered.resolve(undefined)
      await release.promise
    })
    const change = register(ctx)
    const abort = new AbortController()
    const operation = ctx.subagents.requestModelChange(request(root, target, { signal: abort.signal }))
    const rejected = expect(operation).rejects.toMatchObject({ name: 'AbortError' })
    await entered.promise
    abort.abort()
    release.resolve(undefined)
    await rejected
    expect(change).not.toHaveBeenCalled()
  })

  it('captures a grant at fresh admission independently of a routing policy', async () => {
    const { ctx, root } = await setup()
    const adapter = new MockAdapter([textResponse('done')])
    ctx.llm.registerAdapter(['models'], adapter)
    root.session.append('subagent/model-selection-policy', { allowedModels: ROUTES })
    let published: Agent | undefined
    ctx.subagents.registerProvider({ name: 'spawn', inheritsParentContext: false,
      capabilities: { agentOptions: true, agentPreset: true, outputSchema: true, depthLimit: true },
      prepareContinuable: async () => ({}) })
    ctx.on('agent/created', ({ agent }) => { if (agent !== root) published = agent })
    const activation = await ctx.subagents.startActivation({ provider: 'spawn', label: 'child', delivery: 'caller', parent: root,
      prompt: [{ type: 'text', text: 'work' }], signal: new AbortController().signal })
    await activation.result
    expect(published).toBeDefined()
    expect(ctx.subagents.runningModelPolicyOf(published!.session)).toEqual(ROUTES)
    const events = published!.session.snapshotEvents()
    expect(events.findIndex(event => event.type === 'subagent/running-model-policy'))
      .toBeLessThan(events.findIndex(event => event.type === 'request/header'))
  })
})

describe('running-model policy projection', () => {
  it('ignores fork-inherited grants and pins the first own creation route', () => {
    const source = Session.create(SessionId('source'))
    const inherited = source.append('subagent/running-model-policy', { allowedModels: ROUTES })
    let state: RunningModelPolicyState = { allowedModels: null, originalRoute: null, inheritedEventCount: inherited.seq + 1 }
    state = projection.apply(state, inherited)
    expect(runningModelRoutes(state)).toEqual([])
    const first = source.append('request/header', { header: { config: ORIGINAL }, reason: 'initial' })
    state = projection.apply(state, first)
    const later = source.append('request/header', { header: { config: { provider: 'models', model: 'later' } }, reason: 'initial' })
    state = projection.apply(state, later)
    expect(runningModelRoutes(state)).toEqual([ORIGINAL])
  })
})
