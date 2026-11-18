import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { describe, expect, it, onTestFinished } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage, type ToolCallId, type LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { pluginRecordOf } from '@deepseek-ai/dsh-session'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { STRUCTURED_OUTPUT_TOOL } from '@deepseek-ai/dsh-subagent'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import PtcWorkflowEngine from '@deepseek-ai/dsh-workflow-ptc'
import Orchestration from '@deepseek-ai/dsh-orchestration'
import { MockAdapter, maxTokensResponse, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as toolRalph from '../src/index.ts'
import { mountWorkflowRuntime } from '../../../workflow/workflow-ptc/tests/setup.ts'

type MockScript = ConstructorParameters<typeof MockAdapter>[0]
const testToolSignal = new AbortController().signal

async function mountExecution(ctx: Context): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-ralph-'))
  onTestFinished(async () => {
    await ctx.fiber.dispose()
    await rm(cwd, { recursive: true, force: true })
  })
  await mountWorkflowRuntime(ctx, { cwd })
  await ctx.plugin(JsonlSessionPersistence, { root: join(cwd, '.sessions') })
  return cwd
}

/** Mount the shipped Ralph execution stack around one keyless model script. */
async function mountRalph(script: MockScript, config: toolRalph.Config,
  orchestration?: { active: boolean; oneCapable?: boolean; allowPool?: boolean }) {
  const ctx = new Context()
  class RoutingAdapter extends MockAdapter {
    override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
      return { ...await super.resolveModel(provider, model), inputModalities: ['text'], context: { contextWindow: 100_000 } }
    }
  }
  const adapter = new RoutingAdapter(script)
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  const cwd = await mountExecution(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(spawn, { providerName: 'spawn' })
  await ctx.plugin(PtcWorkflowEngine, {})
  await ctx.plugin(toolRalph, config)
  ctx.llm.registerAdapter(['mock'], adapter)
  const pool = [{ provider: 'mock', model: 'code-a' }, { provider: 'mock', model: 'code-b' }]
  if (orchestration !== undefined) {
    await ctx.plugin(Orchestration, { pool, routeCapabilities: pool.map((route, index) => ({ ...route,
      capabilities: orchestration.oneCapable && index > 0 ? ['reasoning' as const] : ['coding' as const] })) })
  }
  const parentHandle = await ctx.agents.create({
    sessionId: brandString<SessionId>('ralph-parent'),
    meta: { cwd },
    agentOptions: { provider: 'mock', model: 'mock' },
  })
  if (orchestration !== undefined) {
    parentHandle.agent.session.append('subagent/model-selection-policy', {
      allowedModels: orchestration.allowPool === false ? [{ provider: 'mock', model: 'mock' }] : pool,
    })
    ctx.orchestrations.setMode(parentHandle.agent, orchestration.active)
  }
  return { ctx, adapter, parentHandle, parent: parentHandle.agent }
}

