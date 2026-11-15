/** The manifest guard reads the caller's staged index and preserves paths with spaces. */

import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const script = fileURLToPath(new URL('./check-vendor-manifest.mjs', import.meta.url))

function fixture(staged: readonly string[], run: (result: SpawnSyncReturns<string>) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'dsh-vendor-manifest-'))
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR'].includes(key.toUpperCase())))
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: root, env })
    const indexEnv = { ...env, GIT_INDEX_FILE: join(root, 'selected.index') }
    for (const path of new Set([...staged, 'vendor/README.md'])) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), 'fixture\n')
    }
    execFileSync('git', ['add', '--', ...staged], { cwd: root, env: indexEnv })
    run(spawnSync(process.execPath, [script], { cwd: root, env: indexEnv, encoding: 'utf8' }))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

it.each(['vendor/example/src/file with spaces.ts', 'vendor/example/bin.js'])(
  'rejects staged %s even when the manifest exists only in the working tree', (path) => {
    fixture([path], (result) => {
      expect(result.status).toBe(1)
      expect(result.stderr).toContain(`  ${path}`)
      expect(result.stderr).toContain('and stage it.')
    })
  },
)

it('accepts staged vendored source together with the manifest', () => {
  fixture(['vendor/example/src/file with spaces.ts', 'vendor/README.md'], (result) => {
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
  })
})

it('accepts non-source changes without a staged manifest', () => {
  fixture(['packages/example/file with spaces.ts', 'vendor/example/README.md'], (result) => {
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
  })
})
