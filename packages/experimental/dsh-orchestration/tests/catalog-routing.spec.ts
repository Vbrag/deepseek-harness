import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LlmAdapter, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { pluginRecordOf, SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime, { type SubagentTaskAssessment } from '@deepseek-ai/dsh-subagent'
import SubagentModelSelectionConfig from '@deepseek-ai/dsh-tool-subagent/model-selection-settings'
import OrchestrationService from '../src/index.ts'
import { capabilityOf, POOL_PROVIDER } from '../src/capabilities.ts'

const catalogPool = [
  { model: 'gwdg.deepseek-v4-flash-0731', contextWindow: 1_000_000 },
  { model: 'gwdg.glm-5.3-flash', contextWindow: 200_000 },
  { model: 'hs-de.qwen3.8-27b', contextWindow: 262_000 },
  { model: 'gwdg.gemma-4-31b-it', contextWindow: 256_000 },
  { model: 'hs-de.openai-gpt-oss-120b', contextWindow: 128_000 },
]
const pool = catalogPool.map(({ model }) => ({ provider: POOL_PROVIDER, model }))
const qualifiedModels = catalogPool.slice(0, 3).map(({ model }) => model)
const assessment: SubagentTaskAssessment = {
  requiredCapabilities: ['coding', 'reasoning'], requiredModalities: ['text'],
  contextTokens: 90_000, outputTokens: 8000,
}

class CatalogAdapter extends LlmAdapter {
  lookup: (() => Promise<void>) | undefined
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    await this.lookup?.()
    return { provider, id: model, name: model }
  }
  override async *stream(): AsyncIterable<StreamChunk> {
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function fixture() {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SubagentModelSelectionConfig, { enabled: false, allowedModels: [] })
  const adapter = new CatalogAdapter()
  ctx.llm.registerAdapter([POOL_PROVIDER], adapter)
  const register = vi.spyOn(ctx.subagents, 'registerModelRouter')
  await ctx.plugin(OrchestrationService, { pool })
  const router = register.mock.calls[0]?.[0]
  if (router === undefined) throw new Error('router registration missing')
  const parent = (await ctx.agents.create({
    sessionId: SessionId('catalog-parent'), agentOptions: pool[0]!,
  })).agent
  parent.session.append('subagent/model-selection-policy', { allowedModels: pool })
  ctx.orchestrations.setMode(parent, true)
  let child = 0
  const resolve = async (taskAssessment = assessment) => {
    const route = await router.resolve({
      parent, childId: SessionId('catalog-child-' + String(++child)),
      prompt: [{ type: 'text', text: 'implement the parser' }], taskAssessment,
      agentOptions: pool[0]!, signal: new AbortController().signal,
    })
    if (route === undefined) throw new Error('router did not return an admission snapshot')
    onTestFinished(() => { route.release?.() })
    return route
  }
  return { adapter, parent, resolve }
}

describe('permitted gateway catalog routing', () => {
  it('reserves three distinct coding and reasoning models while metadata lookups overlap', async () => {
    const f = await fixture()
    expect(catalogPool.map(({ model }) => capabilityOf(model)?.contextWindow))
      .toEqual(catalogPool.map(({ contextWindow }) => contextWindow))
    expect(capabilityOf('gwdg.glm-5.3-flash')?.reasoning).toBe(false)
    const entered = Promise.withResolvers<undefined>()
    const gate = Promise.withResolvers<undefined>()
    let lookups = 0
    f.adapter.lookup = async () => {
      if (++lookups === pool.length * 3) entered.resolve(undefined)
      await gate.promise
    }
    const starts = [f.resolve(), f.resolve(), f.resolve()]
    try {
      await entered.promise
      gate.resolve(undefined)
      const routes = await Promise.all(starts)
      expect(new Set(routes.map(route => route.agentOptions?.model))).toEqual(new Set(qualifiedModels))
      const records = f.parent.session.snapshotEvents().map(pluginRecordOf)
        .filter(record => record?.type === 'plugin:orchestration/route')
      expect(records).toHaveLength(3)
      for (const record of records) {
        expect(record?.data).toMatchObject({
          eligibleCount: 3, selectedLoad: 0, inputTokens: 98_192, outputTokens: 8000,
        })
        expect(record?.data).toHaveProperty('alternatives', expect.arrayContaining([
          expect.objectContaining({ model: 'gwdg.gemma-4-31b-it', exclusions: ['missing-required-capability'] }),
          expect.objectContaining({ model: 'hs-de.openai-gpt-oss-120b', exclusions: ['missing-required-capability'] }),
        ]))
      }
    } finally {
      gate.resolve(undefined)
      const settled = await Promise.allSettled(starts)
      for (const item of settled) if (item.status === 'fulfilled') item.value.release?.()
    }
  })

  it('chooses another capable model while Qwen retains five active reservations', async () => {
    const f = await fixture()
    const visionAssessment = {
      ...assessment, requiredCapabilities: ['coding', 'reasoning', 'vision'], requiredModalities: ['text', 'image'],
    }
    const qwen = await Promise.all(Array.from({ length: 5 }, () => f.resolve(visionAssessment)))
    expect(qwen.map(route => route.agentOptions?.model)).toEqual(Array(5).fill('hs-de.qwen3.8-27b'))
    const selected = await f.resolve()
    expect(['gwdg.deepseek-v4-flash-0731', 'gwdg.glm-5.3-flash']).toContain(selected.agentOptions?.model)
    const record = f.parent.session.snapshotEvents().map(pluginRecordOf)
      .findLast(item => item?.type === 'plugin:orchestration/route')
    expect(record?.data).toMatchObject({
      eligibleCount: 3, selectedLoad: 0,
    })
    expect(record?.data).toHaveProperty('alternatives', expect.arrayContaining([
      expect.objectContaining({ model: 'hs-de.qwen3.8-27b', activeAssignments: 5, exclusions: [] }),
    ]))
  })
})
