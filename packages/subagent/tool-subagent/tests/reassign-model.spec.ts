/** Reassignment uses normal tool admission without consuming delegation depth. */

import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { modelSelectionSetupAgent, setup, text } from './harness.ts'

const ASSESSMENT = { requiredCapabilities: ['coding'], preferredCapabilities: ['reasoning'], contextTokens: 4000 }
const ARGS = { task_assessment: ASSESSMENT, reason: 'Implementation phase', checkpoint: 'Design approved; implementation remains' }

async function fixture() {
  const ctx = await setup({ provider: 'mock', modelDiscovery: true, maxDepth: 0 })
  const agent = modelSelectionSetupAgent(ctx)
  const change = vi.spyOn(ctx.subagents, 'requestModelChange').mockImplementation(async request => ({ status: 'queued', target: request.target }))
  const call = (args: unknown, withAgent = true) => executeToolFixture(ctx, {
    name: 'reassign_subagent', callId: ToolCallId('reassign'), arguments: args,
    signal: new AbortController().signal, ...withAgent ? { agent } : {},
  })
  return { ctx, agent, change, call }
}

describe('reassign_subagent', () => {
  it('exposes self reassignment with a zero child-depth limit and forwards the complete phase request', async () => {
    const { ctx, agent, change, call } = await fixture()
    expect(ctx.tools.schemas(agent).find(tool => tool.name === 'reassign_subagent')).toBeDefined()
    const result = await call({ ...ARGS, preferred_route: { provider: 'models', model: 'coder' }, max_tokens: 8192 })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('Model change queued')
    expect(change.mock.calls[0]?.[0].caller).toBe(agent)
    expect(change.mock.calls[0]?.[0]).toMatchObject({ target: agent.id, taskAssessment: ASSESSMENT,
      reason: ARGS.reason, checkpoint: ARGS.checkpoint, preferredRoute: { provider: 'models', model: 'coder' },
      maxTokens: 8192, interruptCurrentRequest: false })
  })

  it('resolves a live Session id and retains explicit interruption intent', async () => {
    const { ctx, change, call } = await fixture()
    const { agent: child } = await ctx.agents.create({ sessionId: SessionId('target') })
    expect((await call({ ...ARGS, target: child.id, interrupt_current_request: true })).isError).toBe(false)
    expect(change.mock.calls[0]?.[0]).toMatchObject({ target: child.id, interruptCurrentRequest: true })
  })

  it.each([
    { ...ARGS, task_assessment: { ...ASSESSMENT, contextTokens: Number.MAX_SAFE_INTEGER + 1 } },
    { ...ARGS, task_assessment: { ...ASSESSMENT, outputTokens: 0 } },
    { ...ARGS, max_tokens: 0 },
    { ...ARGS, max_tokens: Number.MAX_SAFE_INTEGER + 1 },
    { ...ARGS, reason: ' ' },
    { ...ARGS, checkpoint: '' },
    { ...ARGS, preferred_route: { provider: '', model: 'coder' } },
    { ...ARGS, target: '' },
  ])('rejects malformed phase arguments before runtime admission: %j', async (args) => {
    const { change, call } = await fixture()
    const result = await call(args)
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('INVALID_ARGS')
    expect(change).not.toHaveBeenCalled()
  })

  it('requires an explicit task assessment without inventing task requirements', async () => {
    const { change, call } = await fixture()
    const result = await call({ reason: ARGS.reason, checkpoint: ARGS.checkpoint })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('task_assessment')
    expect(change).not.toHaveBeenCalled()
  })

  it('requires a calling Agent and remains absent without the shared discovery owner', async () => {
    const { change, call } = await fixture()
    expect((await call(ARGS, false)).isError).toBe(true)
    expect(change).not.toHaveBeenCalled()
    const ctx = await setup({ provider: 'mock' })
    expect(ctx.tools.get('reassign_subagent')).toBeUndefined()
  })
})
