/** Real filesystem observations, managed text, containment, and stale publication. */

import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import FsLocal from '@deepseek-ai/dsh-fs-local'
import { expect, it, onTestFinished } from 'vitest'
import {
  assertEditableGuide, canonicalContextText, observeProjectDocument, projectContextForwardingText,
  projectContextPointerText, projectDocumentPath, publishProjectDocument, requestedProjectDocuments,
  verifyCanonicalDocument,
} from '../src/writer.ts'
import type { ProjectDocumentScope } from '../src/writer.ts'

async function fixture(maxSourceBytes = 4096) {
  const directory = await mkdtemp(join(tmpdir(), 'project-context-writer-'))
  const root = join(directory, 'project')
  await mkdir(root)
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  await ctx.plugin(FsLocal, { cwd: root })
  const scope: ProjectDocumentScope = { fs: ctx.fs, root, rootTarget: await ctx.fs.resolve(root),
    contextFileName: 'PROJECT_CONTEXT.md', instructionNames: ['AGENTS.md', 'CLAUDE.md', 'AGENTS.local.md'], maxSourceBytes }
  const signal = new AbortController().signal
  return { root, directory, scope, signal }
}

it('preserves authored text outside the one managed canonical section', () => {
  const original = '# Human notes\n\nKeep this rationale.\n'
  const first = canonicalContextText(original, 'Current parser work.')
  expect(first.startsWith(original)).toBe(true)
  const withAfter = first + '\nKeep these references too.\n'
  const changed = canonicalContextText(withAfter, 'Current parser and tests.')
  expect(changed).toContain('Keep this rationale.')
  expect(changed).toContain('Keep these references too.')
  expect(changed).not.toContain('Current parser work.')
  expect(canonicalContextText(changed, 'Current parser and tests.')).toBe(changed)
})

