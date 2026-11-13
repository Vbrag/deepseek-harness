import { describe, expect, it, vi, type Mock } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { OrchestrationResult } from '@deepseek-ai/dsh-orchestration'
import { apply, Config, EMPTY_POOL_ERROR, MODE_INACTIVE_ERROR, inject, name } from '../src/index.ts'

type Exec = { agent?: Agent; signal: AbortSignal }
type Pool = { provider: string; model: string }

/** The minimal tool surface the plugin ships: an execute body plus a JSON-output renderer. */
type InstalledTool = {
  execute: (args: unknown, exec: Exec) => Promise<unknown>
  output: { render: (a: unknown, v: unknown) => unknown[] }
}

const SIGNAL = new AbortController().signal

/** A minimal Agent exposing only `ctx.tools.register`, capturing one tool. */
function fakeAgent(id: string) {
  let disposed = false
  const holder = { tool: undefined as InstalledTool | undefined }
  const agent = {
    id,
    ctx: {
      tools: {
        register: vi.fn((tool: InstalledTool) => {
          holder.tool = tool
          return () => { disposed = true }
        }),
      },
    },
  }
  return {
    agent: agent as never,
    tool: () => holder.tool,
    register: agent.ctx.tools.register as ReturnType<typeof vi.fn>,
    get disposed() { return disposed },
  }
}

/** A fully mocked `apply` Context capturing event listeners and the teardown. */
function fakeContext(agents: Agent[], seed: { provider: string; model: string }[] = []) {
  const listeners: Record<string, (payload: { agent: Agent }) => void> = {}
  let teardown: (() => void) | undefined
  let servicePool: Pool[] = [...seed]
  const getPool = vi.fn((): Pool[] => servicePool) as Mock<() => Pool[]>
  const setPool = vi.fn((pool: Pool[]) => { servicePool = [...pool] }) as Mock<(pool: Pool[]) => void>
  const modeOf = vi.fn((_agent: Agent) => true) as Mock<(agent: Agent) => boolean>
  const ctx = {
    agents: { list: vi.fn(() => agents) },
    orchestrations: { run: vi.fn(), getPool, setPool, modeOf },
    on: vi.fn((event: string, listener: (payload: { agent: Agent }) => void) => { listeners[event] = listener }),
    effect: vi.fn((callback: () => () => void) => { teardown = callback() }),
  }
  return {
    ctx: ctx as never,
    run: ctx.orchestrations.run as ReturnType<typeof vi.fn>,
    setPool,
    getPool,
    modeOf,
    list: ctx.agents.list as ReturnType<typeof vi.fn>,
    created(agent: Agent) { listeners['agent/created']?.({ agent }) },
    disposed(agent: Agent) { listeners['agent/disposed']?.({ agent }) },
    dispose() { teardown?.() },
  }
}

const completedStep = {
  step: { id: 's-complete', description: 'do the docs', requiredDomains: ['docs'] },
  attempts: [{ stepId: 's-complete', provider: 'p1', model: 'm1', stopReason: 'completed' }],
  output: [{ type: 'text', text: 'docs done' }],
  failed: false,
  failedOver: false,
}

const failedStep = {
  step: { id: 's-failed', description: 'do the code', requiredDomains: ['coding'] },
  attempts: [
    { stepId: 's-failed', provider: 'p1', model: 'm1', stopReason: 'error', diagnostic: 'boom' },
    { stepId: 's-failed', provider: 'p2', model: 'm2', stopReason: 'error', diagnostic: 'boom' },
  ],
  output: [],
  failed: true,
  failedOver: true,
}

const unroutedStep = {
  step: { id: 's-unrouted', description: 'do the plan', requiredDomains: ['planning'] },
  attempts: [],
  output: [],
  failed: false,
  failedOver: false,
}

function resultOf(): OrchestrationResult {
  return {
    succeeded: false,
    failovers: 1,
    failedSteps: 1,
    steps: [completedStep as never, failedStep as never, unroutedStep as never],
  } as OrchestrationResult
}

function installTool(pool: { provider: string; model: string }[]) {
  const agent = fakeAgent('a')
  const ctx = fakeContext([agent.agent])
  apply(ctx.ctx, { pool })
  return { agent, ...ctx }
}

