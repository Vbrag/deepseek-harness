/** Real AgentFactory capture and continuation, with controlled durability failures. */

import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Group from '@deepseek-ai/cordis-plugin-group'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { LlmAdapter, ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AttachmentLocal from '@deepseek-ai/dsh-attachment-local'
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import Approval from '@deepseek-ai/dsh-user-approval'
import { subagentModelSelectionProjectionDefinition } from '@deepseek-ai/dsh-subagent/model-selection-policy'
import * as Todo from '@deepseek-ai/dsh-tool-todo'
import GoalService from '@deepseek-ai/dsh-goal'
import PlanMode from '@deepseek-ai/dsh-plan-mode'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import WorkHandoffs from '../src/index.ts'
import type { WorkCheckpoint } from '../src/types.ts'

class RecordingAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  override async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(request)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'Continued.' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Continued.' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const checkpoint: WorkCheckpoint = {
  summary: 'Parser implementation is ready for review.', completed: ['Implemented parser'],
  remaining: [{ task: 'Review parser', nextActions: ['Run parser tests'], references: ['src/parser.ts'] }],
  validation: [{ command: 'test parser', result: 'unknown', evidence: [] }], blockers: [],
}

async function fixture(options: { attachments?: boolean; presets?: boolean; presetTodo?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'work-handoff-service-'))
  const workspace = join(root, 'workspace')
  const ctx = new Context()
  onTestFinished(async () => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  await mkdir(workspace)
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  await ctx.plugin(SandboxPolicy, { mode: 'danger-full-access', workspaceRoot: workspace })
  await ctx.plugin(Approval, { policy: 'never' })
  const routePolicy = await ctx.sessionProjections.register(subagentModelSelectionProjectionDefinition)
  ctx.effect(() => () => routePolicy.dispose(), 'test: release route policy')
  if (!options.presetTodo) await ctx.plugin(Todo, { allowParallelInProgress: true })
  if (options.attachments) await ctx.plugin(AttachmentLocal, { dshHome: join(root, 'home') })
  let removePreset: (() => Promise<void>) | undefined
  let unloadPresets: (() => Promise<void>) | undefined
  const hasPresets = options.presets || options.presetTodo
  if (hasPresets) {
    await ctx.plugin(Loader)
    ctx.loader.builtins.group = Group
    ctx.loader.builtins['handoff-todo'] = Todo
    const presetFiber = await ctx.plugin(AgentPresets, { default: 'restricted' })
    unloadPresets = () => presetFiber.dispose()
    const unregister = await ctx.agentPresets.register({ id: 'restricted', plugins: options.presetTodo
      ? [{ name: 'cordis:group', group: true, isolate: { todoPolicy: true },
        config: [{ name: 'cordis:handoff-todo', config: { allowParallelInProgress: true } }] }]
      : [] })
    removePreset = unregister
    ctx.effect(() => unregister, 'test: unregister preset')
  }
  const flushes: Array<{ sessionId: string; types: string[] }> = []
  let rejectFlush = false
  ctx.on('session/flush', (session) => {
    if (rejectFlush) throw new Error('storage unavailable')
    flushes.push({ sessionId: session.id, types: session.snapshotEvents().map(event => event.type) })
  })
  await ctx.plugin(WorkHandoffs, { maxEvidence: 4, maxTextChars: 2000, maxPending: 4, maxPolicyChars: 2000,
    gitTimeoutMs: 500, processGraceMs: 100 })
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new RecordingAdapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  const handle = await ctx.agents.create({
    sessionId: SessionId('work-source'), meta: { cwd: workspace, ...hasPresets ? { agentPreset: 'restricted' } : {} },
    agentOptions: { provider: 'mock', model: 'lead' },
    ...hasPresets ? { setup: async (agentCtx: Context) => { await ctx.agentPresets.mount(agentCtx, 'restricted') } } : {},
  })
  const agent = handle.agent
  agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Finish parser.' }],
    source: { kind: 'user' } }), { surfaceOp: 'append' })
  return { ctx, root, workspace, agent, adapter, routePolicy, flushes, removePreset, unloadPresets,
    failFlush: (value: boolean) => { rejectFlush = value } }
}

async function waitForCompleted(agent: Agent): Promise<void> {
  await agent.whenIdle()
  expect(agent.session.snapshotEvents().some(event => event.type === 'turn/end')).toBe(true)
}

