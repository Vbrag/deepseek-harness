/** Real-loop todo continuation, persistent progress accounting, and asynchronous stop fences. */

import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Group from '@deepseek-ai/cordis-plugin-group'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import GoalService from '@deepseek-ai/dsh-goal'
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import { createUserMessage, LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as ToolTodo from '@deepseek-ai/dsh-tool-todo'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import * as driver from '../src/index.ts'

class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  constructor(private readonly script: StreamChunk[][]) { super() }
  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const chunks = this.script.shift()
    if (chunks === undefined) throw new Error('ScriptedAdapter: script exhausted')
    for (const chunk of chunks) yield chunk
  }
}

function text(text: string, kind: 'stop' | 'max-tokens' = 'stop'): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind } },
  ]
}

let callCounter = 0
function call(name: string, args: object): StreamChunk[] {
  const id = ToolCallId(`todo-call-${++callCounter}`)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: JSON.stringify(args) } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

function write(todos: TodoItem[], options: {
  purpose?: 'current-task' | 'proposal'
  disposition?: 'active' | 'paused' | 'waiting'
  reason?: string
} = {}): StreamChunk[] {
  return call('todo_write', { todos, ...options })
}

interface Capture { readonly reason: string; readonly todos?: TodoItem[]; readonly signal?: AbortSignal }
const contexts: Context[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function harness(script: StreamChunk[][], options: { isolated?: boolean; planActive?: boolean } = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  vi.spyOn(ctx.sessions, 'flush').mockResolvedValue(true)
  await ctx.plugin(GoalService)
  if (options.isolated) {
    await ctx.plugin(Loader)
    ctx.loader.builtins.group = Group
    const unsupported = (): never => { throw new Error('This preset fixture does not use HMR operations') }
    ctx.loader.internal = {
      version: 'v2', loadCache: new Map(), register: unsupported, getOrCreateModuleJob: unsupported,
      resolveSync: unsupported, load: unsupported,
      async import(specifier: string) {
        if (specifier === 'fixture:todo') return ToolTodo
        if (specifier === 'fixture:plan') return { apply(inner: Context) {
          inner.provide('planMode', { get: () => ({ active: options.planActive === true }) })
        } }
        throw new Error(`Unexpected preset import: ${specifier}`)
      },
    }
    await ctx.plugin(AgentPresets, { default: 'task' })
    await ctx.agentPresets.register({ id: 'task', plugins: [{ name: 'cordis:group', group: true,
      isolate: { todoPolicy: true, planMode: true }, config: [
        { name: 'fixture:todo', config: { allowParallelInProgress: true } }, { name: 'fixture:plan' },
      ] }] })
  } else {
    await ctx.plugin(ToolTodo, { allowParallelInProgress: true })
  }
  const captures: Capture[] = []
  const recoverTodos = vi.fn(async (_agent: Agent, _signal?: AbortSignal) => false)
  ctx.provide('workHandoffs', {
    capture: (_agent: Agent, request: Capture) => { captures.push(request); return Promise.resolve() },
    viewOf: () => null,
    recoverTodos,
  })
  const fiber = await ctx.plugin(driver, { maxNoProgressRepairs: 3 })
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new ScriptedAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = options.isolated ? (await ctx.agents.create({
    sessionId: SessionId('todo-continuation'), meta: { agentPreset: 'task' },
    agentOptions: { provider: 'mock', model: 'mock' },
    setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, 'task') },
  })).agent : await ctx.agentLoop.create(SessionId('todo-continuation'), { provider: 'mock', model: 'mock' })
  function run() {
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'execute the authorized task' }],
      source: { kind: 'user' } }))
    return agent.whenIdle()
  }
  return { ctx, agent, adapter, captures, recoverTodos, fiber, run }
}

