import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { CommandId } from '@deepseek-ai/dsh-commands/brand'
import type { SubagentActivation, SubagentResult } from '@deepseek-ai/dsh-subagent'
import { SubagentError } from '@deepseek-ai/dsh-subagent'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import OrchestrationService, { orchestrationProjectionDefinition } from '../src/index.ts'
import type { OrchestrationConfig, OrchestrationProjection, OrchestrationUnitState } from '../src/types.ts'

const parent = {
  id: 'parent-agent',
  model: { current: () => ({ provider: 'paderborn', model: 'gwdg.deepseek-v4-flash-0731' }) },
  session: {},
} as never

const POOL = [
  { provider: 'paderborn', model: 'gwdg.deepseek-v4-flash-0731' },
  { provider: 'paderborn', model: 'gwdg.glm-5.3-flash' },
]

/** The coordinator reply for a single "coding"-domained step. */
function* singleStepPlan(): Generator<StreamChunk> {
  yield { type: 'text-delta', index: 0, text: '[{"description":"Do A","requiredDomains":["coding"]}]' }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

/** The coordinator reply for two independent steps. */
function* twoStepPlan(): Generator<StreamChunk> {
  yield { type: 'text-delta', index: 0, text: '[{"description":"Do A","requiredDomains":["coding"]},{"description":"Do B","requiredDomains":["coding"]}]' }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

/** Wrap a sync generator so `ctx.llm.stream` reports an AsyncIterable. */
function asyncIterable(gen: Generator<StreamChunk>): AsyncIterable<StreamChunk> {
  return (async function* () {
    for (const chunk of gen) yield chunk
  })()
}

function activation(childId: string, result: SubagentResult): SubagentActivation {
  return { childId: SessionId(childId), result: Promise.resolve(result), dispose: () => Promise.resolve() }
}

async function setup(overrides: OrchestrationConfig = {}) {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  const llm = { stream: vi.fn((_request: GenerateOptions) => asyncIterable(singleStepPlan())) }
  ctx.provide('llm', llm as never)
  const subagents = { startActivation: vi.fn() }
  ctx.provide('subagents', subagents as never)
  await ctx.plugin(OrchestrationService, overrides)
  return { ctx, service: ctx.orchestrations, llm, subagents }
}

/** A live Agent backed by a real store Session. */
async function makeAgent(ctx: Context, id = 'agent-1'): Promise<Agent & { session: Session }> {
  const session = ctx.sessions.create()
  return { id: SessionId(id), session } as Agent & { session: Session }
}

/** Open a turn so a selection queues for the boundary flush (the mid-turn shape). */
function openTurn(session: Session, turn = 0): void {
  session.append('turn/start', { turn })
}

/** Append a committed /orchestration selection record (the executor's command/run shape). */
function runCommand(session: Session, args: string, index: number): CommandId {
  const commandId = CommandId(`orch-proj-${String(index)}`)
  session.append('command/run', {
    commandId,
    name: 'orchestration',
    args,
    source: { kind: 'user' },
  })
  return commandId
}

/** Append the paired settlement for one projected orchestration command. */
function settleCommand(session: Session, commandId: CommandId, kind: 'success' | 'error'): void {
  session.append('command/done', { commandId, kind })
}

describe('OrchestrationService config validation', () => {
  it('rejects a non-positive concurrency value', () => {
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    expect(() => new OrchestrationService(ctx, { maxConcurrency: 0 })).toThrow('maxConcurrency must be a positive safe integer')
  })

  it('rejects a non-integer max attempts value', () => {
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    expect(() => new OrchestrationService(ctx, { maxAttemptsPerStep: 1.5 })).toThrow('maxAttemptsPerStep must be a positive safe integer')
  })

  it('rejects a non-safe-integer worker timeout', () => {
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    expect(() => new OrchestrationService(ctx, { workerTimeoutMs: 2 ** 53 })).toThrow('workerTimeoutMs must be a positive safe integer')
  })

  it('falls back to the documented defaults for every unset value', () => {
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    expect(() => new OrchestrationService(ctx, {})).not.toThrow()
  })

  it('still validates positive safe integer fields when defaultToOrchestrator is set', () => {
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    expect(() => new OrchestrationService(ctx, { defaultToOrchestrator: true, maxConcurrency: 0 }))
      .toThrow('maxConcurrency must be a positive safe integer')
  })

  it('fails loud when the projection is not yet ready', () => {
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const service = new OrchestrationService(ctx, {})
    expect(() => service.modeOf({ id: SessionId('unready') } as never)).toThrow('orchestration mode is not ready')
  })
})

describe('OrchestrationService pool', () => {
  it('tracks an empty pool until set and clears it again', async () => {
    const { service } = await setup()
    expect(service.getPool()).toEqual([])
    service.setPool([...POOL])
    expect(service.getPool()).toEqual(POOL)
    service.setPool([])
    expect(service.getPool()).toEqual([])
  })
})

describe('orchestration projection unit', () => {
  it('serves inactive/not-pending for the empty log and folds an explicit selection', () => {
    let state: OrchestrationUnitState = orchestrationProjectionDefinition.init()
    expect(orchestrationProjectionDefinition.wire!.view(state)).toEqual({ active: false, pending: false })
    state = orchestrationProjectionDefinition.apply(state, { type: 'orchestration/mode', seq: SessionSeq(0), time: 0, data: { active: true } })
    expect(state).toMatchObject({ active: true, entered: true })
    expect(orchestrationProjectionDefinition.wire!.view(state)).toEqual({ active: true, pending: false })
  })

  it('folds a logged /orchestration selection pending until orchestration/mode records it', () => {
    let state: OrchestrationUnitState = orchestrationProjectionDefinition.init()
    state = orchestrationProjectionDefinition.apply(state, {
      type: 'command/run',
      seq: SessionSeq(0),
      time: 0,
      data: { commandId: CommandId('c1'), name: 'orchestration', args: 'on', source: { kind: 'user' } },
    })
    expect(state.running?.wanted).toBe(true)
    expect(orchestrationProjectionDefinition.wire!.view(state)).toEqual({ active: false, pending: true })
    state = orchestrationProjectionDefinition.apply(state, {
      type: 'command/done',
      seq: SessionSeq(1),
      time: 1,
      data: { commandId: CommandId('c1'), kind: 'success' },
    })
    expect(state.wanted).toBe(true)
    expect(orchestrationProjectionDefinition.wire!.view(state)).toEqual({ active: false, pending: true })
    state = orchestrationProjectionDefinition.apply(state, { type: 'orchestration/mode', seq: SessionSeq(2), time: 2, data: { active: true } })
    expect(orchestrationProjectionDefinition.wire!.view(state)).toEqual({ active: true, pending: false })
  })

  it('drops an `on` selection that targets the already-active state', () => {
    let state: OrchestrationUnitState = orchestrationProjectionDefinition.init()
    state = orchestrationProjectionDefinition.apply(state, { type: 'orchestration/mode', seq: SessionSeq(0), time: 0, data: { active: true } })
    state = orchestrationProjectionDefinition.apply(state, {
      type: 'command/run',
      seq: SessionSeq(1),
      time: 1,
      data: { commandId: CommandId('c2'), name: 'orchestration', args: 'on', source: { kind: 'user' } },
    })
    state = orchestrationProjectionDefinition.apply(state, {
      type: 'command/done',
      seq: SessionSeq(2),
      time: 2,
      data: { commandId: CommandId('c2'), kind: 'success' },
    })
    // The successful selection targets the already-active state, so it drops rather than stays pending.
    expect(state.wanted).toBeNull()
    expect(orchestrationProjectionDefinition.wire!.view(state)).toEqual({ active: true, pending: false })
  })

  it('drops a selection when its command settles with an error', () => {
    let state: OrchestrationUnitState = orchestrationProjectionDefinition.init()
    state = orchestrationProjectionDefinition.apply(state, {
      type: 'command/run',
      seq: SessionSeq(0),
      time: 0,
      data: { commandId: CommandId('c3'), name: 'orchestration', args: 'on', source: { kind: 'user' } },
    })
    state = orchestrationProjectionDefinition.apply(state, {
      type: 'command/done',
      seq: SessionSeq(1),
      time: 1,
      data: { commandId: CommandId('c3'), kind: 'error' },
    })
    expect(orchestrationProjectionDefinition.wire!.view(state)).toEqual({ active: false, pending: false })
  })

  it('ignores command/run with omitted input, other commands, and unmatched command/done', () => {
    const state: OrchestrationUnitState = orchestrationProjectionDefinition.init()
    const other = orchestrationProjectionDefinition.apply(state, {
      type: 'command/run',
      seq: SessionSeq(0),
      time: 0,
      data: { commandId: CommandId('x1'), name: 'compact', args: '', source: { kind: 'user' } },
    })
    expect(other).toBe(state)
    const noInput = orchestrationProjectionDefinition.apply(other, {
      type: 'command/run',
      seq: SessionSeq(1),
      time: 1,
      data: { commandId: CommandId('x2'), name: 'orchestration', source: { kind: 'user' } },
    })
    expect(noInput).toBe(other)
    const unmatched = orchestrationProjectionDefinition.apply(noInput, {
      type: 'command/done',
      seq: SessionSeq(2),
      time: 2,
      data: { commandId: CommandId('x3'), kind: 'success' },
    })
    expect(unmatched).toBe(noInput)
  })

  it('round-trips the persisted unit state through the state schema', () => {
    const parsed = orchestrationProjectionDefinition.stateSchema.parse({
      active: true,
      wanted: null,
      running: null,
      entered: true,
    })
    expect(parsed).toEqual({ active: true, wanted: null, running: null, entered: true })
    const withRunning = orchestrationProjectionDefinition.stateSchema.parse({
      active: false,
      wanted: true,
      running: { commandId: CommandId('persisted'), wanted: true },
      entered: false,
    })
    expect(withRunning.running?.commandId).toBe('persisted')
  })

  it('folds the committed mode through the real registry and recovers it cold', async () => {
    const { ctx } = await setup()
    const bench = await setup()
    const session = bench.ctx.sessions.create()
    const commandId = runCommand(session, 'on', 0)
    const projected: OrchestrationProjection = bench.ctx.sessionProjections.snapshot(session).values.orchestration!
    expect(projected).toEqual({ active: false, pending: true })
    settleCommand(session, commandId, 'success')
    session.append('orchestration/mode', { active: true })
    expect(bench.ctx.sessionProjections.snapshot(session).values.orchestration).toEqual({ active: true, pending: false })
    expect(ctx.sessionProjections.snapshot(session).values.orchestration).toEqual({ active: true, pending: false })
  })
})

describe('OrchestrationService run', () => {
  it('fails loud when no pool is selected', async () => {
    const { ctx } = await setup()
    const result = await ctx.orchestrations.run(parent, 'task', undefined, new AbortController().signal)
    expect(result).toEqual({ steps: [], succeeded: false, failovers: 0, failedSteps: 0 })
  })

  it('fails loud when the pool resolves to no usable routes', async () => {
    const { ctx } = await setup()
    const result = await ctx.orchestrations.run(parent, 'task', [{ provider: 'paderborn', model: 'not-a-model' }], new AbortController().signal)
    expect(result).toEqual({ steps: [], succeeded: false, failovers: 0, failedSteps: 0 })
  })

  it('completes every step on a happy path', async () => {
    const { ctx, subagents } = await setup()
    subagents.startActivation.mockResolvedValue(activation('c', { output: [], stopReason: 'completed' }))
    const result = await ctx.orchestrations.run(parent, 'task', [...POOL], new AbortController().signal)
    expect(result.succeeded).toBe(true)
    expect(result.failedSteps).toBe(0)
    expect(result.failovers).toBe(0)
    expect(result.steps).toHaveLength(1)
    expect(result.steps[0]?.failed).toBe(false)
  })

  it('plans on the parent model and forwards its reasoning effort to the coordinator', async () => {
    const { ctx, llm, subagents } = await setup()
    subagents.startActivation.mockResolvedValue(activation('c', { output: [], stopReason: 'completed' }))
    const parentWithEffort = {
      id: 'parent-with-effort',
      model: { current: () => ({ provider: 'parent-provider', model: 'parent-model-outside-worker-pool', reasoningEffort: 'high' }) },
    } as never
    await ctx.orchestrations.run(parentWithEffort, 'task', [...POOL], new AbortController().signal)
    expect(llm.stream).toHaveBeenCalledTimes(1)
    const request = llm.stream.mock.calls[0]![0]
    expect(request.provider).toBe('parent-provider')
    expect(request.model).toBe('parent-model-outside-worker-pool')
    expect(request.reasoningEffort).toBe('high')
  })

  it('fails over an errored attempt with a diagnostic to the next route', async () => {
    const { ctx, subagents } = await setup({ maxAttemptsPerStep: 2 })
    subagents.startActivation
      .mockResolvedValueOnce(activation('e', { output: [], stopReason: 'error', diagnostic: 'gateway 503' }))
      .mockResolvedValueOnce(activation('c', { output: [], stopReason: 'completed' }))
    const result = await ctx.orchestrations.run(parent, 'task', [...POOL], new AbortController().signal)
    expect(result.succeeded).toBe(true)
    expect(result.failovers).toBe(1)
    expect(result.steps[0]?.failedOver).toBe(true)
    const attempts = result.steps[0]?.attempts ?? []
    expect(attempts[0]?.stopReason).toBe('error')
    expect(attempts[0]?.diagnostic).toBe('gateway 503')
    expect(attempts[1]?.stopReason).toBe('completed')
  })

  it('fails over a rate-limited attempt to a different route', async () => {
    const { ctx, subagents } = await setup({ maxAttemptsPerStep: 2 })
    subagents.startActivation
      .mockResolvedValueOnce(activation('r', { output: [], stopReason: 'error', diagnostic: 'rate limit exceeded' }))
      .mockResolvedValueOnce(activation('c', { output: [], stopReason: 'completed' }))
    const result = await ctx.orchestrations.run(parent, 'task', [...POOL], new AbortController().signal)
    expect(result.succeeded).toBe(true)
    expect(result.failovers).toBe(1)
    const attempts = result.steps[0]?.attempts ?? []
    // The failed route is not retried: failover excludes tried routes per step.
    expect(attempts[0]?.model).not.toBe(attempts[1]?.model)
    expect(attempts[0]?.diagnostic).toBe('rate limit exceeded')
    expect(attempts[1]?.stopReason).toBe('completed')
  })

  it('fails over a max-tokens attempt to completion', async () => {
    const { ctx, subagents } = await setup({ maxAttemptsPerStep: 2 })
    subagents.startActivation
      .mockResolvedValueOnce(activation('m', { output: [], stopReason: 'max-tokens' }))
      .mockResolvedValueOnce(activation('c', { output: [], stopReason: 'completed' }))
    const result = await ctx.orchestrations.run(parent, 'task', [...POOL], new AbortController().signal)
    expect(result.succeeded).toBe(true)
    expect(result.failovers).toBe(1)
    expect(result.steps[0]?.attempts?.map(a => a.stopReason)).toEqual(['max-tokens', 'completed'])
  })

  it('fails over an aborted attempt to completion', async () => {
    const { ctx, subagents } = await setup({ maxAttemptsPerStep: 2 })
    subagents.startActivation
      .mockResolvedValueOnce(activation('a', { output: [], stopReason: 'aborted' }))
      .mockResolvedValueOnce(activation('c', { output: [], stopReason: 'completed' }))
    const result = await ctx.orchestrations.run(parent, 'task', [...POOL], new AbortController().signal)
    expect(result.succeeded).toBe(true)
    expect(result.failovers).toBe(1)
    expect(result.steps[0]?.attempts?.map(a => a.stopReason)).toEqual(['aborted', 'completed'])
  })

  it('reports a refusal as a settled failure without failover', async () => {
    const { ctx, subagents } = await setup()
    subagents.startActivation.mockResolvedValue(activation('r', { output: [], stopReason: 'refusal' }))
    const result = await ctx.orchestrations.run(parent, 'task', [...POOL], new AbortController().signal)
    expect(result.succeeded).toBe(false)
    expect(result.failedSteps).toBe(1)
    expect(result.failovers).toBe(0)
    expect(result.steps[0]?.failed).toBe(true)
    expect(result.steps[0]?.failedOver).toBe(false)
  })

  it('marks the step aborted when a worker result rejects', async () => {
    const { ctx, subagents } = await setup({ maxAttemptsPerStep: 1 })
    subagents.startActivation.mockResolvedValue({
      childId: SessionId('x'),
      result: Promise.reject(new Error('worker crashed')),
      dispose: () => Promise.resolve(),
    })
    const result = await ctx.orchestrations.run(parent, 'task', [...POOL], new AbortController().signal)
    expect(result.succeeded).toBe(false)
    expect(result.failedSteps).toBe(1)
    expect(result.failovers).toBe(0)
    expect(result.steps[0]?.failedOver).toBe(false)
    const attempt = result.steps[0]?.attempts?.[0]
    expect(attempt?.stopReason).toBe('aborted')
    expect(attempt?.diagnostic).toBe('worker crashed')
  })

  it('stringifies a non-Error worker rejection in the attempt diagnostic', async () => {
    const { ctx, subagents } = await setup({ maxAttemptsPerStep: 1 })
    subagents.startActivation.mockResolvedValue({
      childId: SessionId('x'),
      result: Promise.reject('plain failure'),
      dispose: () => Promise.resolve(),
    })
    const result = await ctx.orchestrations.run(parent, 'task', [...POOL], new AbortController().signal)
    expect(result.steps[0]?.attempts?.[0]?.diagnostic).toBe('plain failure')
  })

  it('does not spawn a replacement worker after caller cancellation', async () => {
    const { ctx, subagents } = await setup({ maxAttemptsPerStep: 2 })
    const controller = new AbortController()
    subagents.startActivation.mockImplementation(async () => {
      controller.abort()
      return activation('a', { output: [], stopReason: 'aborted' })
    })
    const result = await ctx.orchestrations.run(parent, 'task', [...POOL], controller.signal)
    // The caller cancelled on the first attempt, so no replacement worker runs.
    expect(subagents.startActivation).toHaveBeenCalledTimes(1)
    expect(result.failovers).toBe(0)
    expect(result.steps[0]?.failed).toBe(true)
    expect(result.steps[0]?.failedOver).toBe(false)
    expect(result.steps[0]?.attempts).toHaveLength(1)
  })

  it.each([
    new Error('start failed'),
    new SubagentError('delegation denied', 'UNAUTHORIZED'),
    new SubagentError('depth limit reached', 'MAX_DEPTH_EXCEEDED'),
  ])('does not route around a rejected worker creation: %s', async (error) => {
    const { ctx, subagents } = await setup({ maxAttemptsPerStep: 2 })
    subagents.startActivation.mockRejectedValueOnce(error)
    const result = await ctx.orchestrations.run(parent, 'task', [...POOL], new AbortController().signal)
    expect(subagents.startActivation).toHaveBeenCalledOnce()
    expect(result.succeeded).toBe(false)
    expect(result.failovers).toBe(0)
    expect(result.steps[0]?.failedOver).toBe(false)
    expect(result.steps[0]?.attempts).toHaveLength(1)
    expect(result.steps[0]?.attempts[0]?.diagnostic).toBe(error.message)
  })

  it('stops on worker-creation rejection when the caller has cancelled', async () => {
    const { ctx, subagents } = await setup({ maxAttemptsPerStep: 2 })
    const controller = new AbortController()
    subagents.startActivation.mockImplementation(async () => {
      controller.abort()
      throw new Error('start failed after cancel')
    })
    const result = await ctx.orchestrations.run(parent, 'task', [...POOL], controller.signal)
    expect(subagents.startActivation).toHaveBeenCalledTimes(1)
    expect(result.failovers).toBe(0)
    expect(result.steps[0]?.attempts).toHaveLength(1)
  })

  it('stops immediately without spawning when the caller signal is already aborted', async () => {
    const { ctx, subagents } = await setup({ maxAttemptsPerStep: 2 })
    const controller = new AbortController()
    controller.abort()
    const result = await ctx.orchestrations.run(parent, 'task', [...POOL], controller.signal)
    expect(subagents.startActivation).not.toHaveBeenCalled()
    expect(result.failovers).toBe(0)
    expect(result.steps[0]?.failed).toBe(true)
    expect(result.steps[0]?.attempts).toHaveLength(0)
  })

  it('treats a creation rejection on the final attempt as a settled step failure', async () => {
    const { ctx, subagents } = await setup({ maxAttemptsPerStep: 1 })
    subagents.startActivation.mockRejectedValue(new Error('only attempt fails'))
    const result = await ctx.orchestrations.run(parent, 'task', [...POOL], new AbortController().signal)
    expect(result.succeeded).toBe(false)
    expect(result.failovers).toBe(0)
    expect(result.steps[0]?.failed).toBe(true)
    expect(result.steps[0]?.attempts?.[0]?.diagnostic).toBe('only attempt fails')
  })

  it('stringifies a non-Error worker-creation rejection in the attempt diagnostic', async () => {
    const { ctx, subagents } = await setup({ maxAttemptsPerStep: 1 })
    subagents.startActivation.mockRejectedValue('creation exploded')
    const result = await ctx.orchestrations.run(parent, 'task', [...POOL], new AbortController().signal)
    expect(result.steps[0]?.attempts?.[0]?.diagnostic).toBe('creation exploded')
  })

  it('stops on a rejected worker result once the caller has cancelled', async () => {
    const { ctx, subagents } = await setup({ maxAttemptsPerStep: 2 })
    const controller = new AbortController()
    subagents.startActivation.mockImplementation(async () => {
      controller.abort()
      return {
        childId: SessionId('x'),
        result: Promise.reject(new Error('torn down after cancel')),
        dispose: () => Promise.resolve(),
      }
    })
    const result = await ctx.orchestrations.run(parent, 'task', [...POOL], controller.signal)
    expect(subagents.startActivation).toHaveBeenCalledTimes(1)
    expect(result.failovers).toBe(0)
    expect(result.steps[0]?.attempts?.[0]?.stopReason).toBe('aborted')
  })

  it('gives up when no failover route remains', async () => {
    const { ctx, subagents } = await setup({ maxAttemptsPerStep: 2 })
    subagents.startActivation.mockResolvedValue(activation('e', { output: [], stopReason: 'error' }))
    const result = await ctx.orchestrations.run(parent, 'task', [POOL[0]!], new AbortController().signal)
    expect(result.succeeded).toBe(false)
    expect(result.steps[0]?.failed).toBe(true)
    expect(result.steps[0]?.attempts).toHaveLength(1)
    expect(result.steps[0]?.failedOver).toBe(false)
    expect(result.failovers).toBe(0)
  })

  it('counts every replacement route rather than every replaced step', async () => {
    const { ctx, subagents } = await setup({ maxAttemptsPerStep: 3 })
    subagents.startActivation
      .mockResolvedValueOnce(activation('a', { output: [], stopReason: 'error' }))
      .mockResolvedValueOnce(activation('b', { output: [], stopReason: 'error' }))
      .mockResolvedValueOnce(activation('c', { output: [], stopReason: 'completed' }))
    const pool = [...POOL, { provider: 'paderborn', model: 'hs-de.qwen3.8-27b' }]
    const result = await ctx.orchestrations.run(parent, 'task', pool, new AbortController().signal)
    expect(result.succeeded).toBe(true)
    expect(result.steps[0]?.attempts).toHaveLength(3)
    expect(result.steps[0]?.failedOver).toBe(true)
    expect(result.failovers).toBe(2)
  })

  it('settles a worker that outlives its timeout as a failed non-response without hanging', async () => {
    const { ctx, subagents } = await setup({ workerTimeoutMs: 2, maxAttemptsPerStep: 1 })
    const pending = Promise.withResolvers<SubagentResult>()
    const dispose = vi.fn(() => Promise.resolve())
    subagents.startActivation.mockResolvedValue({ childId: SessionId('t'), result: pending.promise, dispose })
    const running = ctx.orchestrations.run(parent, 'task', [...POOL], new AbortController().signal)
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce())
    // A result that settles only after the timeout must be discarded: the attempt
    // already settled as a non-response, so the run must not wait on it.
    pending.resolve({ output: [], stopReason: 'completed' })
    const result = await running
    expect(result.succeeded).toBe(false)
    expect(result.failedSteps).toBe(1)
    const attempt = result.steps[0]?.attempts?.[0]
    expect(attempt?.stopReason).toBe('aborted')
    expect(attempt?.diagnostic).toMatch(/did not settle within 2ms/)
    expect(result.steps[0]?.failedOver).toBe(false)
  })

  it('fails over to the next route when a worker times out and a budgeted attempt remains', async () => {
    const { ctx, subagents } = await setup({ workerTimeoutMs: 2, maxAttemptsPerStep: 2 })
    const pending = Promise.withResolvers<SubagentResult>()
    const firstDispose = vi.fn(() => Promise.resolve())
    subagents.startActivation
      .mockResolvedValueOnce({ childId: SessionId('a'), result: pending.promise, dispose: firstDispose })
      .mockResolvedValueOnce(activation('b', { output: [], stopReason: 'completed' }))
    const running = ctx.orchestrations.run(parent, 'task', [...POOL], new AbortController().signal)
    // The first worker times out (its dispose fires), so the loop moves to a replacement route.
    await vi.waitFor(() => expect(firstDispose).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(subagents.startActivation).toHaveBeenCalledTimes(2))
    const result = await running
    expect(result.succeeded).toBe(true)
    expect(result.steps[0]?.attempts).toHaveLength(2)
    expect(result.steps[0]?.failedOver).toBe(true)
    expect(result.failovers).toBe(1)
  })

  it('swallows a rejecting dispose after a worker timeout instead of leaking an unhandled rejection', async () => {
    const { ctx, subagents } = await setup({ workerTimeoutMs: 2, maxAttemptsPerStep: 1 })
    const pending = Promise.withResolvers<SubagentResult>()
    const dispose = vi.fn(() => Promise.reject(new Error('dispose exploded')))
    subagents.startActivation.mockResolvedValue({ childId: SessionId('d'), result: pending.promise, dispose })
    const warn = vi.spyOn(ctx.logger, 'warn')
    const running = ctx.orchestrations.run(parent, 'task', [...POOL], new AbortController().signal)
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce())
    const result = await running
    expect(result.succeeded).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('worker dispose after timeout rejected'), expect.anything())
  })

  it('rejects when the coordinator returns no steps', async () => {
    const { ctx, service } = await setup()
    vi.spyOn(service as unknown as { plan(...args: never[]): Promise<unknown> }, 'plan').mockResolvedValue([])
    await expect(ctx.orchestrations.run(parent, 'task', [...POOL], new AbortController().signal))
      .rejects.toThrow('coordinator returned an empty plan')
  })

  it('bounds concurrency with one running worker at a time', async () => {
    const { ctx, subagents, llm } = await setup({ maxConcurrency: 1 })
    const pending = Promise.withResolvers<SubagentResult>()
    const dispose = vi.fn(() => Promise.resolve())
    subagents.startActivation
      .mockResolvedValueOnce({ childId: SessionId('a'), result: pending.promise, dispose })
      .mockResolvedValueOnce(activation('b', { output: [], stopReason: 'completed' }))
    llm.stream.mockImplementation(() => asyncIterable(twoStepPlan()))
    const running = ctx.orchestrations.run(parent, 'task', [...POOL], new AbortController().signal)
    await vi.waitFor(() => expect(subagents.startActivation).toHaveBeenCalledTimes(1))
    pending.resolve({ output: [], stopReason: 'completed' })
    const result = await running
    expect(result.steps).toHaveLength(2)
    expect(result.steps.every(s => !s.failed)).toBe(true)
  })

  it('guards plan against an empty pool', async () => {
    const { service } = await setup()
    await expect((service as unknown as { plan(parent: never, task: string, routes: readonly never[], signal: AbortSignal): Promise<unknown> }).plan(parent, 'task', [], new AbortController().signal))
      .rejects.toThrow('orchestration pool is empty')
  })

  it('fails loud when the parent agent has no selected model', async () => {
    const { service } = await setup()
    const noSelection = { id: 'parent-no-model', model: { current: () => undefined } } as never
    await expect((service as unknown as { plan(parent: never, task: string, routes: readonly never[], signal: AbortSignal): Promise<unknown> }).plan(noSelection, 'task', [{} as never], new AbortController().signal))
      .rejects.toThrow('parent agent "parent-no-model" has no selected provider/model')
  })
})

