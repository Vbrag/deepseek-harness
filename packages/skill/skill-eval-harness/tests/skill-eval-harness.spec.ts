import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillEvalHarness from '../src/index.ts'
import { describe, expect, it } from 'vitest'

const assets = fileURLToPath(new URL('../assets/', import.meta.url))
const skillName = 'eval-harness'

async function readBody(path: string): Promise<string> {
  const raw = await readFile(path, 'utf8')
  return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, '').trim()
}

describe('bundled eval-harness skill', () => {
  it('declares stable plugin metadata and no default export', () => {
    expect(SkillEvalHarness.name).toBe('skill-eval-harness')
    expect(SkillEvalHarness.inject).toEqual(['skills'])
  })

  it('lists and loads the skill with a bundled resource base and removes it on disposal', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SkillRegistry)
      const fiber = await ctx.plugin(SkillEvalHarness)
      const catalog = await ctx.skills.list()
      expect(catalog.map(skill => skill.name)).toEqual([skillName])
      const skill = catalog[0]!
      expect(skill.description.length).toBeGreaterThan(0)
      expect(skill.description.length).toBeLessThanOrEqual(500)
      expect(skill).toMatchObject({ source: 'bundled', provider: 'dsh-eval-harness', invocation: { modelInvocable: true, userInvocable: true } })
      const loaded = await ctx.skills.get(skillName)
      expect(loaded?.resourceBase).toEqual({ kind: 'directory', path: join(assets, skillName).split(sep).join('/') })
      const body = await readBody(join(assets, skillName, 'SKILL.md'))
      expect(loaded?.content).toBe(body)
      await fiber.dispose()
      expect(await ctx.skills.list()).toEqual([])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('rejects a missing or malformed skill asset before registration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-eval-invalid-'))
    const ctx = new Context()
    try {
      await ctx.plugin(SkillRegistry)
      await cp(assets, root, { recursive: true })

      expect(() => { SkillEvalHarness.apply(ctx, { assetRoot: 'assets' }) }).toThrow('absolute directory')

      const skillPath = join(root, skillName, 'SKILL.md')
      await rm(skillPath)
      expect(() => { SkillEvalHarness.apply(ctx, { assetRoot: root }) }).toThrow('SKILL.md')

      await writeFile(skillPath, '# Missing frontmatter\ndescription: body text\n')
      expect(() => { SkillEvalHarness.apply(ctx, { assetRoot: root }) }).toThrow('has no YAML frontmatter')

      for (const header of ['', 'null', 'scalar', `name: ${skillName}`, 'description: 3', 'description: ""']) {
        await writeFile(skillPath, `---\n${header}\n---\n# Instructions\n`)
        expect(() => { SkillEvalHarness.apply(ctx, { assetRoot: root }) }).toThrow('has no description')
      }
      expect(await ctx.skills.list()).toEqual([])
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('loads relocated resources through a real cordis.yml composition', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-eval-composition-'))
    const ctx = new Context()
    try {
      const external = join(root, 'external assets')
      await cp(assets, external, { recursive: true })
      const configPath = join(root, 'cordis.yml')
      await writeFile(configPath, [
        "- name: '@deepseek-ai/dsh-skill'",
        "- name: '@deepseek-ai/dsh-skill-eval-harness'",
        '',
      ].join('\n'))
      ctx.baseUrl = pathToFileURL(root).href + '/'
      await ctx.plugin(Loader)
      ctx.loader.builtins.include = Include
      const modules = new Map<string, unknown>([
        ['@deepseek-ai/dsh-skill', SkillRegistry],
        ['@deepseek-ai/dsh-skill-eval-harness', SkillEvalHarness],
      ])
      ctx.loader.internal = {
        version: 'v2',
        loadCache: new Map(),
        register() { throw new Error('unexpected register') },
        getOrCreateModuleJob() { throw new Error('unexpected module job') },
        resolveSync() { throw new Error('unexpected resolution') },
        load() { throw new Error('unexpected load') },
        async import(specifier: string) {
          if (!modules.has(specifier)) throw new Error(`Unexpected Loader import: ${specifier}`)
          return modules.get(specifier)
        },
      }
      await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
      await ctx.loader.await()
      expect((await ctx.skills.list()).map(skill => skill.name)).toEqual([skillName])
      const loaded = await ctx.skills.get(skillName)
      expect(loaded?.content).toBeDefined()
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