const six: TodoItem[] = Array.from({ length: 6 }, (_, index) => ({
  content: `step ${index + 1}`, status: index === 0 ? 'in_progress' : 'pending',
}))
const finished = (todos: TodoItem[]): TodoItem[] => todos.map(todo => ({ ...todo, status: 'completed' }))
function repairs(agent: Agent) {
  return agent.session.snapshotEvents().filter(event => event.type === 'user/message'
    && event.data.source.kind === 'todo-reconcile')
}

it('continues the same turn after a promise-only final response with six unfinished todos and no goal', async () => {
  const test = await harness([
    write(six, { purpose: 'current-task' }), text('I will read the relevant lines now.'),
    write(finished(six)), text('Implemented and verified.'),
  ])
  await test.run()
  expect(test.ctx.goals.get(test.agent)).toBeUndefined()
  expect(test.adapter.requests).toHaveLength(4)
  expect(repairs(test.agent)).toHaveLength(1)
  expect(JSON.stringify(test.adapter.requests[2]?.messages)).toContain('<todo_continue>')
  expect(test.agent.session.snapshotEvents().filter(event => event.type === 'turn/start')).toHaveLength(1)
  expect(test.agent.session.snapshotEvents().filter(event => event.type === 'turn/end')).toHaveLength(1)
  expect(test.captures).toHaveLength(0)
})

it('routes continuation through a real isolated preset policy without requiring a global provider', async () => {
  const test = await harness([write(six, { purpose: 'current-task' }), text('Will work'),
    write(finished(six)), text('Done')], { isolated: true })
  expect(test.ctx.get('todoPolicy')).toBeUndefined()
  expect(test.agent.ctx.get('todoPolicy')).toBeUndefined()
  const owner = test.ctx.agentPresets.serviceFor(test.agent, 'todoPolicy')
  expect(owner).toBeDefined()
  await test.run()
  expect(test.adapter.requests).toHaveLength(4)
  expect(repairs(test.agent)).toHaveLength(1)
  expect(owner?.listOf(test.agent.session).every(todo => todo.status === 'completed')).toBe(true)
})

it('respects plan mode supplied inside the same real isolated preset', async () => {
  const test = await harness([write(six, { purpose: 'current-task' }), text('Plan awaiting approval')],
    { isolated: true, planActive: true })
  expect(test.ctx.get('planMode')).toBeUndefined()
  expect(test.agent.ctx.get('planMode')).toBeUndefined()
  await test.run()
  expect(test.adapter.requests).toHaveLength(2)
  expect(repairs(test.agent)).toHaveLength(0)
  expect(test.ctx.agentPresets.serviceFor(test.agent, 'todoPolicy')?.viewOf(test.agent.session)?.disposition).toBe('paused')
  expect(test.captures[0]?.reason).toBe('paused')
})

it('continues beyond three promise-only responses and strengthens the logged recovery guidance without stopping', async () => {
  const test = await harness([write(six, { purpose: 'current-task' }),
    text('Will work'), text('Will work again'), text('Still planning'), text('Next I will implement'),
    text('I will inspect the failure now'), write(finished(six)), text('Implemented and verified')])
  await test.run()
  expect(test.adapter.requests).toHaveLength(8)
  expect(repairs(test.agent)).toHaveLength(5)
  expect(JSON.stringify(test.adapter.requests[2]?.messages)).not.toContain('Repeated responses have not increased verified completion')
  expect(JSON.stringify(test.adapter.requests[4]?.messages)).toContain('Repeated responses have not increased verified completion')
  expect(test.ctx.todoPolicy.viewOf(test.agent.session)).toMatchObject({ disposition: 'active', repairAttempts: 0,
    completedHighWater: 6 })
  expect(test.agent.session.snapshotEvents().filter(event => event.type === 'turn/start')).toHaveLength(1)
  expect(test.agent.session.snapshotEvents().filter(event => event.type === 'todo/policy')
    .some(event => event.data.disposition === 'limit')).toBe(false)
  expect(test.agent.session.snapshotEvents().filter(event => event.type === 'todo/policy')
    .map(event => event.data.repairAttempts)).toEqual([0, 1, 2, 3, 4, 5])
  expect(test.captures).toHaveLength(0)
  const end = test.agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')
  expect(end?.data.reason.kind).toBe('completed')
})

