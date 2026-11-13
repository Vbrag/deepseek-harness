/** The experimental bundle must carry one parseable, explicit Orchestration layer. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

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
      '@deepseek-ai/dsh-experimental-client-ui-orchestration': 'workspace:*',
      '@deepseek-ai/dsh-experimental-orchestration': 'workspace:*',
      '@deepseek-ai/dsh-experimental-tool-orchestration': 'workspace:*',
    })

    const parsed = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    )
    expect(Array.isArray(parsed)).toBe(true)
    const patches = parsed as {
      insert?: { id?: string; name?: string; config?: Record<string, unknown> }[]
    }[]
    const inserted = patches.flatMap(patch => patch.insert ?? [])
    expect(inserted.find(entry => entry.id === 'orchestration')).toMatchObject({
      name: '@deepseek-ai/dsh-experimental-orchestration',
    })
    expect(inserted.find(entry => entry.id === 'tool-orchestration')).toMatchObject({
      name: '@deepseek-ai/dsh-experimental-tool-orchestration',
    })
    expect(inserted.find(entry => entry.id === 'ui-orchestration')).toMatchObject({
      name: '@deepseek-ai/dsh-experimental-client-ui-orchestration',
    })
  })
})
