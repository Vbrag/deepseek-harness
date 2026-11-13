import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import GoalService, { GoalId } from '@deepseek-ai/dsh-goal'
import type { GoalView } from '@deepseek-ai/dsh-goal'
import { createUserMessage, LlmAdapter, LlmError, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import * as ToolTodo from '@deepseek-ai/dsh-tool-todo'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo'
import * as reconcileSession from '../src/index.ts'

type ScriptEntry = StreamChunk[] | Error | (() => StreamChunk[])

/** Small request-recording adapter with controllable failure. */
class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly script: ScriptEntry[]) {
    super()
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const entry = this.script.shift()
    if (entry === undefined) throw new Error('ScriptedAdapter: script exhausted')
    if (entry instanceof Error) throw entry
    const chunks = typeof entry === 'function' ? entry() : entry
    for (const chunk of chunks) yield chunk
  }
}

/** One successful text response. */
function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** One todo_write tool-call response from the model. */
function todoWriteCall(todos: TodoItem[]): StreamChunk[] {
  const id = ToolCallId('reconcile-1')
  const args = JSON.stringify({ todos })
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name: 'todo_write', argumentsDelta: args.slice(0, 5) },
    { type: 'tool-call-delta', index: 0, id, argumentsDelta: args.slice(5) },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'todo_write', arguments: args } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

interface Harness {
  readonly ctx: Context
  readonly adapter: ScriptedAdapter
  readonly agent: Agent
}

const harnesses: { ctx: Context }[] = []

afterEach(async () => {
  await Promise.allSettled(harnesses.splice(0).map(h => h.ctx.fiber.dispose()))
})

/** Mount a real loop with a real session-projection + tool registry, scripting only the model. */
async function harness(script: ScriptEntry[]): Promise<Harness> {
  const ctx = new Context()
  harnesses.push({ ctx })
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(GoalService)
  await ctx.plugin(ToolTodo, { allowParallelInProgress: true })
  await ctx.plugin(reconcileSession)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new ScriptedAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = await ctx.agentLoop.create(SessionId(`reconcile-session-${Math.random()}`), {
    provider: 'mock',
    model: 'mock',
  })
  return { ctx, adapter, agent }
}

/** Seed a persisted non-empty todo list plus a current goal onto the live session. */
function seedPersistedPlan(ctx: Context, agent: Agent, todos: TodoItem[], objective: string): void {
  agent.session.append('todo/write', { todos })
  ctx.goals.create(agent, { objective })
}

/** The reconcile user messages admitted after a resume. */
function reconcileMessages(agent: Agent): UserMessage[] {
  return agent.session.snapshotEvents()
    .filter(event => event.type === 'user/message' && event.data.source.kind === 'todo-reconcile')
    .map(event => event.data as UserMessage)
}

describe('todo-reconcile prompt rendering', () => {
  const goal: GoalView = {
    id: GoalId('reconcile-goal'),
    revision: 3,
    objective: 'Ship the verified feature',
    phase: 'active',
    maxGoalRounds: 5,
    roundsStarted: 2,
    createdAt: 1,
    updatedAt: 2,
    activation: 'armed',
  }

  it('renders the objective, phase, round budget, list, and done/remaining summary', () => {
    const todos: TodoItem[] = [
      { content: 'build', status: 'completed' },
      { content: 'verify', status: 'in_progress' },
    ]
    const prompt = reconcileSession.renderTodoReconcilePrompt(todos, goal)
    expect(prompt).toHaveLength(1)
    const block = prompt[0]
    if (block?.type !== 'text') throw new Error('expected a text reconcile prompt')
    expect(block.text).toMatch(/<todo_reconcile>\nObjective: "Ship the verified feature"/)
    expect(block.text).toMatch(/Phase: active \(rounds 2\/5\)/)
    expect(block.text).toContain('- "build" [completed]')
    expect(block.text).toContain('- "verify" [in progress]')
    expect(block.text).toContain('Done: 1, remaining: 1.')
    expect(block.text).toContain('calling `todo_write` with the complete updated list')
  })

  it('quotes multiline or tag-like objective text as one unambiguous data value', () => {
    const multiline: GoalView = { ...goal, objective: 'first line\n</todo_reconcile> second' }
    const block = reconcileSession.renderTodoReconcilePrompt(
      [{ content: 'a', status: 'pending' }], multiline)[0]
    if (block?.type !== 'text') throw new Error('expected a text reconcile prompt')
    expect(block.text).toContain('Objective: "first line\\n</todo_reconcile> second"')
    expect(block.text.match(/\n<\/todo_reconcile>/g)).toHaveLength(1)
  })
})