it('resets the repair counter only after net completed work increases', async () => {
  const first = six.map((todo, index) => index === 0 ? { ...todo, status: 'completed' as const } : todo)
  const test = await harness([write(six, { purpose: 'current-task' }), text('Will start'),
    write(first), text('Next step'), write(finished(six)), text('Done')])
  await test.run()
  expect(repairs(test.agent)).toHaveLength(2)
  expect(test.ctx.todoPolicy.viewOf(test.agent.session)).toMatchObject({ completedHighWater: 6, repairAttempts: 0 })
  expect(test.captures).toHaveLength(0)
})

it('continues an old limited task during a normal turn without granting a fresh repair count', async () => {
  const test = await harness([text('I will implement the next item'), write(finished(six)), text('Done')])
  test.ctx.todoPolicy.writeList(test.agent, six, 'current-task')
  for (let attempt = 0; attempt < 3; attempt++) test.ctx.todoPolicy.recordRepair(test.agent)
  test.ctx.todoPolicy.markLimit(test.agent)
  await test.run()
  expect(test.adapter.requests).toHaveLength(3)
  expect(repairs(test.agent)).toHaveLength(1)
  expect(test.agent.session.snapshotEvents().filter(event => event.type === 'todo/policy')
    .map(event => [event.data.disposition, event.data.repairAttempts])).toEqual([
    ['active', 0], ['active', 1], ['active', 2], ['active', 3], ['limit', 3], ['active', 3], ['active', 4],
  ])
  expect(test.captures).toHaveLength(0)
})

it('leaves a proposal unfinished without driving execution', async () => {
  const test = await harness([write(six, { purpose: 'proposal' }), text('Here is the proposed plan.')])
  await test.run()
  expect(test.adapter.requests).toHaveLength(2)
  expect(repairs(test.agent)).toHaveLength(0)
  expect(test.captures).toHaveLength(0)
})

it('leaves an active project-document phase to its owner without injecting ordinary task repairs', async () => {
  const test = await harness([text('Project documentation assessment in progress')])
  test.ctx.todoPolicy.writeList(test.agent, six, 'current-task')
  test.ctx.provide('projectContext', { activeOf: () => true })
  await test.run()
  expect(repairs(test.agent)).toHaveLength(0)
  expect(test.captures).toHaveLength(0)
  expect(test.ctx.todoPolicy.viewOf(test.agent.session)).toMatchObject({ disposition: 'active', repairAttempts: 0 })
})

it('offers one confirmation for a legacy list and authorizes it only through human Continue', async () => {
  const test = await harness([write(finished(six)), text('Done')])
  test.agent.session.append('todo/write', { todos: six })
  await agentEvents(test.ctx, test.agent).serial('agent/created', { source: 'resume' })
  await vi.waitFor(() => { expect(test.captures).toHaveLength(1) })
  expect(test.adapter.requests).toHaveLength(0)
  expect(test.captures).toHaveLength(1)
  expect(test.captures[0]?.reason).toBe('legacy-confirmation')
  await test.ctx.todoPolicy.continueTask(test.agent)
  await test.run()
  expect(test.adapter.requests).toHaveLength(2)
  expect(test.ctx.todoPolicy.viewOf(test.agent.session)?.purpose).toBe('current-task')
})

it.each(['paused', 'waiting'] as const)('retains explicit %s instead of restarting work', async (disposition) => {
  const test = await harness([write(six, { purpose: 'current-task', disposition, reason: 'User requested this stop' }),
    text('Waiting as requested.')])
  await test.run()
  expect(test.adapter.requests).toHaveLength(2)
  expect(repairs(test.agent)).toHaveLength(0)
  expect(test.captures[0]?.reason).toBe(disposition)
})