describe('OrchestrationService mode', () => {
  it('defaults orchestration mode off and records each per-Agent selection as a logged session event', async () => {
    const { service, ctx } = await setup()
    const agent = await makeAgent(ctx)
    expect(service.modeOf(agent)).toBe(false)
    service.setMode(agent, true)
    expect(service.modeOf(agent)).toBe(true)
    expect(service.modeOf(agent)).toBe(true)
    service.setMode(agent, false)
    expect(service.modeOf(agent)).toBe(false)
  })

  it('isolates the orchestration selection per Agent session', async () => {
    const { service, ctx } = await setup()
    const agent = await makeAgent(ctx, 'mode-1')
    const other = await makeAgent(ctx, 'mode-2')
    service.setMode(agent, true)
    expect(service.modeOf(agent)).toBe(true)
    expect(service.modeOf(other)).toBe(false)
  })

  it('seeds orchestration mode from defaultToOrchestrator but lets an explicit selection win', async () => {
    const { service, ctx } = await setup({ defaultToOrchestrator: true })
    const agent = await makeAgent(ctx, 'mode-seed')
    expect(service.modeOf(agent)).toBe(true)
    service.setMode(agent, false)
    expect(service.modeOf(agent)).toBe(false)
  })

  it('propagates a failed durable session append and does not change the selected mode', async () => {
    const { service, ctx } = await setup()
    const agent = await makeAgent(ctx, 'mode-append')
    const append = vi.spyOn(agent.session, 'append').mockImplementationOnce(() => { throw new Error('append failed') })
    expect(() => service.setMode(agent, true)).toThrow('append failed')
    expect(service.modeOf(agent)).toBe(false)
    append.mockRestore()
  })

  it('recovers the logged mode through a freshly registered projection after restart', async () => {
    const { service, ctx } = await setup()
    const agent = await makeAgent(ctx, 'mode-recover')
    service.setMode(agent, true)
    expect(service.modeOf(agent)).toBe(true)
    // A fresh registry over the same log (the cold restart shape).
    const cold = await setup()
    const coldAgent = await makeAgent(cold.ctx, 'mode-recover-cold')
    for (const event of agent.session.snapshotEvents()) {
      if (event.type === 'orchestration/mode') coldAgent.session.append('orchestration/mode', event.data)
    }
    expect(cold.service.modeOf(coldAgent)).toBe(true)
  })

  it('select commits immediately between turns and returns committed', async () => {
    const { service, ctx } = await setup()
    const agent = await makeAgent(ctx, 'select-commit')
    expect(service.select(agent, true)).toBe('committed')
    expect(service.modeOf(agent)).toBe(true)
    expect(service.select(agent, false)).toBe('committed')
    expect(service.modeOf(agent)).toBe(false)
  })

  it('select returns noop for the already-selected state', async () => {
    const { service, ctx } = await setup()
    const agent = await makeAgent(ctx, 'select-noop')
    expect(service.select(agent, false)).toBe('noop')
    service.setMode(agent, true)
    expect(service.select(agent, true)).toBe('noop')
  })

  it('queues a mid-turn selection and clears a cancelled opposite pending intent', async () => {
    const { service, ctx } = await setup()
    const agent = await makeAgent(ctx, 'select-queued')
    openTurn(agent.session)
    expect(service.select(agent, true)).toBe('queued')
    expect(service.modeOf(agent)).toBe(false)
    // Reversing a pending intent while the logged state still matches the new
    // target is a cancellation, not a commit.
    expect(service.select(agent, false)).toBe('cancelled')
  })

  it('a queued mid-turn selection exposes pending through an actual command invocation', async () => {
    const { service, ctx } = await setup()
    const agent = await makeAgent(ctx, 'select-pending')
    openTurn(agent.session)
    expect(service.select(agent, true)).toBe('queued')
    expect(service.modeOf(agent)).toBe(false)
    // The logged `/orchestration` lifecycle is what drives the projection pending
    // wire value; an in-memory queued select alone does not append an event.
    const commandId = CommandId('queued-cmd')
    agent.session.append('command/run', {
      commandId,
      name: 'orchestration',
      args: 'on',
      source: { kind: 'user' },
    })
    expect(ctx.sessionProjections.snapshot(agent.session).values.orchestration).toEqual({ active: false, pending: true })
    agent.session.append('command/done', { commandId, kind: 'success' })
    expect(ctx.sessionProjections.snapshot(agent.session).values.orchestration).toEqual({ active: false, pending: true })
  })

  it('setMode queues a mid-turn selection without committing it', async () => {
    const { service, ctx } = await setup()
    const agent = await makeAgent(ctx, 'setmode-turn')
    openTurn(agent.session)
    service.setMode(agent, true)
    expect(service.modeOf(agent)).toBe(false)
    expect(ctx.sessionProjections.snapshot(agent.session).values.orchestration).toEqual({ active: false, pending: false })
  })

  it('cancels a between-turns reversal of a queued pending intent without logging', async () => {
    const { service, ctx } = await setup()
    const agent = await makeAgent(ctx, 'select-cancel-noopenturn')
    openTurn(agent.session)
    expect(service.select(agent, true)).toBe('queued')
    agent.session.append('turn/end', { turn: 0, reason: { kind: 'completed' } })
    expect(service.select(agent, false)).toBe('cancelled')
    expect(ctx.sessionProjections.snapshot(agent.session).values.orchestration).toEqual({ active: false, pending: false })
  })
})

