/** Real-loop finalization admission, goal ownership, and interrupted-document handoffs. */

import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import GoalService from '@deepseek-ai/dsh-goal'
import { createUserMessage, LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as ToolTodo from '@deepseek-ai/dsh-tool-todo'
import type { WorkCaptureRequest } from '@deepseek-ai/dsh-work-handoff'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { installProjectContextDriver } from '../src/driver.ts'
import { createProjectContextProjection } from '../src/projection.ts'

const contexts: Context[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function response(text: string, kind: 'stop' | 'max-tokens' = 'stop'): StreamChunk[] {
  return [{ type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text } }, { type: 'finish', reason: { kind } }]
}

function update(): StreamChunk[] {
  return [{ type: 'block-start', index: 0, blockType: 'tool-call' }, { type: 'block-end', index: 0,
    block: { type: 'tool-call', id: ToolCallId('finish-docs'), name: 'finish_project_docs', arguments: '{}' } },
  { type: 'finish', reason: { kind: 'tool-calls' } }]
}

async function harness(script: StreamChunk[][], options: { depth?: number; toolStop?: boolean } = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  vi.spyOn(ctx.sessions, 'flush').mockResolvedValue(true)
  await ctx.plugin(GoalService)
  await ctx.plugin(ToolTodo, { allowParallelInProgress: true })
  const projection = await ctx.sessionProjections.register(createProjectContextProjection({
    maxTextChars: 1000, maxSourceBytes: 1000,
  }))
  const capture = vi.fn(async (_agent: Agent, _request: WorkCaptureRequest) => undefined)
  ctx.provide('workHandoffs', { capture })
  const prepare = vi.fn(async (agent: Agent, turn: number, signal: AbortSignal) => {
    signal.throwIfAborted()
    const view = projection.stateOf(agent.session).view
    if (view === null) throw new Error('No turn assessment was initialized')
    agent.session.append('project-context/status', { ...view, status: 'updating' })
    agent.steer(createUserMessage({ source: { kind: 'project-context', sourceTurn: turn },
      content: [{ type: 'text', text: 'Assess and update project documentation.' }] }))
    return true
  })
  const controller = {
    prepare,
    viewOf: (session: Agent['session']) => projection.stateOf(session).view,
    activeOf: (agent: Agent) => projection.stateOf(agent.session).view?.status === 'updating',
  }
  ctx.provide('projectContext', controller)
  const fiber = await ctx.plugin({ name: 'project-context-driver-fixture', inject: ['agents', 'sessions'],
    apply: (inner: Context) => { installProjectContextDriver(inner, controller) } })
  await ctx.plugin(AgentLoop, { agents: [] })
  const requests: GenerateOptions[] = []
  class Adapter extends LlmAdapter {
    override async * stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
      requests.push(request)
      const next = script.shift()
      if (next === undefined) throw new Error('The finalization script is exhausted')
      yield* next
    }
  }
  ctx.llm.registerAdapter(['project-context-test'], new Adapter())
  ctx.tools.register(defineContentToolFixture({ name: 'finish_project_docs', description: 'Complete the document assessment',
    parameters: {}, execute: (_args, exec) => {
      if (exec.agent === undefined) throw new Error('The finalization tool requires an Agent')
      if (!options.toolStop) {
        const view = projection.stateOf(exec.agent.session).view
        if (view === null) throw new Error('No document assessment is open')
        exec.agent.session.append('project-context/status', { ...view, status: 'updated', summary: 'Project facts updated.' })
      }
      exec.concludeTurn()
      return Promise.resolve([])
    } }))
  const agent = (await ctx.agents.create({ sessionId: SessionId('project-context-driver'),
    meta: { delegationDepth: options.depth ?? 0 }, agentOptions: { provider: 'project-context-test', model: 'test' } })).agent
  const run = async () => {
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Execute this task.' }] }))
    await agent.whenIdle()
  }
  return { ctx, agent, fiber, requests, projection, prepare, capture, run }
}

it('performs one same-turn assessment after ordinary work without a final extra model request', async () => {
  const test = await harness([response('Task complete'), update()])
  await test.run()
  expect(test.requests).toHaveLength(2)
  expect(test.prepare).toHaveBeenCalledTimes(1)
  expect(test.projection.stateOf(test.agent.session).view?.status).toBe('updated')
  expect(test.agent.session.snapshotEvents().filter(event => event.type === 'turn/start')).toHaveLength(1)
  expect(test.capture).not.toHaveBeenCalled()
})

it('keeps reminding an unfinished assessment beyond three responses without adding task turns', async () => {
  const test = await harness([response('Task complete'), ...Array.from({ length: 5 }, () => response('Will assess next')), update()])
  await test.run()
  expect(test.requests).toHaveLength(7)
  expect(test.prepare).toHaveBeenCalledTimes(6)
  expect(test.agent.session.snapshotEvents().filter(event => event.type === 'turn/start')).toHaveLength(1)
})