it.each(['active', 'paused', 'blocked'] as const)('defers to an existing %s goal', async (phase) => {
  const test = await harness([text('Goal state owns continuation')])
  test.ctx.todoPolicy.writeList(test.agent, six, 'current-task')
  const goal = test.ctx.goals.create(test.agent, { objective: 'existing objective' })
  if (phase === 'paused') test.ctx.goals.pause(test.agent, goal)
  if (phase === 'blocked') test.ctx.goals.block(test.agent, goal, { code: 'needs-input', message: 'Input required' })
  await agentEvents(test.ctx, test.agent).serial('agent/created', { source: 'resume' })
  expect(test.recoverTodos).not.toHaveBeenCalled()
  await test.run()
  expect(test.adapter.requests).toHaveLength(1)
  expect(repairs(test.agent)).toHaveLength(0)
})

it('leaves output-limit handoffs to the terminal execution owner without repair', async () => {
  const test = await harness([text('truncated', 'max-tokens')])
  test.ctx.todoPolicy.writeList(test.agent, six, 'current-task')
  await test.run()
  expect(test.adapter.requests).toHaveLength(1)
  expect(repairs(test.agent)).toHaveLength(0)
  expect(test.captures).toHaveLength(0)
})

it('saves a paused handoff when a real tool concludes an unfinished task without continuing', async () => {
  const test = await harness([call('wait_for_user', {})])
  test.ctx.todoPolicy.writeList(test.agent, six, 'current-task')
  test.ctx.tools.register(defineContentToolFixture({
    name: 'wait_for_user', description: 'Wait for explicit user action', parameters: {},
    execute: (_args, exec) => { exec.concludeTurn(); return Promise.resolve([]) },
  }))
  await test.run()
  expect(test.adapter.requests).toHaveLength(1)
  expect(repairs(test.agent)).toHaveLength(0)
  expect(test.ctx.todoPolicy.viewOf(test.agent.session)?.disposition).toBe('paused')
  expect(test.captures).toHaveLength(1)
  expect(test.captures[0]?.reason).toBe('paused')
})

it.each(['paused', 'waiting'] as const)('repairs a missing handoff for recovered %s work without a model call',
  async (disposition) => {
    const test = await harness([])
    test.ctx.todoPolicy.writeList(test.agent, six, 'current-task')
    await test.ctx.todoPolicy.suspend(test.agent, disposition, 'Saved stop')
    await agentEvents(test.ctx, test.agent).serial('agent/created', { source: 'resume' })
    await vi.waitFor(() => { expect(test.captures).toHaveLength(1) })
    expect(test.adapter.requests).toHaveLength(0)
    expect(test.captures).toHaveLength(1)
    expect(test.captures[0]?.reason).toBe(disposition)
    expect(test.recoverTodos).not.toHaveBeenCalled()
  })

it.each(['active', 'limit'] as const)('delegates recovered %s work once without resetting repair progress', async (disposition) => {
  const test = await harness([])
  test.ctx.todoPolicy.writeList(test.agent, six, 'current-task')
  for (let attempt = 0; attempt < 4; attempt++) test.ctx.todoPolicy.recordRepair(test.agent)
  if (disposition === 'limit') test.ctx.todoPolicy.markLimit(test.agent)
  await Promise.all([
    agentEvents(test.ctx, test.agent).serial('agent/created', { source: 'resume' }),
    agentEvents(test.ctx, test.agent).serial('agent/created', { source: 'startup' }),
  ])
  await vi.waitFor(() => { expect(test.recoverTodos).toHaveBeenCalledTimes(1) })
  expect(test.recoverTodos).toHaveBeenCalledWith(test.agent, expect.any(AbortSignal))
  expect(test.ctx.todoPolicy.viewOf(test.agent.session)).toMatchObject({ disposition, repairAttempts: 4,
    completedHighWater: 0 })
  expect(test.captures).toHaveLength(0)
})

it('recovers authorized work already registered when the driver is activated', async () => {
  const test = await harness([])
  await test.fiber.dispose()
  test.ctx.todoPolicy.writeList(test.agent, six, 'current-task')
  await test.ctx.plugin(driver, { maxNoProgressRepairs: 3 })
  await vi.waitFor(() => { expect(test.recoverTodos).toHaveBeenCalledTimes(1) })
  expect(test.captures).toHaveLength(0)
})