describe('tool-orchestration function plugin', () => {
  it('exposes the plugin export surface', () => {
    expect(name).toBe('tool-orchestration')
    expect(inject).toEqual(['agents', 'orchestrations', 'tools'])
    expect(Config).toBeDefined()
    expect(EMPTY_POOL_ERROR).toMatch(/^run_orchestration: the Orchestration pool is empty/)
    expect(MODE_INACTIVE_ERROR).toMatch(/^run_orchestration: Orchestration mode is not active/)
  })

  it('validates the pool config, defaulting to an empty list', () => {
    expect(Config({} as never).pool).toEqual([])
    expect(Config({ pool: [{ provider: 'p', model: 'm' }] } as never).pool).toEqual([{ provider: 'p', model: 'm' }])
  })

  it('installs a tool per live agent, deduplicating agent/created', () => {
    const a = fakeAgent('a')
    const b = fakeAgent('b')
    const c = fakeAgent('c')
    const ctx = fakeContext([a.agent, b.agent])
    apply(ctx.ctx, { pool: [] })

    expect(a.tool()).toBeDefined()
    expect(b.tool()).toBeDefined()

    // A duplicate create for an installed agent does not reinstall.
    const callsBefore = a.register.mock.calls.length
    ctx.created(a.agent)
    expect(a.register).toHaveBeenCalledTimes(callsBefore)

    ctx.created(c.agent)
    expect(c.tool()).toBeDefined()
  })

  it('disposes and forgets an agent on agent/disposed', () => {
    const a = fakeAgent('a')
    const b = fakeAgent('b')
    const ctx = fakeContext([a.agent, b.agent])
    apply(ctx.ctx, { pool: [] })
    expect(a.disposed).toBe(false)

    ctx.disposed(a.agent)
    expect(a.disposed).toBe(true)

    ctx.disposed(b.agent)
    expect(b.disposed).toBe(true)
  })

  it('disposes every scoped tool on effect teardown', () => {
    const a = fakeAgent('a')
    const b = fakeAgent('b')
    const ctx = fakeContext([a.agent, b.agent])
    apply(ctx.ctx, { pool: [] })
    expect(ctx.list).toHaveBeenCalledOnce()
    expect(a.disposed).toBe(false)
    expect(b.disposed).toBe(false)

    ctx.dispose()
    expect(a.disposed).toBe(true)
    expect(b.disposed).toBe(true)
  })

  it('rethrows when scoped tool registration fails', () => {
    const agent = fakeAgent('a')
    agent.register.mockImplementation(() => { throw new Error('boom') })
    const ctx = fakeContext([agent.agent])
    expect(() => apply(ctx.ctx, { pool: [] })).toThrow('boom')
  })

  it('throws the pool error when execute runs with an empty pool', async () => {
    const { agent } = installTool([])
    await expect(agent.tool()!.execute({ task: 'x' }, { agent: agent.agent, signal: SIGNAL }))
      .rejects.toThrow(EMPTY_POOL_ERROR)
  })

  it('refuses to delegate when the session is not in Orchestration mode', async () => {
    const { agent, modeOf, run } = installTool([{ provider: 'p1', model: 'm1' }])
    modeOf.mockReturnValue(false)
    await expect(agent.tool()!.execute({ task: 'x' }, { agent: agent.agent, signal: SIGNAL }))
      .rejects.toThrow(MODE_INACTIVE_ERROR)
    expect(run).not.toHaveBeenCalled()
  })

  it('runs the orchestration and maps the full result', async () => {
    const { agent, run } = installTool([{ provider: 'p1', model: 'm1' }])
    run.mockResolvedValue(resultOf())
    const value = await agent.tool()!.execute({ task: 'do work' }, { agent: agent.agent, signal: SIGNAL })

    expect(run).toHaveBeenCalledWith(agent.agent, 'do work', [{ provider: 'p1', model: 'm1' }], SIGNAL)
    expect(value).toEqual({
      succeeded: false,
      failovers: 1,
      failedSteps: 1,
      steps: [
        {
          id: 's-complete',
          description: 'do the docs',
          status: 'completed',
          failedOver: false,
          domains: ['docs'],
          output: 'docs done',
          route: { provider: 'p1', model: 'm1' },
        },
        {
          id: 's-failed',
          description: 'do the code',
          status: 'failed',
          failedOver: true,
          domains: ['coding'],
          route: { provider: 'p2', model: 'm2' },
        },
        {
          id: 's-unrouted',
          description: 'do the plan',
          status: 'completed',
          failedOver: false,
          domains: ['planning'],
          route: { provider: 'unknown', model: 'unknown' },
        },
      ],
    })
  })

  it('renders the canonical output schema as compact JSON', async () => {
    const { agent } = installTool([{ provider: 'p1', model: 'm1' }])
    const tool = agent.tool()!
    const value = { succeeded: true, steps: [], failovers: 0, failedSteps: 0 }
    const rendered = tool.output.render({}, value)
    expect(rendered).toEqual([{ type: 'text', text: JSON.stringify(value) }])
  })

  it('seeds the service pool from config only when the service pool is empty', () => {
    const a = fakeAgent('a')
    const ctx = fakeContext([a.agent])
    apply(ctx.ctx, { pool: [{ provider: 'p1', model: 'm1' }] })
    expect(ctx.getPool()).toEqual([{ provider: 'p1', model: 'm1' }])
  })

  it('does not overwrite an existing service pool when seeding', () => {
    const a = fakeAgent('a')
    const ctx = fakeContext([a.agent], [{ provider: 'gui', model: 'g1' }])
    apply(ctx.ctx, { pool: [{ provider: 'p1', model: 'm1' }] })
    expect(ctx.getPool()).toEqual([{ provider: 'gui', model: 'g1' }])
  })

  it('executes against the selected service pool, not the config seed', async () => {
    const a = fakeAgent('a')
    const ctx = fakeContext([a.agent])
    apply(ctx.ctx, { pool: [{ provider: 'p1', model: 'm1' }] })
    // A GUI selection later replaces the seed; execution must honor it.
    ctx.setPool([{ provider: 'gui', model: 'g2' }])
    ctx.run.mockResolvedValue(resultOf())
    const value = await a.tool()!.execute({ task: 't' }, { agent: a.agent, signal: SIGNAL })
    expect(ctx.run).toHaveBeenCalledWith(a.agent, 't', [{ provider: 'gui', model: 'g2' }], SIGNAL)
    expect(value).toEqual(expect.any(Object))
  })

  it('rejects when no calling agent is supplied', async () => {
    const { agent } = installTool([{ provider: 'p1', model: 'm1' }])
    await expect(agent.tool()!.execute({ task: 'x' }, { signal: SIGNAL }))
      .rejects.toThrow('run_orchestration requires a calling Agent')
  })

  it('passes a defined calling agent through to the orchestration service', async () => {
    const { agent, run } = installTool([{ provider: 'p1', model: 'm1' }])
    run.mockResolvedValue(resultOf())
    const value = await agent.tool()!.execute({ task: 't' }, { agent: agent.agent, signal: SIGNAL })
    expect(run).toHaveBeenCalledWith(agent.agent, 't', expect.any(Array), SIGNAL)
    expect(value).toEqual(expect.any(Object))
  })
})