describe('dsh-tool-ralph over the real spawn and sandboxed PTC stack', () => {
  it.each([false, true])('carries the explicit task assessment through every fresh routed round (one capable: %s)',
    { timeout: 90_000 }, async (oneCapable) => {
      const task_assessment = { requiredCapabilities: ['coding'], preferredCapabilities: ['reasoning'],
        requiredModalities: ['text'], contextTokens: 1000, outputTokens: 256 }
      const { ctx, adapter, parent } = await mountRalph([
        toolCallResponse('routed-round-1', STRUCTURED_OUTPUT_TOOL, { status: 'continue', summary: 'First parser slice complete.',
          evidence: ['Focused parser check passed.'], nextSteps: ['Finish the second parser slice.'], blocker: '' }),
        toolCallResponse('routed-round-2', STRUCTURED_OUTPUT_TOOL, { status: 'complete', summary: 'Parser work complete.',
          evidence: ['Both parser checks passed.'], nextSteps: [], blocker: '' }),
      ], { maxRounds: 2 }, { active: true, oneCapable })
      const result = await executeToolFixture(ctx, { signal: testToolSignal, callId: brandString<ToolCallId>('routed-ralph'),
        name: 'ralph', arguments: { objective: 'Implement both parser slices.', task_assessment, maxTokens: 128 }, agent: parent })
      expect(result.isError, JSON.stringify(result.content)).toBe(false)
      expect(adapter.requests.map(request => request.model)).toEqual(oneCapable ? ['code-a', 'code-a'] : ['code-a', 'code-b'])
      expect(adapter.requests.map(request => request.maxTokens)).toEqual([128, 128])
      const decisions = parent.session.snapshotEvents().map(pluginRecordOf).filter(record => record?.type === 'plugin:orchestration/route')
      expect(decisions).toHaveLength(2)
      for (const decision of decisions) {
        if (decision?.type !== 'plugin:orchestration/route') throw new Error('Expected a recorded child route')
        expect(decision.data).toMatchObject({ assessment: task_assessment })
      }
    })

  it('keeps missing assessments strict when Orchestration mode routes a Ralph round', { timeout: 90_000 }, async () => {
    const { ctx, adapter, parent } = await mountRalph([], { maxRounds: 2 }, { active: true })
    const result = await executeToolFixture(ctx, { signal: testToolSignal, callId: brandString<ToolCallId>('unassessed-ralph'),
      name: 'ralph', arguments: { objective: 'Implement the parser.' }, agent: parent })
    expect(result.isError).toBe(true)
    expect(result.error?.info).toEqual({ name: 'RalphError', code: 'RALPH_WORKFLOW_FAILED' })
    const text = result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
    expect(text).toContain('task_assessment')
    expect(adapter.requests).toHaveLength(0)
  })

  it('does not expand recorded model permissions for an otherwise capable Ralph round', { timeout: 90_000 }, async () => {
    const { ctx, adapter, parent } = await mountRalph([], { maxRounds: 1 }, { active: true, allowPool: false })
    const result = await executeToolFixture(ctx, { signal: testToolSignal, callId: brandString<ToolCallId>('unauthorized-ralph'),
      name: 'ralph', arguments: { objective: 'Implement the parser.',
        task_assessment: { requiredCapabilities: ['coding'], contextTokens: 1000 } }, agent: parent })
    expect(result.error?.info).toEqual({ name: 'RalphError', code: 'RALPH_WORKFLOW_FAILED' })
    expect(adapter.requests).toHaveLength(0)
    expect(ctx.subagents.modelSelectionPolicyOf(parent.session)).toEqual([{ provider: 'mock', model: 'mock' }])
  })

  it('preserves inherited fresh-round routing when Orchestration mode is off and assessment is omitted',
    { timeout: 90_000 }, async () => {
      const { ctx, adapter, parent } = await mountRalph([
        toolCallResponse('default-round', STRUCTURED_OUTPUT_TOOL, { status: 'complete', summary: 'Parser work complete.',
          evidence: ['Parser check passed.'], nextSteps: [], blocker: '' }),
      ], { maxRounds: 1 }, { active: false })
      const result = await executeToolFixture(ctx, { signal: testToolSignal, callId: brandString<ToolCallId>('default-ralph'),
        name: 'ralph', arguments: { objective: 'Implement the parser.' }, agent: parent })
      expect(result.isError).toBe(false)
      expect(adapter.requests.map(request => request.model)).toEqual(['mock'])
      expect(parent.session.snapshotEvents().some(event => pluginRecordOf(event)?.type === 'plugin:orchestration/route')).toBe(false)
    })

  it('uses distinct empty-seed children, shared cwd, and only the prior bounded handoff', { timeout: 90_000 }, async () => {
    const firstReport = {
      status: 'continue',
      summary: 'ROUND_ONE_HANDOFF',
      evidence: ['Created migration-a.ts.'],
      nextSteps: ['Finish migration-b.ts.'],
      blocker: '',
    }
    const finalReport = {
      status: 'complete',
      summary: 'Both migration slices are complete.',
      evidence: ['Focused migration tests pass.'],
      nextSteps: [],
      blocker: '',
    }
    const ctx = new Context()
    const adapter = new MockAdapter([
      textResponse('PARENT_HISTORY_MARKER'),
      toolCallResponse('round-1', STRUCTURED_OUTPUT_TOOL, firstReport),
      toolCallResponse('round-2', STRUCTURED_OUTPUT_TOOL, finalReport),
    ])
    await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
    const cwd = await mountExecution(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(spawn, { providerName: 'spawn' })
    await ctx.plugin(PtcWorkflowEngine, {})
    await ctx.plugin(toolRalph, { maxRounds: 2 })
    ctx.llm.registerAdapter(['mock'], adapter)

    const parentHandle = await ctx.agents.create({
      sessionId: brandString<SessionId>('ralph-parent'),
      meta: { cwd },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const parent = parentHandle.agent
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'PARENT_PROMPT_MARKER' }], source: { kind: 'user' } }))
    await parent.whenIdle()

    const children: Agent[] = []
    const phases: string[] = []
    ctx.on('workflow/phase', (_run, title) => { phases.push(title) })
    ctx.on('subagent/start', (child) => {
      const agent = ctx.agents.get(child.id)
      expect(agent).toBeDefined()
      children.push(agent!)
    })
    const result = await executeToolFixture(ctx, {
      signal: testToolSignal,
      callId: brandString<ToolCallId>('ralph-integration'),
      name: 'ralph',
      arguments: { objective: 'Complete both migration slices.', maxRounds: 2 },
      agent: parent,
    })

    expect(result.isError).toBe(false)
    expect((result.content[0] as { text: string }).text)
      .toContain('Ralph worker reported completion after 2 rounds.')
    expect(phases).toEqual(['Fresh-agent rounds'])
    expect(children).toHaveLength(2)
    expect(new Set(children.map(child => child.id)).size).toBe(2)
    for (const child of children) {
      expect(child.session.header.cwd).toBe(cwd)
      expect(child.session.header.parentSession).toBe(parent.session.header.id)
      expect(child.session.header.isSeeded).toBe(false)
      expect(child.session.inheritedEventCount).toBe(0)
      expect(ctx.agents.get(child.id)).toBeUndefined()
    }

    expect(adapter.requests).toHaveLength(3)
    const firstChildRequest = JSON.stringify(adapter.requests[1]!.messages)
    const secondChildRequest = JSON.stringify(adapter.requests[2]!.messages)
    expect(firstChildRequest).not.toContain('PARENT_PROMPT_MARKER')
    expect(firstChildRequest).not.toContain('PARENT_HISTORY_MARKER')
    expect(firstChildRequest).not.toContain('ROUND_ONE_HANDOFF')
    expect(secondChildRequest).not.toContain('PARENT_PROMPT_MARKER')
    expect(secondChildRequest).not.toContain('PARENT_HISTORY_MARKER')
    expect(secondChildRequest).toContain('ROUND_ONE_HANDOFF')

    await parentHandle.dispose()
  })

  it('reports the failed round and last good handoff when a child fails', { timeout: 90_000 }, async () => {
    const firstReport = {
      status: 'continue',
      summary: 'ROUND_ONE_HANDOFF',
      evidence: ['Created migration-a.ts.'],
      nextSteps: ['Finish migration-b.ts.'],
      blocker: '',
    }
    const { ctx, parent, parentHandle } = await mountRalph([
      toolCallResponse('round-1', STRUCTURED_OUTPUT_TOOL, firstReport),
      maxTokensResponse('unfinished child output'),
    ], { maxRounds: 2 })
    const childIds: SessionId[] = []
    ctx.on('workflow/agent-start', (_run, child) => { childIds.push(child.childId) })

    const result = await executeToolFixture(ctx, {
      signal: testToolSignal,
      callId: brandString<ToolCallId>('ralph-child-failure'),
      name: 'ralph',
      arguments: { objective: 'Complete both migration slices.', maxRounds: 2 },
      agent: parent,
    })

    expect(result.isError).toBe(true)
    const text = (result.content[0] as { text: string }).text
    expect(text).toContain('Ralph round 2 child failed before producing a structured report.')
    expect(text).toContain('Last successful handoff:')
    expect(text).toContain('ROUND_ONE_HANDOFF')
    expect(childIds).toHaveLength(2)
    for (const childId of childIds) expect(ctx.agents.get(childId)).toBeUndefined()
    await parentHandle.dispose()
  })

  it.each([
    {
      name: 'blocked',
      report: {
        status: 'blocked',
        summary: 'External authorization is required.',
        evidence: ['The local implementation is ready.'],
        nextSteps: ['Continue after authorization.'],
        blocker: 'The required external authorization is unavailable.',
      },
      config: { maxRounds: 2 },
      expectedError: false,
      expectedText: 'Ralph worker reported a blocker after 1 round.',
    },
    {
      name: 'budget-limited',
      report: {
        status: 'continue',
        summary: 'One slice is complete.',
        evidence: ['The first focused test passes.'],
        nextSteps: ['Implement the remaining slice.'],
        blocker: '',
      },
      config: { maxRounds: 1 },
      expectedError: false,
      expectedText: 'Ralph reached its 1 round limit; the worker reported work remaining.',
    },
    {
      name: 'unnormalized report',
      report: {
        status: 'continue',
        summary: ' padded summary ',
        evidence: ['A focused test passes.'],
        nextSteps: ['Continue implementation.'],
        blocker: '',
      },
      config: { maxRounds: 1 },
      expectedError: true,
      expectedText: 'summary must be non-empty and normalized',
    },
    {
      name: 'invalid continuing report',
      report: {
        status: 'continue',
        summary: 'Work remains.',
        evidence: ['A focused test passes.'],
        nextSteps: [],
        blocker: '',
      },
      config: { maxRounds: 1 },
      expectedError: true,
      expectedText: 'a continuing Ralph report needs nextSteps and an empty blocker',
    },
    {
      name: 'oversized report',
      report: {
        status: 'continue',
        summary: 'x'.repeat(300),
        evidence: ['A focused test passes.'],
        nextSteps: ['Continue implementation.'],
        blocker: '',
      },
      config: { maxRounds: 1, maxHandoffChars: 100 },
      expectedError: true,
      expectedText: 'Ralph round report exceeds maxHandoffChars',
    },
  ])('enforces the fixed script for $name', async ({ report, config, expectedError, expectedText }) => {
    const { ctx, parent, parentHandle } = await mountRalph([
      toolCallResponse('round-report', STRUCTURED_OUTPUT_TOOL, report),
    ], config)

    const result = await executeToolFixture(ctx, {
      signal: testToolSignal,
      callId: brandString<ToolCallId>('ralph-script-enforcement'),
      name: 'ralph',
      arguments: { objective: 'Complete the scoped work.', maxRounds: config.maxRounds },
      agent: parent,
    })

    expect(result.isError).toBe(expectedError)
    expect((result.content[0] as { text: string }).text).toContain(expectedText)
    await parentHandle.dispose()
  })

  it('cancels the sandboxed process and fresh child to quiescence', { timeout: 90_000 }, async () => {
    const { ctx, parent, parentHandle } = await mountRalph(['hang'], { maxRounds: 2 })
    const children: Agent[] = []
    const outcomes: string[] = []
    let resolveChildStarted!: (child: Agent) => void
    const childStarted = new Promise<Agent>((resolve) => { resolveChildStarted = resolve })
    ctx.on('workflow/agent-start', (_run, child) => {
      const agent = ctx.agents.get(child.childId)
      if (agent !== undefined) {
        children.push(agent)
        resolveChildStarted(agent)
      }
    })
    ctx.on('workflow/agent-end', (_run, child) => { outcomes.push(child.outcome) })
    const controller = new AbortController()
    const pending = executeToolFixture(ctx, {
      callId: brandString<ToolCallId>('ralph-real-cancel'),
      name: 'ralph',
      arguments: { objective: 'Keep working until cancelled.', maxRounds: 2 },
      agent: parent,
      signal: controller.signal,
    })
    try {
      await Promise.race([
        childStarted,
        pending.then((result) => { throw new Error(`Ralph settled before its child started: ${JSON.stringify(result.content)}`) }),
      ])
      controller.abort()
      const result = await pending
      expect(result.isError).toBe(true)
      expect((result.content[0] as { text: string }).text).toContain('Ralph workflow was cancelled')
      expect(result.isError && result.error.info).toEqual({ name: 'AbortError', code: 'ABORTED' })
      expect(outcomes).toEqual(['cancelled'])
      expect(ctx.agents.get(children[0]!.id)).toBeUndefined()
    } finally {
      controller.abort()
      await pending
      await parentHandle.dispose()
    }
  })
})