it('does not recover startup work after its creation is cancelled while waiting for admission', async () => {
  const test = await harness([])
  test.ctx.todoPolicy.writeList(test.agent, six, 'current-task')
  const release = Promise.withResolvers<undefined>()
  vi.spyOn(test.agent, 'whenIdle').mockReturnValueOnce(release.promise)
  const abort = new AbortController()
  await agentEvents(test.ctx, test.agent).serial('agent/created', { source: 'resume', signal: abort.signal })
  abort.abort()
  await test.fiber.dispose()
  release.resolve(undefined)
  expect(test.recoverTodos).not.toHaveBeenCalled()
  expect(test.captures).toHaveLength(0)
})

it('waits for plan approval instead of repairing an execution list while plan mode is active', async () => {
  const test = await harness([text('Plan awaiting approval')])
  test.ctx.todoPolicy.writeList(test.agent, six, 'current-task')
  test.ctx.provide('planMode', { get: () => ({ active: true }) })
  await test.run()
  expect(test.adapter.requests).toHaveLength(1)
  expect(repairs(test.agent)).toHaveLength(0)
  expect(test.captures[0]?.reason).toBe('paused')
})

it('honors user cancellation while the durability checkpoint is pending', async () => {
  const test = await harness([text('Will start')])
  test.ctx.todoPolicy.writeList(test.agent, six, 'current-task')
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<boolean>()
  vi.spyOn(test.ctx.sessions, 'flush').mockImplementationOnce(() => { entered.resolve(undefined); return release.promise })
  const idle = test.run()
  await entered.promise
  test.agent.cancel({ kind: 'user' })
  await idle
  release.resolve(false)
  expect(test.adapter.requests).toHaveLength(1)
  expect(repairs(test.agent)).toHaveLength(0)
})

it('refuses to repair when no durable checkpoint provider acknowledges the Session', async () => {
  const test = await harness([text('Will start')])
  test.ctx.todoPolicy.writeList(test.agent, six, 'current-task')
  const errors: unknown[] = []
  test.ctx.on('agent/error', ({ error }) => { errors.push(error) })
  vi.spyOn(test.ctx.sessions, 'flush').mockResolvedValueOnce(false)
  await test.run()
  expect(test.adapter.requests).toHaveLength(1)
  expect(repairs(test.agent)).toHaveLength(0)
  expect(test.ctx.todoPolicy.viewOf(test.agent.session)).toMatchObject({ disposition: 'paused', repairAttempts: 0 })
  const end = test.agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')
  expect(end?.data.reason.kind).toBe('error')
  expect(errors[0]).toMatchObject({ code: 'TODO_DURABILITY_REQUIRED' })
})

it('refreshes the list after waiting for descendants and does not steer completed work', async () => {
  const test = await harness([text('Will start')])
  test.ctx.todoPolicy.writeList(test.agent, six, 'current-task')
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<boolean>()
  test.ctx.provide('subagents', { waitForTreeWork: () => { entered.resolve(undefined); return release.promise } })
  const idle = test.run()
  await entered.promise
  test.ctx.todoPolicy.writeList(test.agent, finished(six))
  release.resolve(false)
  await idle
  expect(repairs(test.agent)).toHaveLength(0)
  expect(test.captures).toHaveLength(0)
})

it('unloads while descendants are running without leaving automatic work behind', async () => {
  const test = await harness([text('Will start')])
  test.ctx.todoPolicy.writeList(test.agent, six, 'current-task')
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<boolean>()
  test.ctx.provide('subagents', { waitForTreeWork: () => { entered.resolve(undefined); return release.promise } })
  const idle = test.run()
  await entered.promise
  await test.fiber.dispose()
  release.resolve(false)
  await idle
  expect(repairs(test.agent)).toHaveLength(0)
  expect(test.captures).toHaveLength(0)
})
