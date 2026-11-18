/** The experimental bundle must carry one parseable, explicit Orchestration layer. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { applyPatches, type PatchOptions } from '@deepseek-ai/cordis-plugin-include/src/patch.ts'
import { evaluatePluginCompatibility } from '@deepseek-ai/dsh-app-boot'
import { capabilityOf, POOL_PROVIDER } from '@deepseek-ai/dsh-orchestration/capabilities'

describe('Orchestration profile bundle', () => {
  it('sets small-route compaction defaults while preserving later explicit Loader overrides', () => {
    const patches = yaml.load(readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')) as PatchOptions[]
    const base = [{ id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' }]
    const warn = (message: string): never => { throw new Error(message) }
    const configured = applyPatches(base, patches, warn)
    expect(configured.find(entry => entry.id === 'compaction-basic')?.config).toEqual({ modelPolicies: [
      { provider: 'uni-paderborn', model: 'gwdg.glm-5.3-flash', headroomTokens: 8192, maxTokens: 8192 },
      { provider: 'uni-paderborn', model: 'hs-de.qwen3.8-27b', headroomTokens: 8192, maxTokens: 8192 },
    ] })
    const explicit = { headroomTokens: 4096, maxTokens: 2048, modelPolicies: [] }
    const overridden = applyPatches(base, [...patches, { id: 'compaction-basic', config: explicit }], warn)
    expect(overridden.find(entry => entry.id === 'compaction-basic')?.config).toEqual(explicit)
  })

  it('declares a public parseable layer with normal subagent routing and the pool picker', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      private?: boolean
      publishConfig?: { access?: string }
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.private).toBeUndefined()
    expect(manifest.publishConfig?.access).toBe('public')
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.dependencies).toMatchObject({
      '@deepseek-ai/dsh-client-ui-orchestration': 'workspace:*',
      '@deepseek-ai/dsh-orchestration': 'workspace:*',
    })

    const parsed = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
    )
    expect(Array.isArray(parsed)).toBe(true)
    const patches = parsed as {
      insert?: { id?: string; name?: string; config?: Record<string, unknown> }[]
    }[]
    const inserted = patches.flatMap(patch => patch.insert ?? [])
    expect(inserted.find(entry => entry.id === 'orchestration')).toMatchObject({
      name: '@deepseek-ai/dsh-orchestration',
    })
    expect(inserted.some(entry => entry.id === 'tool-orchestration')).toBe(false)
    expect(inserted.find(entry => entry.id === 'ui-orchestration')).toMatchObject({
      name: '@deepseek-ai/dsh-client-ui-orchestration',
    })

    const orchestration = inserted.find(entry => entry.id === 'orchestration')
    const pool = orchestration?.config?.pool as { provider: string; model: string }[] | undefined
    expect(pool).toBeDefined()
    expect(pool?.length).toBeGreaterThan(0)
    for (const route of pool ?? []) {
      expect(route.provider).toBe(POOL_PROVIDER)
      expect(capabilityOf(route.model)).toBeDefined()
    }
  })

  it.each(['orchestration-profile', 'dsh-orchestration', 'client-ui-orchestration'])(
    'rejects the old host before importing %s and admits the supported runtime', (directory) => {
      const manifest = JSON.parse(readFileSync(new URL(`../../${directory}/package.json`, import.meta.url), 'utf8')) as object
      expect(evaluatePluginCompatibility(manifest, {}, '0.2.1-rc.2')?.requirements).toEqual({
        'engines.dsh': '>=0.2.2-rc.3',
      })
      expect(evaluatePluginCompatibility(manifest, {}, '0.2.2-rc.3')).toBeUndefined()
    },
  )
})
