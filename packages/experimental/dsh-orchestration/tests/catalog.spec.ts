/** The pool picker catalog is projected from the live LLM registry, not a static list. */
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LlmAdapter, type LlmModelInfo, type LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as SpawnInProcess from '@deepseek-ai/dsh-subagent-spawn-in-process'
import SubagentModelSelectionConfig from '@deepseek-ai/dsh-tool-subagent/model-selection-settings'
import OrchestrationService from '../src/index.ts'
import { POOL_PROVIDER } from '../src/capabilities.ts'
import type { PoolRoute } from '../src/types.ts'

class CatalogAdapter extends LlmAdapter {
  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(provider === POOL_PROVIDER ? [
      { provider, id: 'gwdg.deepseek-v4-flash-0731', name: 'DeepSeek V4 Flash 0731' },
    ] : [
      { provider, id: 'lead', name: 'Lead model' },
      { provider, id: 'billing-disabled', name: 'Billing disabled' },
    ])
  }
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider, id: model, name: model,
      ...model === 'gwdg.deepseek-v4-flash-0731'
        ? { inputModalities: ['text' as const], context: { contextWindow: 1_000_000 }, reasoning: { efforts: [{ id: 'standard' as import('@deepseek-ai/dsh-llm').ReasoningEffortId, name: 'Standard' }] } }
        : model === 'lead'
          ? { inputModalities: ['text' as const], context: { contextWindow: 50_000 } }
          : { inputModalities: ['text' as const, 'image' as const], context: { contextWindow: 50_000 } },
    })
  }
  override queueAvailability(): Promise<{ kind: 'ready' }> {
    return Promise.resolve({ kind: 'ready' })
  }
  override async *stream(): AsyncGenerator<never> { /* unused */ }
}

const pool: readonly PoolRoute[] = [{ provider: POOL_PROVIDER, model: 'gwdg.deepseek-v4-flash-0731' }]
async function fixture() {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SubagentModelSelectionConfig, { enabled: false, allowedModels: [] })
  await ctx.plugin(SpawnInProcess, { providerName: 'spawn' })
  ctx.llm.registerAdapter(['mock', POOL_PROVIDER], new CatalogAdapter())
  const register = vi.spyOn(ctx.subagents, 'registerModelRouter')
  await ctx.plugin(OrchestrationService, { pool: [...pool] })
  const router = register.mock.calls[0]?.[0]
  if (router === undefined) throw new Error('router registration missing')
  return { ctx, service: ctx.orchestrations, router }
}

describe('pool picker catalog', () => {
  it('projects every registered provider/model from the live LLM registry', async () => {
    const { ctx, service } = await fixture()
    const catalog = await service.getCatalog()
    const providers = catalog.groups.map(group => group.provider).sort()
    expect(providers).toEqual(['mock', POOL_PROVIDER].sort())
    const mock = catalog.groups.find(group => group.provider === 'mock')
    expect(mock?.models.map(model => model.id)).toContain('lead')
    expect(mock?.models[0]?.offlineCurated).toBe(false)
    ctx.fiber.dispose()
  })

  it('annotates known Paderborn routes with curated facts and keeps live capacity', async () => {
    const { ctx, service } = await fixture()
    const catalog = await service.getCatalog()
    const group = catalog.groups.find(entry => entry.provider === POOL_PROVIDER)
    const row = group?.models.find(model => model.id === 'gwdg.deepseek-v4-flash-0731')
    expect(row?.offlineCurated).toBe(true)
    expect(row?.domains).toContain('coding')
    // Live adapter capacity wins over the curated table where both are present.
    expect(row?.contextWindow).toBe(1_000_000)
    ctx.fiber.dispose()
  })

  it('drops provider groups that fail to list models', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(SpawnInProcess, { providerName: 'spawn' })
    const broken = new CatalogAdapter()
    broken.listModels = () => Promise.reject(new Error('no models'))
    ctx.llm.registerAdapter(['mock'], broken)
    const register = vi.spyOn(ctx.subagents, 'registerModelRouter')
    await ctx.plugin(OrchestrationService, { pool: [] })
    if (register.mock.calls[0]?.[0] === undefined) throw new Error('router registration missing')
    const catalog = await ctx.orchestrations.getCatalog()
    expect(catalog.groups).toEqual([])
    ctx.fiber.dispose()
  })
})