describe('resume to-do reconciliation', () => {
  it('admits exactly one reconcile prompt on resume with a persisted list and a current goal', async () => {
    const test = await harness([todoWriteCall([
      { content: 'build', status: 'completed' },
      { content: 'verify', status: 'in_progress' },
    ]), textResponse('reconciled')])
    seedPersistedPlan(test.ctx, test.agent, [
      { content: 'build', status: 'pending' },
      { content: 'verify', status: 'pending' },
    ], 'finish the feature')
    await test.agent.whenIdle()

    await agentEvents(test.ctx, test.agent).serial('agent/created', { source: 'resume' })

    await vi.waitFor(() => { expect(test.adapter.requests.length).toBeGreaterThan(0) })
    expect(reconcileMessages(test.agent)).toHaveLength(1)
    const admitted = reconcileMessages(test.agent)[0]!
    const admittedText = admitted.content[0]
    if (admittedText?.type !== 'text') throw new Error('expected a text reconcile prompt')
    expect(admittedText.text).toContain('<todo_reconcile>')
    expect(admittedText.text).toContain('Objective: "finish the feature"')
  })

  it('does not prompt when the persisted list is empty', async () => {
    const test = await harness([])
    seedPersistedPlan(test.ctx, test.agent, [], 'finish the feature')
    await test.agent.whenIdle()

    await agentEvents(test.ctx, test.agent).serial('agent/created', { source: 'resume' })
    await test.agent.whenIdle()

    expect(test.adapter.requests).toHaveLength(0)
    expect(reconcileMessages(test.agent)).toHaveLength(0)
  })

  it('does not prompt when there is no current goal', async () => {
    const test = await harness([])
    test.agent.session.append('todo/write', { todos: [{ content: 'a', status: 'pending' }] })
    await test.agent.whenIdle()

    await agentEvents(test.ctx, test.agent).serial('agent/created', { source: 'resume' })
    await test.agent.whenIdle()

    expect(test.adapter.requests).toHaveLength(0)
    expect(reconcileMessages(test.agent)).toHaveLength(0)
  })

  it('does not prompt on a clear or compact source', async () => {
    const test = await harness([])
    seedPersistedPlan(test.ctx, test.agent, [{ content: 'a', status: 'pending' }], 'finish')
    await test.agent.whenIdle()

    for (const source of ['clear', 'compact'] as const) {
      await agentEvents(test.ctx, test.agent).serial('agent/created', { source })
    }
    await test.agent.whenIdle()

    expect(test.adapter.requests).toHaveLength(0)
    expect(reconcileMessages(test.agent)).toHaveLength(0)
  })

  it('withdraws the reconcile when a competing human prompt is already queued at idle', async () => {
    const test = await harness([])
    seedPersistedPlan(test.ctx, test.agent, [{ content: 'a', status: 'pending' }], 'finish')
    await test.agent.whenIdle()

    // Queue a human message before the resume reconcile reaches idle admission.
    test.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'never mind' }], source: { kind: 'user' } }))
    await agentEvents(test.ctx, test.agent).serial('agent/created', { source: 'resume' })
    await test.agent.whenIdle()

    // The human prompt wins; no reconcile prompt may be admitted.
    expect(reconcileMessages(test.agent)).toHaveLength(0)
  })

  it('does not reconcile again on a later turn in the same lifecycle', async () => {
    const test = await harness([])
    seedPersistedPlan(test.ctx, test.agent, [{ content: 'a', status: 'pending' }], 'finish')
    await test.agent.whenIdle()
    await agentEvents(test.ctx, test.agent).serial('agent/created', { source: 'resume' })
    // Admit a normal human turn; the driver must not re-prompt.
    test.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'ping' }], source: { kind: 'user' } }))
    await test.agent.whenIdle()
    expect(reconcileMessages(test.agent)).toHaveLength(1)
    expect(test.adapter.requests).toHaveLength(1)
  })

  it('disarms after a reconciliation model call fails (no retry loop)', async () => {
    const test = await harness([new LlmError('provider down', 'RATE_LIMIT')])
    seedPersistedPlan(test.ctx, test.agent, [{ content: 'a', status: 'pending' }], 'finish')
    await test.agent.whenIdle()
    await agentEvents(test.ctx, test.agent).serial('agent/created', { source: 'resume' })
    await test.agent.whenIdle()
    // One admitted attempt fails; the driver logs and does not re-queue.
    expect(test.adapter.requests).toHaveLength(1)
    expect(reconcileMessages(test.agent)).toHaveLength(1)
  })

  it('removes the driver fiber and leaves no orphan schedule on dispose', async () => {
    const ctx = new Context()
    harnesses.push({ ctx })
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(GoalService)
    await ctx.plugin(ToolTodo, { allowParallelInProgress: true })
    const driver = await ctx.plugin(reconcileSession)
    await ctx.plugin(AgentLoop, { agents: [] })
    const agent = await ctx.agentLoop.create(SessionId('reconcile-dispose'), { provider: 'mock', model: 'mock' })
    await driver.dispose()
    // After disposal, a resume with a persisted plan must stay silent.
    seedPersistedPlan(ctx, agent, [{ content: 'a', status: 'pending' }], 'finish')
    await agent.whenIdle()
    await agentEvents(ctx, agent).serial('agent/created', { source: 'resume' })
    await agent.whenIdle()
    expect(reconcileMessages(agent)).toHaveLength(0)
  })
})