describe('/orchestration command', () => {
  async function commandSetup() {
    const { ctx, service } = await setup()
    await ctx.plugin(CommandRuntime)
    // The `ctx.inject` child mounts asynchronously once `commands` resolves.
    await new Promise(resolve => setImmediate(resolve))
    return { ctx, service }
  }

  it('registers only when a commands service is composed', async () => {
    const bare = await setup()
    expect(bare.ctx.get('commands')).toBeUndefined()
    const { ctx } = await commandSetup()
    const agent = await makeAgent(ctx, 'cmd-list')
    expect(ctx.commands.list(agent).map(command => command.name)).toEqual(['orchestration'])
  })

  it('turns mode on with committed text and off with its own text', async () => {
    const { ctx } = await commandSetup()
    const agent = await makeAgent(ctx, 'cmd-on')
    const signal = new AbortController().signal
    expect((await ctx.commands.execute(agent, '/orchestration on', [], signal))?.result)
      .toEqual({ kind: 'success', text: 'Orchestration mode on. Use /orchestration off to leave.' })
    expect(ctx.orchestrations.modeOf(agent)).toBe(true)
    // Off on an active session commits.
    expect((await ctx.commands.execute(agent, '/orchestration off', [], signal))?.result)
      .toEqual({ kind: 'success', text: 'Orchestration mode off.' })
    expect(ctx.orchestrations.modeOf(agent)).toBe(false)
  })

  it('responds idempotently to an already-inactive off and to an active on', async () => {
    const { ctx } = await commandSetup()
    const signal = new AbortController().signal
    const inactive = await makeAgent(ctx, 'cmd-idle')
    expect((await ctx.commands.execute(inactive, '/orchestration off', [], signal))?.result)
      .toEqual({ kind: 'success', text: 'Orchestration mode is already inactive.' })
    const active = await makeAgent(ctx, 'cmd-active')
    ctx.orchestrations.setMode(active, true)
    expect((await ctx.commands.execute(active, '/orchestration on', [], signal))?.result)
      .toEqual({ kind: 'success', text: 'Orchestration mode is already on.' })
  })

  it('queues mid-turn selections through the command', async () => {
    const { ctx } = await commandSetup()
    const signal = new AbortController().signal
    const entering = await makeAgent(ctx, 'cmd-enter')
    openTurn(entering.session)
    expect((await ctx.commands.execute(entering, '/orchestration on', [], signal))?.result)
      .toEqual({ kind: 'success', text: 'Entering orchestration mode (applies from the next step).' })
    expect(ctx.orchestrations.modeOf(entering)).toBe(false)
    const leaving = await makeAgent(ctx, 'cmd-leave')
    ctx.orchestrations.setMode(leaving, true)
    openTurn(leaving.session)
    expect((await ctx.commands.execute(leaving, '/orchestration off', [], signal))?.result)
      .toEqual({ kind: 'success', text: 'Leaving orchestration mode (applies from the next step).' })
  })

  it('cancels a reversed pending entry through the command', async () => {
    const { ctx } = await commandSetup()
    const signal = new AbortController().signal
    const agent = await makeAgent(ctx, 'cmd-cancel')
    openTurn(agent.session)
    await ctx.commands.execute(agent, '/orchestration on', [], signal)
    expect((await ctx.commands.execute(agent, '/orchestration off', [], signal))?.result)
      .toEqual({ kind: 'success', text: 'Orchestration mode selection cancelled.' })
    expect(ctx.orchestrations.modeOf(agent)).toBe(false)
  })

  it('rejects an invalid argument with the usage error', async () => {
    const { ctx } = await commandSetup()
    const agent = await makeAgent(ctx, 'cmd-invalid')
    const signal = new AbortController().signal
    expect((await ctx.commands.execute(agent, '/orchestration maybe', [], signal))?.result)
      .toEqual({ kind: 'error', text: 'Usage: /orchestration on|off' })
  })

  it('treats a bare /orchestration as turning mode on', async () => {
    const { ctx } = await commandSetup()
    const agent = await makeAgent(ctx, 'cmd-bare')
    const signal = new AbortController().signal
    expect((await ctx.commands.execute(agent, '/orchestration', [], signal))?.result)
      .toEqual({ kind: 'success', text: 'Orchestration mode on. Use /orchestration off to leave.' })
    expect(ctx.orchestrations.modeOf(agent)).toBe(true)
  })
})
