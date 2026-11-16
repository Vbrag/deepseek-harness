/** Classification and repair accounting survive replay without turning old lists into execution authority. */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it } from 'vitest'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import * as Todo from '../src/index.ts'

const contexts: Context[] = []
afterEach(async () => { await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

async function fixture() {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(Todo, { allowParallelInProgress: true })
  await ctx.plugin(AgentLoop, { agents: [] })
  const agent = await ctx.agentLoop.create(SessionId('todo-policy'), { provider: 'mock', model: 'mock' })
  const write = (args: unknown) => executeToolFixture(ctx, {
    agent, name: 'todo_write', callId: ToolCallId('write-policy'),
    signal: new AbortController().signal, arguments: args,
  })
  return { ctx, agent, write }
}

it('requires a new-list purpose and keeps proposals separate from current execution', async () => {
  const { ctx, agent, write } = await fixture()
  const todos = [{ content: 'implement', status: 'pending' }]
  const missing = await write({ todos })
  expect(missing.isError).toBe(true)
  expect(missing).toMatchObject({ error: { info: { code: 'INVALID_ARGS' } } })
  expect(agent.session.snapshotEvents().some(event => event.type === 'todo/write')).toBe(false)
  const written = await write({ purpose: 'proposal', todos })
  expect(written.error).toBeUndefined()
  expect(ctx.todoPolicy.viewOf(agent.session)?.purpose).toBe('proposal')
  expect((await write({ purpose: 'current-task', todos })).isError).toBe(true)
})

it('keeps legacy lists unclassified until explicit human continuation', async () => {
  const { ctx, agent, write } = await fixture()
  const todos = [{ content: 'implement', status: 'pending' as const }]
  agent.session.append('todo/write', { todos })
  expect(ctx.todoPolicy.viewOf(agent.session)?.purpose).toBe('legacy')
  expect((await write({ purpose: 'current-task', todos })).isError).toBe(true)
  expect((await write({ todos })).isError).toBe(false)
  await ctx.todoPolicy.continueTask(agent)
  expect(ctx.todoPolicy.viewOf(agent.session)?.purpose).toBe('current-task')
})

it('preserves a real fork list without inheriting parent execution authority or repair limits', async () => {
  const { ctx, agent, write } = await fixture()
  const parentTodos = [{ content: 'Parent task', status: 'pending' as const }]
  await write({ purpose: 'current-task', todos: parentTodos })
  ctx.todoPolicy.recordRepair(agent)
  ctx.todoPolicy.markLimit(agent)
  const fork = ctx.sessions.fork(agent.session, undefined, SessionId('fork-prefix'))
  expect(fork.inheritedEventCount).toBeGreaterThan(0)
  expect(ctx.todoPolicy.listOf(fork)).toEqual(parentTodos)
  expect(ctx.todoPolicy.viewOf(fork)).toBeUndefined()
  const child = (await ctx.agents.create({
    sessionId: SessionId('fork-worker'), seed: fork.snapshotEvents(),
    inheritedEventCount: fork.inheritedEventCount, meta: { isSeeded: true },
    agentOptions: { provider: 'mock', model: 'mock' },
  })).agent
  const result = await executeToolFixture(ctx, {
    agent: child, name: 'todo_write', callId: ToolCallId('fork-own-task'),
    signal: new AbortController().signal,
    arguments: { purpose: 'current-task', todos: [{ content: 'Delegated child task', status: 'pending' }] },
  })
  expect(result.isError).toBe(false)
  expect(ctx.todoPolicy.viewOf(child.session)).toMatchObject({
    purpose: 'current-task', disposition: 'active', repairAttempts: 0, completedHighWater: 0,
  })
  expect(ctx.todoPolicy.viewOf(agent.session)).toMatchObject({ disposition: 'limit', repairAttempts: 1 })
  const restored = Session.create(SessionId('fork-restored'), child.session.snapshotEvents(),
    { ...child.session.header, id: SessionId('fork-restored') }, child.session.inheritedEventCount)
  expect(ctx.todoPolicy.viewOf(restored)).toEqual(ctx.todoPolicy.viewOf(child.session))
})

it('resets repairs only at a strictly greater completed count or explicit human continuation', async () => {
  const { ctx, agent, write } = await fixture()
  await write({ purpose: 'current-task', todos: [{ content: 'first', status: 'pending' }] })
  ctx.todoPolicy.recordRepair(agent)
  await write({ todos: [{ content: 'first', status: 'completed' }] })
  expect(ctx.todoPolicy.viewOf(agent.session)).toMatchObject({ completedHighWater: 1, repairAttempts: 0 })
  ctx.todoPolicy.recordRepair(agent)
  await write({ todos: [{ content: 'first', status: 'pending' }] })
  await write({ todos: [{ content: 'first', status: 'completed' }, { content: 'extra', status: 'pending' }] })
  expect(ctx.todoPolicy.viewOf(agent.session)).toMatchObject({ completedHighWater: 1, repairAttempts: 1 })
  ctx.todoPolicy.markLimit(agent)
  expect((await write({ disposition: 'active', todos: [{ content: 'first', status: 'pending' }] })).isError).toBe(true)
  await write({ todos: [] })
  expect((await write({ purpose: 'current-task', disposition: 'active',
    todos: [{ content: 'first', status: 'pending' }] })).isError).toBe(true)
  await write({ purpose: 'current-task', todos: [{ content: 'first', status: 'pending' }] })
  expect(ctx.todoPolicy.viewOf(agent.session)).toMatchObject({ disposition: 'limit', repairAttempts: 1 })
  await ctx.todoPolicy.continueTask(agent)
  expect(ctx.todoPolicy.viewOf(agent.session)).toMatchObject({ disposition: 'active', repairAttempts: 0 })
})

it('recovers an authorized old limit without resetting repairs or completed high-water accounting', async () => {
  const { ctx, agent } = await fixture()
  ctx.todoPolicy.writeList(agent, [
    { content: 'done', status: 'completed' }, { content: 'unfinished', status: 'pending' },
  ], 'current-task')
  ctx.todoPolicy.recordRepair(agent)
  ctx.todoPolicy.recordRepair(agent)
  ctx.todoPolicy.markLimit(agent)
  expect(ctx.todoPolicy.recoverAuthorizedTask(agent)).toBe(true)
  expect(ctx.todoPolicy.viewOf(agent.session)).toMatchObject({
    purpose: 'current-task', disposition: 'active', repairAttempts: 2, completedHighWater: 1,
  })
  const seq = agent.session.seq
  expect(ctx.todoPolicy.recoverAuthorizedTask(agent)).toBe(true)
  expect(agent.session.seq).toBe(seq)
})

it.each(['proposal', 'legacy', 'paused', 'waiting', 'completed'] as const)(
  'does not grant recovery authority to %s lists', async (kind) => {
    const { ctx, agent } = await fixture()
    const todos = [{ content: 'task', status: kind === 'completed' ? 'completed' as const : 'pending' as const }]
    if (kind === 'legacy') agent.session.append('todo/write', { todos })
    else ctx.todoPolicy.writeList(agent, todos, kind === 'proposal' ? 'proposal' : 'current-task')
    if (kind === 'paused' || kind === 'waiting') await ctx.todoPolicy.suspend(agent, kind, 'Explicit stop')
    const before = ctx.todoPolicy.viewOf(agent.session)
    const seq = agent.session.seq
    expect(ctx.todoPolicy.recoverAuthorizedTask(agent)).toBe(false)
    expect(ctx.todoPolicy.viewOf(agent.session)).toEqual(before)
    expect(agent.session.seq).toBe(seq)
  })

it('replays declared policy events with the same limits and pause state', async () => {
  const { ctx, agent, write } = await fixture()
  await write({ purpose: 'current-task', todos: [{ content: 'first', status: 'pending' }] })
  ctx.todoPolicy.recordRepair(agent)
  await ctx.todoPolicy.suspend(agent, 'waiting', 'Required user input')
  const events = agent.session.snapshotEvents()
  expect(events.filter(event => event.type === 'todo/policy')).toHaveLength(3)
  const restored = Session.create(SessionId('todo-policy-restored'), events)
  const beforeRead = restored.seq
  expect(ctx.todoPolicy.viewOf(restored)).toEqual(ctx.todoPolicy.viewOf(agent.session))
  expect(restored.seq).toBe(beforeRead)
})

it('requires a concrete reason for model-requested suspension', async () => {
  const { agent, write } = await fixture()
  const failed = await write({ purpose: 'current-task', disposition: 'waiting',
    todos: [{ content: 'first', status: 'pending' }] })
  expect(failed.isError).toBe(true)
  expect(agent.session.snapshotEvents().some(event => event.type === 'todo/write')).toBe(false)
})

it.each(['aborted', 'error', 'max-tokens'] as const)('recovers %s suspension directly from the durable terminal event', async (kind) => {
  const { ctx, agent, write } = await fixture()
  await write({ purpose: 'current-task', todos: [{ content: 'first', status: 'pending' }] })
  ctx.todoPolicy.recordRepair(agent)
  const reason = kind === 'aborted' ? { kind, reason: { kind: 'user' as const } }
    : kind === 'error' ? { kind, error: { code: 'UNKNOWN', message: 'Tool failed' } } : { kind }
  agent.session.append('turn/end', { turn: 1, reason })
  expect(ctx.todoPolicy.viewOf(agent.session)).toMatchObject({ disposition: 'paused', repairAttempts: 1 })
  expect((await write({ disposition: 'active', todos: [{ content: 'first', status: 'pending' }] })).isError).toBe(true)
  const restored = Session.create(SessionId('todo-policy-terminal'), agent.session.snapshotEvents())
  expect(ctx.todoPolicy.viewOf(restored)).toEqual(ctx.todoPolicy.viewOf(agent.session))
})
