#!/usr/bin/env node
/** Staged vendored source changes require the local-modification manifest in the same index. */

import { spawnSync } from 'node:child_process'

const result = spawnSync('git', ['diff', '--cached', '--name-only', '-z'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
})
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

const staged = result.stdout.split('\0').filter(Boolean)
const changedSource = staged.filter(path => /^vendor\/[^/]+\/(src\/|bin\.js)/.test(path))
if (changedSource.length > 0 && !staged.includes('vendor/README.md')) {
  console.error('vendor manifest guard: vendored SOURCE changed without updating vendor/README.md:')
  for (const path of changedSource) console.error(`  ${path}`)
  console.error('Log the modification in vendor/README.md ("Local modifications") and stage it.')
  process.exitCode = 1
}
