/** The experimental bundle must carry one parseable, explicit Orchestration layer. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { capabilityOf, POOL_PROVIDER } from '@deepseek-ai/dsh-orchestration/src/capabilities.ts'

describe('Orchestration profile bundle', () => {
  it('declares a public parseable layer with the service, model tool, and pool picker', () => {
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
      '@deepseek-ai/dsh-tool-orchestration': 'workspace:*',
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
    expect(inserted.find(entry => entry.id === 'tool-orchestration')).toMatchObject({
      name: '@deepseek-ai/dsh-tool-orchestration',
    })
    expect(inserted.find(entry => entry.id === 'ui-orchestration')).toMatchObject({
      name: '@deepseek-ai/dsh-client-ui-orchestration',
    })

    // The shipped layer seeds a provider-aligned default pool so run_orchestration
    // works on a fresh profile without a prior GUI Save. Every route must name
    // the harness provider route the base profile mounts (POOL_PROVIDER) and a
    // catalogued model id, so a stale route or a typoed model fails the bundle.
    const toolOrchestration = inserted.find(entry => entry.id === 'tool-orchestration')
    const pool = toolOrchestration?.config?.pool as { provider: string; model: string }[] | undefined
    expect(pool).toBeDefined()
    expect(pool?.length).toBeGreaterThan(0)
    for (const route of pool ?? []) {
      expect(route.provider).toBe(POOL_PROVIDER)
      expect(capabilityOf(route.model)).toBeDefined()
    }
  })
})