describe('work handoff service', () => {
  it('queues one recovery through the isolated preset owner and preserves old-limit accounting', async () => {
    const { ctx, agent, adapter, flushes } = await fixture({ presetTodo: true })
    const policy = ctx.agentPresets.serviceFor(agent, 'todoPolicy')!
    policy.writeList(agent, [{ content: 'Parsed', status: 'completed' }, { content: 'Review', status: 'pending' }], 'current-task')
    policy.recordRepair(agent)
    policy.recordRepair(agent)
    policy.markLimit(agent)
    await ctx.workHandoffs.capture(agent, { reason: 'todo-limit' })
    const first = ctx.workHandoffs.recoverTodos(agent)
    const duplicate = ctx.workHandoffs.recoverTodos(agent)
    expect(duplicate).toBe(first)
    expect(await first).toBe(true)
    await waitForCompleted(agent)
    expect(policy.viewOf(agent.session)).toMatchObject({
      purpose: 'current-task', disposition: 'active', repairAttempts: 2, completedHighWater: 1,
    })
    expect(ctx.workHandoffs.viewOf(agent.session)).toBeNull()
    expect(agent.session.snapshotEvents().filter(event => event.type === 'user/message'
      && event.data.source?.kind === 'todo-reconcile')).toHaveLength(1)
    expect(adapter.requests).toHaveLength(1)
    expect(flushes.some(flush => flush.types.includes('todo/policy') && !flush.types.includes('turn/start'))).toBe(true)
    const text = adapter.requests[0]!.messages.flatMap(message => message.content)
      .flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
    expect(text).toContain('Historical repair-attempt limits do not stop execution')
  })

  it.each(['proposal', 'legacy', 'paused', 'waiting', 'completed'] as const)(
    'does not automatically authorize %s todo work', async (kind) => {
      const { ctx, agent, adapter } = await fixture()
      const todos = [{ content: 'Review', status: kind === 'completed' ? 'completed' as const : 'pending' as const }]
      if (kind === 'legacy') agent.session.append('todo/write', { todos })
      else ctx.todoPolicy.writeList(agent, todos, kind === 'proposal' ? 'proposal' : 'current-task')
      if (kind === 'paused' || kind === 'waiting') await ctx.todoPolicy.suspend(agent, kind, 'Human decision required')
      const before = ctx.todoPolicy.viewOf(agent.session)
      expect(await ctx.workHandoffs.recoverTodos(agent)).toBe(false)
      expect(ctx.todoPolicy.viewOf(agent.session)).toEqual(before)
      expect(adapter.requests).toHaveLength(0)
    })

  it.each(['error', 'cancelled', 'output-limit', 'waiting', 'paused', 'legacy-confirmation'] as const)(
    'keeps a %s handoff stopped even if its todo policy is still active', async (reason) => {
      const { ctx, agent, adapter } = await fixture()
      ctx.todoPolicy.writeList(agent, [{ content: 'Review', status: 'pending' }], 'current-task')
      const handoff = await ctx.workHandoffs.capture(agent, { reason })
      expect(await ctx.workHandoffs.recoverTodos(agent)).toBe(false)
      expect(ctx.workHandoffs.viewOf(agent.session)?.id).toBe(handoff.id)
      expect(adapter.requests).toHaveLength(0)
    })

  it.each(['active', 'paused', 'blocked'] as const)('defers to an existing %s goal', async (phase) => {
    const { ctx, agent, adapter } = await fixture()
    await ctx.plugin(GoalService)
    const goal = ctx.goals.create(agent, { objective: 'Goal owns execution', maxGoalRounds: 3 })
    if (phase === 'paused') ctx.goals.pause(agent, goal)
    if (phase === 'blocked') ctx.goals.block(agent, goal, { code: 'user-input', message: 'Need approval' })
    ctx.todoPolicy.writeList(agent, [{ content: 'Review', status: 'pending' }], 'current-task')
    expect(await ctx.workHandoffs.recoverTodos(agent)).toBe(false)
    expect(adapter.requests).toHaveLength(0)
  })

  it('does not recover execution while plan mode is selected', async () => {
    const { ctx, agent, adapter } = await fixture()
    await ctx.plugin(PlanMode, { section: 'Develop the plan before implementation.' })
    ctx.planMode.set(agent, true)
    ctx.todoPolicy.writeList(agent, [{ content: 'Review', status: 'pending' }], 'current-task')
    expect(await ctx.workHandoffs.recoverTodos(agent)).toBe(false)
    expect(adapter.requests).toHaveLength(0)
  })

  it('cancels recovery during durability I/O, preserves counters, and persists a pause', async () => {
    const { ctx, agent, adapter } = await fixture()
    ctx.todoPolicy.writeList(agent, [{ content: 'Review', status: 'pending' }], 'current-task')
    ctx.todoPolicy.recordRepair(agent)
    ctx.todoPolicy.markLimit(agent)
    const flushing = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const stop = ctx.on('session/flush', async () => { flushing.resolve(undefined); await release.promise })
    const recovery = ctx.workHandoffs.recoverTodos(agent)
    try {
      await Promise.race([flushing.promise, recovery.then(() => { throw new Error('Recovery did not request a flush') })])
      agent.cancel({ kind: 'user' }, { keepInbox: true })
      expect(await recovery).toBe(false)
      await agent.whenIdle()
      expect(agent.inbox.nextTurn).toHaveLength(0)
      expect(ctx.todoPolicy.viewOf(agent.session)).toMatchObject({ disposition: 'paused', repairAttempts: 1 })
      expect(adapter.requests).toHaveLength(0)
    } finally {
      release.resolve(undefined)
      stop()
      await Promise.allSettled([recovery])
    }
  })

  it('leaves authorization active when its recovery caller unloads during a flush', async () => {
    const { ctx, agent, adapter } = await fixture()
    ctx.todoPolicy.writeList(agent, [{ content: 'Review', status: 'pending' }], 'current-task')
    const caller = new AbortController()
    const flushing = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const stop = ctx.on('session/flush', async () => { flushing.resolve(undefined); await release.promise })
    const recovery = ctx.workHandoffs.recoverTodos(agent, caller.signal)
    try {
      await Promise.race([flushing.promise, recovery.then(() => { throw new Error('Recovery did not request a flush') })])
      caller.abort(new DOMException('Driver unloaded', 'AbortError'))
      expect(await recovery).toBe(false)
      expect(ctx.todoPolicy.viewOf(agent.session)?.disposition).toBe('active')
      expect(adapter.requests).toHaveLength(0)
    } finally {
      release.resolve(undefined)
      stop()
      await Promise.allSettled([recovery])
    }
  })

  it('lets newer human input supersede recovery while its checkpoint is pending', async () => {
    const { ctx, agent, adapter } = await fixture()
    ctx.todoPolicy.writeList(agent, [{ content: 'Review', status: 'pending' }], 'current-task')
    const flushing = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const stop = ctx.on('session/flush', async () => { flushing.resolve(undefined); await release.promise })
    const recovery = ctx.workHandoffs.recoverTodos(agent)
    try {
      await Promise.race([flushing.promise, recovery.then(() => { throw new Error('Recovery did not request a flush') })])
      agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Review a different file.' }] }))
      release.resolve(undefined)
      expect(await recovery).toBe(false)
      await waitForCompleted(agent)
      expect(adapter.requests).toHaveLength(1)
      expect(agent.session.snapshotEvents().some(event => event.type === 'user/message'
        && event.data.source?.kind === 'todo-reconcile')).toBe(false)
    } finally {
      release.resolve(undefined)
      stop()
      await Promise.allSettled([recovery])
    }
  })

  it('does not admit recovery after a failed durable checkpoint', async () => {
    const { ctx, agent, adapter, failFlush } = await fixture()
    ctx.todoPolicy.writeList(agent, [{ content: 'Review', status: 'pending' }], 'current-task')
    failFlush(true)
    await expect(ctx.workHandoffs.recoverTodos(agent)).rejects.toHaveProperty('code', 'WORK_HANDOFF_PERSISTENCE_FAILED')
    expect(agent.inbox.nextTurn).toHaveLength(0)
    expect(ctx.todoPolicy.viewOf(agent.session)?.disposition).toBe('paused')
    expect(adapter.requests).toHaveLength(0)
  })

  it('withdraws the exact automatic input when cancellation occurs during inbox insertion', async () => {
    const { ctx, agent, adapter } = await fixture()
    ctx.todoPolicy.writeList(agent, [{ content: 'Review', status: 'pending' }], 'current-task')
    const stop = ctx.on('session/event', (session, event) => {
      if (session === agent.session && event.type === 'agent/inbox/spliced'
        && event.data.inserted.some(message => message.source?.kind === 'todo-reconcile')) {
        agent.cancel({ kind: 'user' }, { keepInbox: true })
      }
    })
    try {
      expect(await ctx.workHandoffs.recoverTodos(agent)).toBe(false)
      await agent.whenIdle()
      expect(agent.inbox.nextTurn).toHaveLength(0)
      expect(ctx.todoPolicy.viewOf(agent.session)?.disposition).toBe('paused')
      expect(adapter.requests).toHaveLength(0)
    } finally {
      stop()
    }
  })

  it.each(['inbox', 'cleared'] as const)(
    'withdraws recovery when cancellation is queued after the %s event before maintenance wakes', async (boundary) => {
      const { ctx, agent, adapter } = await fixture()
      ctx.todoPolicy.writeList(agent, [{ content: 'Review', status: 'pending' }], 'current-task')
      await ctx.workHandoffs.capture(agent, { reason: 'todo-limit' })
      const stop = ctx.on('session/event', (session, event) => {
        if (session !== agent.session) return
        const inserted = event.type === 'agent/inbox/spliced'
          && event.data.inserted.some(message => message.source?.kind === 'todo-reconcile')
        if ((boundary === 'inbox' && inserted) || (boundary === 'cleared' && event.type === 'work-handoff/cleared')) {
          queueMicrotask(() => { agent.cancel({ kind: 'user' }, { keepInbox: true }) })
        }
      })
      try {
        expect(await ctx.workHandoffs.recoverTodos(agent)).toBe(false)
        await agent.whenIdle()
        expect(agent.inbox.nextTurn).toHaveLength(0)
        expect(ctx.todoPolicy.viewOf(agent.session)?.disposition).toBe('paused')
        expect(adapter.requests).toHaveLength(0)
      } finally {
        stop()
      }
    })

  it.each(['pause', 'permissions', 'model'] as const)(
    'rechecks %s changes before admitting recovery after a flush', async (change) => {
      const { ctx, agent, adapter } = await fixture()
      ctx.todoPolicy.writeList(agent, [{ content: 'Review', status: 'pending' }], 'current-task')
      const flushing = Promise.withResolvers<undefined>()
      const release = Promise.withResolvers<undefined>()
      const stop = ctx.on('session/flush', async () => { flushing.resolve(undefined); await release.promise })
      const recovery = ctx.workHandoffs.recoverTodos(agent)
      try {
        await Promise.race([flushing.promise, recovery.then(() => { throw new Error('Recovery did not request a flush') })])
        if (change === 'pause') await ctx.todoPolicy.suspend(agent, 'paused', 'Human stopped execution')
        else if (change === 'permissions') agent.session.append('approval/policy', { policy: 'ask' })
        else agent.model.select({ provider: 'mock', model: 'different' })
        release.resolve(undefined)
        expect(await recovery).toBe(false)
        expect(agent.inbox.nextTurn).toHaveLength(0)
        expect(adapter.requests).toHaveLength(0)
      } finally {
        release.resolve(undefined)
        stop()
        await Promise.allSettled([recovery])
      }
    })

  it('captures, resumes, and transfers the todo policy from its actual isolated preset owner', async () => {
    const { ctx, agent } = await fixture({ presetTodo: true })
    expect(ctx.get('todoPolicy')).toBeUndefined()
    expect(agent.ctx.get('todoPolicy')).toBeUndefined()
    const policy = ctx.agentPresets.serviceFor(agent, 'todoPolicy')
    expect(policy).toBeDefined()
    policy!.writeList(agent, [{ content: 'Review parser', status: 'pending' }], 'current-task')
    await policy!.suspend(agent, 'paused', 'Waiting for human review.')
    const view = await ctx.workHandoffs.capture(agent, { reason: 'paused' })
    expect(view.todos).toEqual([{ content: 'Review parser', status: 'pending' }])
    expect(view.markdown).toContain('Waiting for human review.')
    const result = await ctx.workHandoffs.continueInNewSession(agent, view.id)
    const target = ctx.agents.get(result.sessionId)!
    await waitForCompleted(target)
    const targetPolicy = ctx.agentPresets.serviceFor(target, 'todoPolicy')
    expect(targetPolicy?.listOf(target.session)).toEqual(view.todos)
    expect(targetPolicy?.viewOf(target.session)?.disposition).toBe('active')
    expect(policy!.viewOf(agent.session)?.disposition).toBe('paused')
    await ctx.workHandoffs.resumeTodos(agent)
    await waitForCompleted(agent)
    expect(policy!.viewOf(agent.session)?.disposition).toBe('active')
  })

  it('keeps a proposed list unapproved when an error handoff continues in a fresh Session', async () => {
    const { ctx, agent, adapter } = await fixture({ presetTodo: true })
    const policy = ctx.agentPresets.serviceFor(agent, 'todoPolicy')!
    policy.writeList(agent, [{ content: 'Proposed parser implementation', status: 'pending' }], 'proposal')
    const view = await ctx.workHandoffs.capture(agent, { reason: 'error',
      stopDetail: 'Planning output was interrupted before the user approved implementation.' })
    expect(policy.viewOf(agent.session)?.purpose).toBe('proposal')
    const result = await ctx.workHandoffs.continueInNewSession(agent, view.id)
    const target = ctx.agents.get(result.sessionId)!
    await waitForCompleted(target)
    const targetPolicy = ctx.agentPresets.serviceFor(target, 'todoPolicy')!
    expect(targetPolicy.listOf(target.session)).toEqual(view.todos)
    expect(targetPolicy.viewOf(target.session)?.purpose).toBe('proposal')
    expect(policy.viewOf(agent.session)?.purpose).toBe('proposal')
    const texts = adapter.requests[0]!.messages.flatMap(message => message.content)
      .flatMap(block => block.type === 'text' ? [block.text] : [])
    expect(texts.join('\n')).toContain('do not assume a proposed implementation was approved')
    await ctx.workHandoffs.resumeTodos(agent)
    await waitForCompleted(agent)
    expect(policy.viewOf(agent.session)?.purpose).toBe('current-task')
    expect(targetPolicy.viewOf(target.session)?.purpose).toBe('proposal')
  })

  it('captures once, stores the actual Markdown attachment, and acknowledges only after flush', async () => {
    const { ctx, agent, flushes } = await fixture({ attachments: true })
    const authored = structuredClone(checkpoint)
    ctx.workHandoffs.checkpoint(agent, authored)
    authored.completed.push('Late mutation')
    const [first, second] = await Promise.all([
      ctx.workHandoffs.capture(agent, { reason: 'todo-limit' }),
      ctx.workHandoffs.capture(agent, { reason: 'todo-limit' }),
    ])
    expect(first).toEqual(second)
    expect(first.saved).toBe(true)
    expect(first.attachment).toBeDefined()
    const bytes: Uint8Array[] = []
    for await (const chunk of ctx.attachments.readFileStream(first.attachment!)) bytes.push(chunk)
    expect(Buffer.concat(bytes).toString('utf8')).toBe(first.markdown)
    expect(first.markdown).toContain('## Checkpoint validation reports\n\n### unknown')
    expect(first.markdown).not.toContain('Late mutation')
    first.todos.push({ content: 'Mutated view', status: 'pending' })
    expect(ctx.workHandoffs.viewOf(agent.session)?.todos).toEqual([])
    const types = agent.session.snapshotEvents().map(event => event.type)
    expect(types.filter(type => type === 'work-handoff/captured')).toHaveLength(1)
    expect(types.filter(type => type === 'work-handoff/saved')).toHaveLength(1)
    expect(flushes[0]?.types).toContain('work-handoff/captured')
    expect(flushes[0]?.types).not.toContain('work-handoff/saved')
  })

  it('retains an honest embedded handoff when file export is unavailable', async () => {
    const { ctx, agent, flushes } = await fixture()
    const view = await ctx.workHandoffs.capture(agent, { reason: 'error' })
    expect(view.saved).toBe(true)
    expect(view.attachment).toBeUndefined()
    expect(view.exportError).toContain('No file attachment provider')
    expect(view.markdown).toContain('No progress checkpoint was recorded.')
    expect(view.markdown).toContain('No validation commands were reported.')
    expect(view.markdown).toContain('Changed-file observations are unavailable.')
    expect(flushes).toHaveLength(1)
    expect(ctx.workHandoffs.viewOf(agent.session)?.markdown).toBe(view.markdown)
  })

  it('leaves failed persistence unsaved and retries the same capture after storage recovers', async () => {
    const { ctx, agent, failFlush } = await fixture()
    failFlush(true)
    await expect(ctx.workHandoffs.capture(agent, { reason: 'cancelled' }))
      .rejects.toHaveProperty('code', 'WORK_HANDOFF_PERSISTENCE_FAILED')
    expect(ctx.workHandoffs.viewOf(agent.session)?.saved).toBe(false)
    expect(agent.session.snapshotEvents().some(event => event.type === 'work-handoff/saved')).toBe(false)
    failFlush(false)
    const view = await ctx.workHandoffs.capture(agent, { reason: 'cancelled' })
    expect(view.saved).toBe(true)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'work-handoff/captured')).toHaveLength(1)
  })

  it('validates model checkpoint input before logging and leaves progress unchanged on invalid arguments', async () => {
    const { ctx, agent } = await fixture()
    const execute = (args: unknown) => executeToolFixture(ctx, {
      agent, name: 'work_checkpoint', callId: ToolCallId('checkpoint-call'),
      signal: new AbortController().signal, arguments: args,
    })
    expect((await execute({ ...checkpoint, summary: 'x'.repeat(2001) })).isError).toBe(true)
    expect((await execute({ ...checkpoint, unexpected: true })).isError).toBe(true)
    expect(agent.session.snapshotEvents().some(event => event.type === 'work-handoff/checkpoint')).toBe(false)
    expect((await execute(checkpoint)).isError).toBe(false)
    const view = await ctx.workHandoffs.capture(agent, { reason: 'waiting' })
    expect(view.markdown).toContain(checkpoint.summary)
  })

  it('records the actual waiting policy explanation alongside concrete remaining actions', async () => {
    const { ctx, agent } = await fixture()
    ctx.todoPolicy.writeList(agent, [{ content: 'Review parser', status: 'pending' }],
      'current-task', 'waiting', 'Waiting for the user to grant repository review access.')
    ctx.workHandoffs.checkpoint(agent, checkpoint)
    const view = await ctx.workHandoffs.capture(agent, { reason: 'waiting' })
    expect(view.markdown).toContain('## Recorded stop explanation\n\nWaiting for the user to grant repository review access.')
    expect(view.markdown).toContain('Run parser tests')
    expect(view.markdown).toContain('src/parser.ts')
  })

  it('creates one fresh Agent on duplicate clicks and retains exact restrictive policies and the source preset', async () => {
    const { ctx, agent, adapter, workspace, routePolicy } = await fixture({ presets: true })
    agent.session.append('sandbox/mode', { mode: 'read-only' })
    agent.session.append('approval/policy', { policy: 'ask' })
    agent.session.append('permission/preset', { preset: 'read-only' })
    agent.session.append('subagent/model-selection-policy', { allowedModels: [{ provider: 'mock', model: 'worker' }] })
    agent.session.append('plan/mode', { active: true })
    const view = await ctx.workHandoffs.capture(agent, { reason: 'todo-limit',
      todos: [{ content: 'Review parser', status: 'pending' }] })
    expect(adapter.requests).toHaveLength(0)
    const one = ctx.workHandoffs.continueInNewSession(agent, view.id)
    const two = ctx.workHandoffs.continueInNewSession(agent, view.id)
    expect(two).toBe(one)
    const result = await one
    const target = ctx.agents.get(result.sessionId)!
    await waitForCompleted(target)
    expect(ctx.agents.list().length).toBe(2)
    expect(target.id).not.toBe(agent.id)
    expect(target.session.header.cwd).toBe(workspace)
    expect(target.session.header.agentPreset).toBe('restricted')
    expect(ctx.agentPresets.presetForSession(target.session)).toBe('restricted')
    expect(ctx.sandboxPolicy.resolve({ session: target.session }).mode).toBe('read-only')
    expect(routePolicy.stateOf(target.session)).toEqual([{ provider: 'mock', model: 'worker' }])
    const policies = target.session.snapshotEvents().filter(event =>
      ['sandbox/mode', 'approval/policy', 'permission/preset', 'subagent/model-selection-policy', 'plan/mode'].includes(event.type))
    expect(policies.map(event => [event.type, event.data])).toEqual([
      ['sandbox/mode', { mode: 'read-only' }], ['approval/policy', { policy: 'ask' }],
      ['permission/preset', { preset: 'read-only' }],
      ['subagent/model-selection-policy', { allowedModels: [{ provider: 'mock', model: 'worker' }] }],
      ['plan/mode', { active: true }],
    ])
    expect(adapter.requests).toHaveLength(1)
    expect(adapter.requests[0]).toMatchObject({ provider: 'mock', model: 'lead' })
    const texts = adapter.requests[0]!.messages.flatMap(message => message.content)
      .flatMap(block => block.type === 'text' ? [block.text] : [])
    expect(texts.some(text => text.endsWith(view.markdown))).toBe(true)
    expect(texts.join('\n')).toContain('Current DSH file policy: read-only.')
    expect(texts.join('\n')).toContain('Approval prompts are enabled in this session')
    expect(ctx.todoPolicy.viewOf(target.session)?.purpose).toBe('current-task')
  })

  it('retains the source parent-only delegation allowance when no explicit policy was recorded', async () => {
    const { ctx, agent, routePolicy } = await fixture()
    const view = await ctx.workHandoffs.capture(agent, { reason: 'output-limit' })
    const result = await ctx.workHandoffs.continueInNewSession(agent, view.id)
    const target = ctx.agents.get(result.sessionId)!
    await waitForCompleted(target)
    expect(routePolicy.stateOf(target.session)).toEqual([{ provider: 'mock', model: 'lead' }])
    expect(target.session.snapshotEvents().filter(event => event.type === 'subagent/model-selection-policy')).toHaveLength(1)
    expect(target.model.current()).toMatchObject({ provider: 'mock', model: 'lead' })
  })

  it('rechecks the source workspace before creating any continuation', async () => {
    const { ctx, agent, workspace, adapter } = await fixture()
    const view = await ctx.workHandoffs.capture(agent, { reason: 'paused' })
    await rm(workspace, { recursive: true })
    await expect(ctx.workHandoffs.continueInNewSession(agent, view.id))
      .rejects.toHaveProperty('code', 'WORK_HANDOFF_WORKSPACE_UNAVAILABLE')
    expect(ctx.agents.list().length).toBe(1)
    expect(adapter.requests).toHaveLength(0)
  })

  it('continues in the committed working directory after it changes from the creation header', async () => {
    const { ctx, agent, root, workspace } = await fixture()
    const current = join(root, 'current')
    await mkdir(current)
    await ctx.workingDirectory.set(agent, current)
    expect(agent.session.header.cwd).toBe(workspace)
    const view = await ctx.workHandoffs.capture(agent, { reason: 'paused' })
    expect(view.markdown).toContain(current.replace(/\\/g, '\\\\'))
    const continued = await ctx.workHandoffs.continueInNewSession(agent, view.id)
    const target = ctx.agents.get(continued.sessionId)!
    await waitForCompleted(target)
    expect(target.session.header.cwd).toBe(current)
    expect(ctx.workingDirectory.get(target.session)).toBe(current)
  })

  it('rolls a newly created Agent back before model admission when its persistence fails', async () => {
    const { ctx, agent, adapter, failFlush } = await fixture()
    const view = await ctx.workHandoffs.capture(agent, { reason: 'todo-limit' })
    failFlush(true)
    await expect(ctx.workHandoffs.continueInNewSession(agent, view.id))
      .rejects.toHaveProperty('code', 'WORK_HANDOFF_PERSISTENCE_FAILED')
    expect(ctx.agents.list().length).toBe(1)
    expect(adapter.requests).toHaveLength(0)
    expect(ctx.workHandoffs.viewOf(agent.session)?.id).toBe(view.id)
  })

  it('retains the exact mounted source preset after its definition retires', async () => {
    const { ctx, agent, removePreset } = await fixture({ presets: true })
    const view = await ctx.workHandoffs.capture(agent, { reason: 'paused' })
    await removePreset!()
    const result = await ctx.workHandoffs.continueInNewSession(agent, view.id)
    const target = ctx.agents.get(result.sessionId)!
    await waitForCompleted(target)
    expect(ctx.agentPresets.composedPreset(target.ctx)).toBe('restricted')
  })

  it('refuses continuation if the owner of the source preset has unloaded', async () => {
    const { ctx, agent, adapter, unloadPresets } = await fixture({ presets: true })
    const view = await ctx.workHandoffs.capture(agent, { reason: 'paused' })
    await unloadPresets!()
    await expect(ctx.workHandoffs.continueInNewSession(agent, view.id))
      .rejects.toHaveProperty('code', 'WORK_HANDOFF_UNAVAILABLE')
    expect(ctx.agents.list()).toEqual([agent])
    expect(adapter.requests).toHaveLength(0)
  })

  it('uses the source current preset after selection instead of its immutable creation header', async () => {
    const { ctx, agent } = await fixture({ presets: true })
    const unregister = await ctx.agentPresets.register({ id: 'narrower', plugins: [] })
    ctx.effect(() => unregister, 'test: unregister selected preset')
    await ctx.agentPresets.select(agent, 'narrower')
    expect(agent.session.header.agentPreset).toBe('restricted')
    expect(ctx.agentPresets.presetForSession(agent.session)).toBe('narrower')
    const view = await ctx.workHandoffs.capture(agent, { reason: 'paused' })
    const result = await ctx.workHandoffs.continueInNewSession(agent, view.id)
    const target = ctx.agents.get(result.sessionId)!
    await waitForCompleted(target)
    expect(target.session.header.agentPreset).toBe('narrower')
    expect(ctx.agentPresets.composedPreset(target.ctx)).toBe('narrower')
  })

  it('keeps a preset-free source unbound even when a default preset registry is mounted', async () => {
    const { ctx, workspace } = await fixture({ presets: true })
    const source = await ctx.agents.create({ sessionId: SessionId('preset-free-source'), meta: { cwd: workspace },
      agentOptions: { provider: 'mock', model: 'lead' } })
    expect(ctx.agentPresets.presetForSession(source.agent.session)).toBeNull()
    const view = await ctx.workHandoffs.capture(source.agent, { reason: 'paused' })
    const result = await ctx.workHandoffs.continueInNewSession(source.agent, view.id)
    const target = ctx.agents.get(result.sessionId)!
    await waitForCompleted(target)
    expect(target.session.header.agentPreset).toBeUndefined()
    expect(ctx.agentPresets.composedPreset(target.ctx)).toBeUndefined()
  })

  it('keeps a thrown attachment error separate from durable embedded capture', async () => {
    const { ctx, agent } = await fixture({ attachments: true })
    const failure = vi.spyOn(ctx.attachments, 'saveFile').mockRejectedValueOnce(new Error('attachment disk full'))
    onTestFinished(() => { failure.mockRestore() })
    const view = await ctx.workHandoffs.capture(agent, { reason: 'error' })
    expect(view.saved).toBe(true)
    expect(view.exportError).toContain('attachment disk full')
    expect(view.markdown).toContain('Finish parser.')
    expect(view.attachment).toBeUndefined()
  })

  it('does not revive a completed goal when unfinished todo work is captured', async () => {
    const { ctx, agent } = await fixture()
    await ctx.plugin(GoalService)
    const goal = ctx.goals.create(agent, { objective: 'Already finished goal', maxGoalRounds: 2 })
    ctx.goals.complete(agent, goal)
    const view = await ctx.workHandoffs.capture(agent, { reason: 'todo-limit',
      todos: [{ content: 'Review new parser task', status: 'pending' }] })
    expect(view.goal).toBeUndefined()
    expect(view.objective).toBe('Finish parser.')
    const continued = await ctx.workHandoffs.continueInNewSession(agent, view.id)
    const target = ctx.agents.get(continued.sessionId)!
    await waitForCompleted(target)
    expect(ctx.goals.get(target)).toBeUndefined()
  })

  it('captures the exact changed goal revision and remains idempotent at that revision', async () => {
    const { ctx, agent } = await fixture()
    await ctx.plugin(GoalService)
    const goal = ctx.goals.create(agent, { objective: 'Finish parser goal', maxGoalRounds: 2 })
    const first = await ctx.workHandoffs.capture(agent, { reason: 'paused' })
    const paused = ctx.goals.pause(agent, goal)
    expect(paused.revision).toBeGreaterThan(goal.revision)
    const second = await ctx.workHandoffs.capture(agent, { reason: 'paused' })
    const third = await ctx.workHandoffs.capture(agent, { reason: 'paused' })
    expect(second.id).not.toBe(first.id)
    expect(second.goal?.revision).toBe(paused.revision)
    expect(third).toEqual(second)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'work-handoff/captured')).toHaveLength(2)
  })

  it('contains a throwing error observer when a background stop capture cannot persist', async () => {
    const { ctx, agent, failFlush } = await fixture()
    const reported = Promise.withResolvers<unknown>()
    ctx.on('agent/error', () => { throw new Error('observer failed') })
    ctx.on('agent/error', ({ error }) => { reported.resolve(error) })
    failFlush(true)
    agent.session.append('todo/write', { todos: [{ content: 'Unfinished parser', status: 'pending' }] })
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } })
    await expect(reported.promise).resolves.toHaveProperty('code', 'WORK_HANDOFF_PERSISTENCE_FAILED')
    expect(ctx.workHandoffs.viewOf(agent.session)?.saved).toBe(false)
  })

  it('rejects a capture if a new turn commits while its attachment export is pending', async () => {
    const { ctx, agent } = await fixture({ attachments: true })
    const exporting = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const save = ctx.attachments.saveFile.bind(ctx.attachments)
    const hold = vi.spyOn(ctx.attachments, 'saveFile').mockImplementationOnce(async (input) => {
      exporting.resolve(undefined)
      await release.promise
      return save(input)
    })
    onTestFinished(() => { hold.mockRestore() })
    const capture = ctx.workHandoffs.capture(agent, { reason: 'paused' })
    try {
      await Promise.race([exporting.promise, capture.then(() => { throw new Error('Capture finished before export began') })])
      agent.session.append('turn/start', { turn: 1 })
      agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      const failed = expect(capture).rejects.toHaveProperty('code', 'WORK_HANDOFF_STALE')
      release.resolve(undefined)
      await failed
      expect(agent.session.snapshotEvents().some(event => event.type === 'work-handoff/captured')).toBe(false)
    } finally {
      release.resolve(undefined)
      await Promise.allSettled([capture])
    }
  })

  it.each(['permissions', 'turn', 'model', 'preset'] as const)(
    'refuses continuation if source %s changes during workspace validation', async (change) => {
      const { ctx, agent, adapter } = await fixture({ presets: change === 'preset' })
      const view = await ctx.workHandoffs.capture(agent, { reason: 'paused' })
      const checking = Promise.withResolvers<undefined>()
      const release = Promise.withResolvers<undefined>()
      const stat = ctx.fs.stat.bind(ctx.fs)
      const held = vi.spyOn(ctx.fs, 'stat').mockImplementationOnce(async (...args) => {
        checking.resolve(undefined)
        await release.promise
        return stat(...args)
      })
      onTestFinished(() => { held.mockRestore() })
      const continuation = ctx.workHandoffs.continueInNewSession(agent, view.id)
      try {
        await Promise.race([checking.promise, continuation.then(() => { throw new Error('Validation did not run') })])
        switch (change) {
          case 'permissions': agent.session.append('approval/policy', { policy: 'ask' }); break
          case 'turn':
            agent.session.append('turn/start', { turn: 1 })
            agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
            break
          case 'model': agent.model.select({ provider: 'mock', model: 'changed' }); break
          case 'preset': {
            const unregister = await ctx.agentPresets.register({ id: 'changed', plugins: [] })
            ctx.effect(() => unregister, 'test: unregister changed preset')
            await ctx.agentPresets.select(agent, 'changed')
            break
          }
          default: assertNever(change)
        }
        const failed = expect(continuation).rejects.toHaveProperty('code', 'WORK_HANDOFF_STALE')
        release.resolve(undefined)
        await failed
        expect(ctx.agents.list()).toEqual([agent])
        expect(adapter.requests).toHaveLength(0)
      } finally {
        release.resolve(undefined)
        await Promise.allSettled([continuation])
      }
    },
  )

  it('rolls the target back if source permissions change while target durability is pending', async () => {
    const { ctx, agent, adapter } = await fixture()
    const view = await ctx.workHandoffs.capture(agent, { reason: 'paused' })
    const flushing = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const stop = ctx.on('session/flush', async (session) => {
      if (session === agent.session) return
      flushing.resolve(undefined)
      await release.promise
    })
    const continuation = ctx.workHandoffs.continueInNewSession(agent, view.id)
    try {
      await Promise.race([flushing.promise, continuation.then(() => { throw new Error('Target flush did not run') })])
      agent.session.append('approval/policy', { policy: 'ask' })
      const failed = expect(continuation).rejects.toHaveProperty('code', 'WORK_HANDOFF_STALE')
      release.resolve(undefined)
      await failed
      expect(ctx.agents.list()).toEqual([agent])
      expect(adapter.requests).toHaveLength(0)
    } finally {
      release.resolve(undefined)
      stop()
      await Promise.allSettled([continuation])
    }
  })
})
