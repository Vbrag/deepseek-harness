/** Profile defaults must reach the compaction scope declared by the shipped Web preset. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'
import * as yaml from 'js-yaml'
import { Context } from '@deepseek-ai/cordis'
import Loader, { type EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import Group from '@deepseek-ai/cordis-plugin-group'
import Include, { parseEntryYaml } from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import BasicCompactionEngine, { type BasicCompactionConfig } from '@deepseek-ai/dsh-compaction-basic'
import * as defaultsPlugin from '../src/index.ts'

async function profileDefaults(): Promise<defaultsPlugin.Config> {
  const patches = yaml.load(await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')) as {
    insert?: { id: string; config: defaultsPlugin.Config }[]
  }[]
  const config = patches.flatMap(patch => patch.insert ?? []).find(entry => entry.id === 'orchestration-compaction-defaults')?.config
  if (config === undefined) throw new Error('Missing shipped compaction defaults')
  return config
}

async function mountWebCompaction(overrides: BasicCompactionConfig = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-profile-compaction-'))
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjections)
  await ctx.plugin(TokenMeter)
  const defaults = await ctx.plugin(defaultsPlugin, await profileDefaults())
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.builtins.group = Group
  ctx.loader.builtins['compaction-basic'] = BasicCompactionEngine
  const declarations = parseEntryYaml(await readFile(new URL('../../../bundle/web-app/presets/standard.patch.yml', import.meta.url), 'utf8')) as {
    insert: { config: { plugins: EntryOptions[] } }[]
  }[]
  const group = declarations[0]?.insert[0]?.config.plugins.find(entry => entry.id === 'compaction')
  if (group === undefined || !Array.isArray(group.config)) throw new Error('Missing shipped Web compaction group')
  const basic = (group.config as EntryOptions[]).find(entry => entry.id === 'compaction-basic')
  if (basic === undefined) throw new Error('Missing shipped Web compaction provider')
  const path = join(root, 'cordis.yml')
  await writeFile(path, yaml.dump([{ ...group, config: [{ ...basic, name: 'cordis:compaction-basic', config: { auto: false, ...overrides } }] }]))
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(path).href } })
  await ctx.loader.await()
  const entry = [...ctx.loader.entries()].find(item => item.options.id === 'compaction-basic')
  const provider = entry?.fiber?.ctx.get('compaction')
  if (!(provider instanceof BasicCompactionEngine)) {
    throw new Error(`Web compaction provider did not activate: ${JSON.stringify([...ctx.loader.entries()].map(item => ({
      id: item.options.id, name: item.options.name, state: item.fiber?.state,
    })))}`)
  }
  return { ctx, provider, defaults }
}

describe('scoped Web compaction defaults', () => {
  it.each([
    { modelPolicies: [{ provider: 'p', model: 'm', headroomTokens: -1 }] },
    { modelPolicies: [{ provider: 'p', model: 'm', maxTokens: 0 }] },
    { modelPolicies: [{ provider: 'p', model: 'm' }, { provider: 'p', model: 'm' }] },
  ])('rejects invalid profile defaults: %j', async (config) => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await expect(ctx.plugin(defaultsPlugin, config)).rejects.toThrow()
  })

  it.each([
    { overrides: {}, headroomTokens: 8192, maxTokens: 8192 },
    { overrides: { headroomTokens: 4096, maxTokens: 2048 }, headroomTokens: 4096, maxTokens: 2048 },
    { overrides: { modelPolicies: [{ provider: 'uni-paderborn', model: 'gwdg.glm-5.3-flash', maxTokens: 1024 }] },
      headroomTokens: 8192, maxTokens: 1024 },
  ])('fills absent fields while preserving explicit settings: $overrides', async ({ overrides, headroomTokens, maxTokens }) => {
    const { ctx, provider } = await mountWebCompaction(overrides)
    expect(ctx.get('compaction')).toBeUndefined()
    expect(provider.config.modelPolicies.find(policy => policy.model === 'gwdg.glm-5.3-flash')).toMatchObject({
      provider: 'uni-paderborn', headroomTokens, maxTokens,
    })
    expect(provider.config.modelPolicies.find(policy => policy.model === 'hs-de.qwen3.8-27b')).toMatchObject({
      provider: 'uni-paderborn', headroomTokens, maxTokens: overrides.maxTokens ?? 8192,
    })
  })

  it('releases the configuration listener when the profile plugin unloads', async () => {
    const { ctx, defaults } = await mountWebCompaction()
    await defaults.dispose()
    await ctx.plugin(BasicCompactionEngine, { auto: false })
    expect((ctx.compaction as BasicCompactionEngine).config.modelPolicies).toEqual([])
  })
})
