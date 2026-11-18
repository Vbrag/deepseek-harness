import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { STRUCTURED_OUTPUT_TOOL } from '@deepseek-ai/dsh-subagent'
import OrchestrationService from '@deepseek-ai/dsh-orchestration'
import { pluginRecordOf } from '@deepseek-ai/dsh-session'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import PtcWorkflowEngine from '../src/index.ts'
import { mountPtcRuntime } from './setup.ts'
import { brandString } from '@deepseek-ai/dsh-brand'

type Script = ConstructorParameters<typeof MockAdapter>[0]

async function setup(script: Script) {
  const ctx = new Context()
  const adapter = new MockAdapter(script)
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  const { cwd } = await mountPtcRuntime(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(spawn, { providerName: 'spawn' })
  await ctx.plugin(PtcWorkflowEngine, {})
  ctx.llm.registerAdapter(['mock'], adapter)
  const parent = await ctx.agentLoop.create(brandString<SessionId>('parent'), { provider: 'mock', model: 'mock' }, { cwd })
  return { ctx, parent, adapter }
}

describe('dsh-workflow-ptc over the real in-process stack', () => {
  it.each([
    { active: false, assessed: false, model: 'mock' },
    { active: true, assessed: false, model: undefined },
    { active: true, assessed: true, model: 'coder' },
  ])('routes workflow children with orchestration active=$active and assessed=$assessed', async ({ active, assessed, model }) => {
    const { ctx, parent, adapter } = await setup([textResponse('child complete')])
    vi.spyOn(adapter, 'resolveModel').mockImplementation((provider, id) => Promise.resolve({
      provider, id, name: id, inputModalities: ['text'], context: { contextWindow: 100_000 },
    }))
    const pool = [{ provider: 'mock', model: 'coder' }]
    parent.session.append('subagent/model-selection-policy', { allowedModels: pool })
    await ctx.plugin(OrchestrationService, {
      pool, routeCapabilities: [{ ...pool[0]!, capabilities: ['coding'] }],
    })
    ctx.orchestrations.setMode(parent, active)
    const assessment = { requiredCapabilities: ['coding'], contextTokens: 1000 }
    const run = ctx.workflowEngine.start({
      meta: { name: 'assessed-workflow', description: 'route a fresh local child' },
      script: `return await agent('implement the parser'${assessed ? `, { task_assessment: ${JSON.stringify(assessment)} }` : ''})`,
      parent,
    })
    try {
      const result = await run.result
      if (model === undefined) {
        expect(result).toMatchObject({ stopReason: 'error', errorCode: 'AGENT_START' })
        expect(result.error).toContain('orchestration mode requires task_assessment')
        expect(adapter.requests).toEqual([])
      } else {
        expect(result).toMatchObject({ stopReason: 'completed', value: 'child complete', agentsStarted: 1 })
        expect(adapter.requests.map(request => request.model)).toEqual([model])
      }
      const decisions = parent.session.snapshotEvents().flatMap((event) => {
        const record = pluginRecordOf(event)
        return record?.type === 'plugin:orchestration/route' ? [record.data] : []
      })
      expect(decisions).toMatchObject(assessed ? [{ assessment, selected: pool[0] }] : [])
    } finally { await run.dispose() }
  })

  it('runs a two-stage workflow: a plain child, then a schema child through the structured runtime', async () => {
    const { ctx, parent } = await setup([
      textResponse('the file list is a.ts'),
      toolCallResponse('c1', STRUCTURED_OUTPUT_TOOL, { verdict: 'real', confidence: 0.9 }),
    ])
    const childIds: string[] = []
    const parentFollowup = vi.spyOn(parent, 'followup')
    const parentSteer = vi.spyOn(parent, 'steer')
    const published = new Set<string>()
    ctx.on('subagent/start', (child) => { published.add(child.id) })
    ctx.on('workflow/agent-start', (_info, agent) => {
      expect(published.has(agent.childId)).toBe(true)
      childIds.push(agent.childId)
    })
    const run = ctx.workflowEngine.start({
      meta: { name: 'integration', description: 'plain + structured children' },
      script: `phase('Read')
const prose = await agent('read the repo')
phase('Judge')
const judged = await agent('judge: ' + prose, {
  schema: { type: 'object', properties: { verdict: { type: 'string', enum: ['real', 'bogus'] }, confidence: { type: 'number' } }, required: ['verdict'] },
})
return { prose, verdict: judged.verdict, confidence: judged.confidence }`,
      parent,
    })
    const result = await run.result
    expect(result.stopReason, result.error?.split('\n')[0]).toBe('completed')
    expect(result.value).toEqual({ prose: 'the file list is a.ts', verdict: 'real', confidence: 0.9 })
    expect(result.agentsStarted).toBe(2)
    await run.dispose()
    expect(parentFollowup).not.toHaveBeenCalled()
    expect(parentSteer).not.toHaveBeenCalled()
    expect(parent.session.snapshotEvents()
      .filter(event => event.type === 'subagent/catalog')
      .map(event => ({ id: event.data.childId, mode: event.data.mode })))
      .toEqual(childIds.map(id => ({ id, mode: 'continuable' })))
    // Both children were disposed to quiescence — no live child agents remain.
    expect(childIds.length).toBe(2)
    for (const childId of childIds) {
      expect(ctx.agents.get(brandString<SessionId>(childId))).toBeUndefined()
    }
  })

  it('a child that fails against its schema (nudges exhausted) reaches the script as null', async () => {
    const { ctx, parent } = await setup([
      textResponse('prose only'),
      textResponse('still prose after the nudge'),
    ])
    const run = ctx.workflowEngine.start({
      meta: { name: 'null-path', description: 'schema failure maps to null' },
      script: `const judged = await agent('judge it', { schema: { type: 'object', properties: { v: { type: 'string' } } } })
return { got: judged === null ? 'null' : 'value' }`,
      parent,
    })
    const result = await run.result
    expect(result.stopReason, result.error?.split('\n')[0]).toBe('completed')
    expect(result.value).toEqual({ got: 'null' })
    await run.dispose()
  })

  it('pairs published children with workflow progress after a progress burst', async () => {
    const { ctx, parent } = await setup([textResponse('child complete')])
    const logs: string[] = []
    const published = new Set<string>()
    const starts: string[] = []
    ctx.on('subagent/start', (child) => { published.add(child.id) })
    ctx.on('workflow/log', (_info, message) => { logs.push(message) })
    ctx.on('workflow/agent-start', (_info, child) => {
      expect(published.has(child.childId)).toBe(true)
      starts.push(child.childId)
    })
    const run = ctx.workflowEngine.start({
      meta: { name: 'progress-burst', description: 'ordered progress and child visibility' },
      script: 'for (let index = 0; index < 200; index++) log(String(index)); return await agent("finish")',
      parent,
    })
    try {
      await expect(run.result).resolves.toMatchObject({ value: 'child complete', stopReason: 'completed', agentsStarted: 1 })
      expect(logs).toEqual(Array.from({ length: 200 }, (_, index) => String(index)))
      expect(starts).toHaveLength(1)
      expect(ctx.agents.get(brandString<SessionId>(starts[0]!))).toBeUndefined()
    } finally {
      await run.dispose()
    }
  })
})