it('maintains one owned pointer without rewriting primary instruction rules', () => {
  const rules = '# AGENTS.md\n\nNever change the security policy.\n'
  const pointer = projectContextPointerText(rules, 'PROJECT_CONTEXT.md')
  expect(pointer.startsWith(rules)).toBe(true)
  expect(projectContextPointerText(pointer, 'PROJECT_CONTEXT.md')).toBe(pointer)
  const renamed = projectContextPointerText(pointer, 'CONTEXT.md')
  expect(renamed.match(/Read \[/g)).toHaveLength(1)
  expect(renamed).toContain('Never change the security policy.')
  expect(renamed).not.toContain('PROJECT_CONTEXT.md')
})

it.each([
  '<!-- dsh:project-context:start -->\nunfinished',
  '<!-- dsh:project-context:end -->\nreversed\n<!-- dsh:project-context:start -->',
  '<!-- dsh:project-context:start --><!-- dsh:project-context:start --><!-- dsh:project-context:end -->',
])('refuses malformed ownership markers rather than guessing which authored text to replace', (original) => {
  expect(() => canonicalContextText(original, 'Replacement')).toThrow('markers')
})

it.each(['../escape.md', '/outside.md', 'code.ts', 'vendor/guide.md', 'guides/archived/guide.md', '.git/guide.md', 'node_modules/x.md'])(
  'rejects protected or non-Markdown target %s', async (path) => {
    const { root } = await fixture()
    expect(() => projectDocumentPath(root, path)).toThrow()
  })

it('publishes observed creation atomically and refuses a concurrent file instead of overwriting it', async () => {
  const { scope, root, signal } = await fixture()
  const absent = await observeProjectDocument(scope, 'PROJECT_CONTEXT.md', signal)
  expect(absent.document).toMatchObject({ version: null, content: '' })
  await writeFile(join(root, 'PROJECT_CONTEXT.md'), 'Another writer\n')
  await expect(publishProjectDocument(scope, absent, 'Our replacement\n', undefined, signal))
    .rejects.toHaveProperty('code', 'FS_STALE_VERSION')
  expect(await readFile(join(root, 'PROJECT_CONTEXT.md'), 'utf8')).toBe('Another writer\n')
})

it('retains exact observed contents and refuses stale replacements', async () => {
  const { scope, root, signal } = await fixture()
  await writeFile(join(root, 'guide.md'), 'Original rationale\n')
  const observed = await observeProjectDocument(scope, 'guide.md', signal)
  await writeFile(join(root, 'guide.md'), 'A human changed this guide substantially\n')
  await expect(publishProjectDocument(scope, observed, 'Replacement\n', undefined, signal))
    .rejects.toHaveProperty('code', 'FS_STALE_VERSION')
  expect(observed.document.content).toBe('Original rationale\n')
  expect(await readFile(join(root, 'guide.md'), 'utf8')).toContain('A human changed')
})

it('verifies the canonical publication before permitting later consolidation', async () => {
  const { scope, root, signal } = await fixture()
  const absent = await observeProjectDocument(scope, 'PROJECT_CONTEXT.md', signal)
  const written = await publishProjectDocument(scope, absent, canonicalContextText('', 'Verified current facts.'), undefined, signal)
  await verifyCanonicalDocument(scope, written, signal)
  await writeFile(join(root, 'PROJECT_CONTEXT.md'), 'Another writer replaced the canonical facts\n')
  await expect(verifyCanonicalDocument(scope, written, signal)).rejects.toHaveProperty('code', 'FS_STALE_VERSION')
})

it('requires the exact observed whole guide and rejects duplicate target aliases', async () => {
  const { scope, root, signal } = await fixture()
  await writeFile(join(root, 'guide.md'), 'Original rationale\n')
  const observed = await observeProjectDocument(scope, 'guide.md', signal)
  const cache = new Map([['guide.md', observed]])
  expect(() => requestedProjectDocuments(scope, { outcome: 'updated', summary: 'Consolidate', context: 'Facts',
    forwardingStubs: [{ path: 'guide.md', oldText: 'A guess' }] }, cache)).toThrow('Read the complete')
  expect(() => requestedProjectDocuments(scope, { outcome: 'updated', summary: 'Consolidate', context: 'Facts',
    forwardingStubs: [{ path: 'guide.md', oldText: observed.document.content },
      { path: './guide.md', oldText: observed.document.content }] }, cache)).toThrow('repeated')
})

it.each(['AGENTS.md', 'CLAUDE.local.md', 'README.md', 'README.zh.md'])(
  'protects %s from consolidation', async (path) => {
    const { scope, root, signal } = await fixture()
    await writeFile(join(root, path), 'Authored instructions\n')
    const observed = await observeProjectDocument(scope, path, signal)
    await expect(assertEditableGuide(scope, observed, signal)).rejects.toHaveProperty('code', 'FS_PERMISSION_DENIED')
  })

it('protects generated content and guides governed by nested instructions', async () => {
  const { scope, root, signal } = await fixture()
  await writeFile(join(root, 'generated-guide.md'), '<!-- BEGIN GENERATED schema -->\nOriginal\n')
  await expect(assertEditableGuide(scope, await observeProjectDocument(scope, 'generated-guide.md', signal), signal))
    .rejects.toHaveProperty('code', 'FS_PERMISSION_DENIED')
  await mkdir(join(root, 'docs'))
  await writeFile(join(root, 'docs', 'AGENTS.md'), 'Rules apply only here\n')
  await writeFile(join(root, 'docs', 'guide.md'), 'Scope-specific rationale\n')
  await expect(assertEditableGuide(scope, await observeProjectDocument(scope, 'guides/guide.md', signal), signal))
    .rejects.toHaveProperty('code', 'FS_PERMISSION_DENIED')
})

it('rejects a real symbolic-link ancestor even when the provider resolves a valid Markdown file', async () => {
  const { scope, root, directory, signal } = await fixture()
  const outside = join(directory, 'outside')
  await mkdir(outside)
  await writeFile(join(outside, 'guide.md'), 'Outside project\n')
  await symlink(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  await expect(observeProjectDocument(scope, 'linked/guide.md', signal))
    .rejects.toHaveProperty('code', 'FS_PERMISSION_DENIED')
  expect(await readFile(join(outside, 'guide.md'), 'utf8')).toBe('Outside project\n')
})

it('bounds complete UTF-8 observations and output including managed wrappers', async () => {
  const { scope, root, signal } = await fixture(16)
  await writeFile(join(root, 'guide.md'), '界'.repeat(6))
  await expect(observeProjectDocument(scope, 'guide.md', signal)).rejects.toHaveProperty('code', 'FS_TOO_LARGE')
  const absent = await observeProjectDocument(scope, 'PROJECT_CONTEXT.md', signal)
  await expect(publishProjectDocument(scope, absent, canonicalContextText('', 'x'), undefined, signal))
    .rejects.toHaveProperty('code', 'FS_TOO_LARGE')
})

it('keeps a forwarding path and uses a relative link to the canonical root document', () => {
  expect(projectContextForwardingText('guides/old-guide.md', 'PROJECT_CONTEXT.md'))
    .toBe('# Project context\n\nCurrent project context is maintained in [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md).\n')
})