it('finalizes an ongoing goal round without spending another goal round', async () => {
  const test = await harness([response('Goal round work complete'), update()])
  const goal = test.ctx.goals.create(test.agent, { objective: 'Continue the larger goal', maxGoalRounds: 2 })
  await test.run()
  expect(test.ctx.goals.get(test.agent)).toMatchObject({ id: goal.id, phase: 'active', roundsStarted: 0, maxGoalRounds: 2 })
  expect(test.prepare).toHaveBeenCalledTimes(1)
  expect(test.agent.session.snapshotEvents().filter(event => event.type === 'turn/start')).toHaveLength(1)
})

it('leaves authorized unfinished ordinary todos to their execution owner', async () => {
  const test = await harness([response('I will implement next')])
  test.ctx.todoPolicy.writeList(test.agent, [{ content: 'Implement parser', status: 'pending' }], 'current-task')
  await test.run()
  expect(test.prepare).not.toHaveBeenCalled()
  expect(test.requests).toHaveLength(1)
})

it('does not start root documentation writes in a subagent', async () => {
  const test = await harness([response('Child report complete')], { depth: 1 })
  await test.run()
  expect(test.prepare).not.toHaveBeenCalled()
  expect(test.projection.stateOf(test.agent.session).view).toBeNull()
})

it('rechecks queued human input after waiting for descendants', async () => {
  const test = await harness([response('First work done'), response('New user work done'), update()])
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<boolean>()
  test.ctx.provide('subagents', { waitForTreeWork: () => { entered.resolve(undefined); return release.promise } })
  const run = test.run()
  await entered.promise
  test.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'New task takes priority' }] }))
  release.resolve(false)
  await run
  expect(test.prepare).toHaveBeenCalledTimes(1)
  expect(test.prepare.mock.calls[0]?.[1]).toBe(2)
  expect(test.requests).toHaveLength(3)
})

it('honors cancellation while descendants are still running without queuing maintenance', async () => {
  const test = await harness([response('Task done')])
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<boolean>()
  test.ctx.provide('subagents', { waitForTreeWork: () => { entered.resolve(undefined); return release.promise } })
  const run = test.run()
  await entered.promise
  test.agent.cancel({ kind: 'user' })
  await run
  release.resolve(false)
  await vi.waitFor(() => { expect(test.capture).toHaveBeenCalledTimes(1) })
  expect(test.prepare).not.toHaveBeenCalled()
  expect(test.capture.mock.calls[0]?.[0].id).toBe(test.agent.id)
  expect(test.capture.mock.calls[0]?.[1].reason).toBe('error')
  expect(test.capture.mock.calls[0]?.[1].stopDetail).toContain('Project documentation remains unfinished')
})

it('captures pending documentation after a tool concludes the turn even with no unfinished todos', async () => {
  const test = await harness([update()], { toolStop: true })
  await test.run()
  await vi.waitFor(() => { expect(test.capture).toHaveBeenCalledTimes(1) })
  expect(test.requests).toHaveLength(1)
  expect(test.prepare).not.toHaveBeenCalled()
  expect(test.capture.mock.calls[0]?.[1]).toMatchObject({ reason: 'paused' })
})

it('preserves output-limit documentation without requesting another model response', async () => {
  const test = await harness([response('Truncated task result', 'max-tokens')])
  await test.run()
  await vi.waitFor(() => { expect(test.capture).toHaveBeenCalledTimes(1) })
  expect(test.requests).toHaveLength(1)
  expect(test.prepare).not.toHaveBeenCalled()
})

it('fails visibly on an unsaved checkpoint and permits a later human turn to retry', async () => {
  const test = await harness([response('First task done'), response('Retry the finalization'), update()])
  vi.spyOn(test.ctx.sessions, 'flush').mockResolvedValueOnce(false)
  await test.run()
  expect(test.prepare).not.toHaveBeenCalled()
  expect(test.agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')?.data.reason.kind).toBe('error')
  await test.run()
  expect(test.prepare).toHaveBeenCalledTimes(1)
  expect(test.projection.stateOf(test.agent.session).view?.status).toBe('updated')
})

it('coalesces simultaneous stopping callbacks into one assessment admission', async () => {
  const test = await harness([])
  test.agent.session.append('turn/start', { turn: 1 })
  const release = Promise.withResolvers<boolean>()
  vi.spyOn(test.ctx.sessions, 'flush').mockReturnValueOnce(release.promise)
  test.prepare.mockResolvedValue(false)
  const signal = new AbortController().signal
  const first = agentEvents(test.ctx, test.agent).serial('agent/turn-stopping', { turn: 1, cause: 'model-finished', signal })
  const second = agentEvents(test.ctx, test.agent).serial('agent/turn-stopping', { turn: 1, cause: 'model-finished', signal })
  release.resolve(true)
  await Promise.all([first, second])
  expect(test.prepare).toHaveBeenCalledTimes(1)
})
