/** Bounded project-document observations and version-guarded managed-text publication. */

import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FileSystem, FsTarget, FsWriteIntent } from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { ProjectContextDocument, ProjectContextUpdateRequest } from './types.ts'

const CONTEXT_START = '<!-- dsh:project-context:start -->'
const CONTEXT_END = '<!-- dsh:project-context:end -->'
const POINTER_START = '<!-- dsh:project-context:link:start -->'
const POINTER_END = '<!-- dsh:project-context:link:end -->'

/** One observed file, retaining the provider target rather than interpreting its identity. */
export interface ObservedProjectDocument {
  readonly document: ProjectContextDocument
  readonly target: FsTarget
}

/** One filesystem world's project and active instruction names. */
export interface ProjectDocumentScope {
  readonly fs: FileSystem
  readonly root: string
  readonly rootTarget: FsTarget
  readonly contextFileName: string
  readonly instructionNames: readonly string[]
  readonly maxSourceBytes: number
}

function denied(message: string): never {
  throw new FsError(message, 'FS_PERMISSION_DENIED')
}

function generated(content: string): boolean {
  return /<!--\s*(?:BEGIN GENERATED|DO NOT EDIT|generated\b)/i.test(content)
}

function protectedName(name: string): boolean {
  return /^(?:agents|claude|readme)(?:\.[^.]+)*\.md$/i.test(name)
}

/** Resolve a relative project Markdown path without allowing lexical escape.
 * @param root - Canonical project directory.
 * @param path - Model-supplied relative Markdown filename.
 * @returns Normalized relative path and absolute filename.
 */
export function projectDocumentPath(root: string, path: string): { path: string; absolute: string } {
  if (path.trim() !== path || path === '' || path.includes('\0') || isAbsolute(path) || !/\.md$/i.test(path)) {
    denied('Project documents require a relative .md path inside the current project.')
  }
  const absolute = resolve(root, path)
  const normalized = relative(root, absolute)
  if (normalized === '' || normalized === '..' || normalized.startsWith(`..${sep}`) || isAbsolute(normalized)) {
    denied('Project document paths cannot leave the current project.')
  }
  const segments = normalized.split(sep)
  if (segments.some(segment => /^(?:\.git|node_modules|vendor|archived|generated)$/i.test(segment))) {
    denied('Generated, archived, vendor, and repository metadata documents are protected.')
  }
  return { path: segments.join('/'), absolute }
}

async function checkedTarget(scope: ProjectDocumentScope, path: string, signal: AbortSignal): Promise<FsTarget> {
  const candidate = projectDocumentPath(scope.root, path)
  let prefix = scope.root
  const segments = candidate.path.split('/')
  for (const [index, segment] of segments.entries()) {
    prefix = resolve(prefix, segment)
    const entry = await scope.fs.lstat(prefix, {}, signal)
    if (entry?.type === 'symlink') denied(`Project-document maintenance does not modify symbolic links: ${candidate.path}`)
    if (entry !== undefined && (index === segments.length - 1 ? entry.type !== 'file' : entry.type !== 'directory')) {
      denied(`Project document is not a regular file beneath regular directories: ${candidate.path}`)
    }
  }
  const target = await scope.fs.resolve(candidate.absolute, { signal })
  if (!scope.fs.contains(scope.rootTarget, target)) denied('The resolved document is outside the current project.')
  return target
}

async function boundedContent(scope: ProjectDocumentScope, target: FsTarget, signal: AbortSignal): Promise<string> {
  let bytes = 0
  const chunks: string[] = []
  for await (const chunk of await scope.fs.streamText(target, signal)) {
    bytes += Buffer.byteLength(chunk, 'utf8')
    if (bytes > scope.maxSourceBytes) throw new FsError('Project document exceeds maxSourceBytes.', 'FS_TOO_LARGE')
    chunks.push(chunk)
  }
  return chunks.join('')
}

/** Observe one complete regular project file and its stable version.
 * @param scope - Current project and bounded filesystem provider.
 * @param path - Relative Markdown path; absence is observed for guarded creation.
 * @param signal - Active maintenance cancellation.
 * @returns Complete original content and the provider's authoritative freshness token.
 */
export async function observeProjectDocument(
  scope: ProjectDocumentScope, path: string, signal: AbortSignal,
): Promise<ObservedProjectDocument> {
  const candidate = projectDocumentPath(scope.root, path)
  const target = await checkedTarget(scope, candidate.path, signal)
  const info = await scope.fs.stat(target, signal)
  if (info === undefined) return { target, document: { path: candidate.path, version: null, content: '' } }
  if (info.type !== 'file') denied(`Project document is not a regular file: ${candidate.path}`)
  if (info.size !== undefined && info.size > scope.maxSourceBytes) {
    throw new FsError(`Project document exceeds maxSourceBytes: ${candidate.path}`, 'FS_TOO_LARGE')
  }
  const content = await boundedContent(scope, target, signal)
  if ((await scope.fs.stat(target, signal))?.version !== info.version) {
    throw new FsError(`Project document changed during its observation: ${candidate.path}`, 'FS_STALE_VERSION')
  }
  return { target, document: { path: candidate.path, version: info.version, content } }
}

/** Whether a guide may be consolidated without moving scoped instructions or protected material.
 * @param scope - Current project's instruction candidates.
 * @param observed - Original guide previously supplied to the model.
 * @param signal - Active maintenance cancellation.
 */
export async function assertEditableGuide(
  scope: ProjectDocumentScope, observed: ObservedProjectDocument, signal: AbortSignal,
): Promise<void> {
  const name = basename(observed.document.path)
  if (name === scope.contextFileName || protectedName(name)
    || scope.instructionNames.some(candidate => candidate.toLowerCase() === name.toLowerCase())
    || generated(observed.document.content) || observed.document.version === null) {
    denied(`This document cannot be consolidated automatically: ${observed.document.path}`)
  }
  let directory = dirname(resolve(scope.root, observed.document.path))
  while (directory !== scope.root) {
    for (const instruction of scope.instructionNames) {
      if (await scope.fs.lstat(resolve(directory, instruction), {}, signal) !== undefined) {
        denied(`A scoped instruction file protects this guide: ${observed.document.path}`)
      }
    }
    directory = dirname(directory)
  }
}

function managedText(original: string, content: string, start: string, end: string): string {
  if (content.includes(start) || content.includes(end)) denied('Managed document content cannot contain its ownership markers.')
  const first = original.indexOf(start)
  const last = original.indexOf(end)
  const block = `${start}\n${content.trimEnd()}\n${end}`
  if (first === -1 && last === -1) return `${original}${original === '' ? '' : original.endsWith('\n') ? '\n' : '\n\n'}${block}\n`
  if (first === -1 || last < first || original.indexOf(start, first + start.length) !== -1
    || original.indexOf(end, last + end.length) !== -1) denied('Managed document markers are incomplete or repeated; repair them explicitly.')
  return original.slice(0, first) + block + original.slice(last + end.length)
}

/** Replace only the canonical document's owned context section.
 * @param original - Complete current document, including unrelated authored text.
 * @param content - Current project knowledge assessed by the model.
 * @returns Full text preserving everything outside the managed section.
 */
export function canonicalContextText(original: string, content: string): string {
  if (generated(original)) denied('The canonical project context is a generated document and cannot be overwritten.')
  return managedText(original, content, CONTEXT_START, CONTEXT_END)
}

/** Append or refresh the single owned pointer without rewriting instruction rules.
 * @param original - Complete primary instruction document.
 * @param filename - Canonical root context filename.
 * @returns Full instructions with the owned pointer section.
 */
export function projectContextPointerText(original: string, filename: string): string {
  if (generated(original)) denied('Generated instruction files cannot receive a project-context pointer.')
  return managedText(original, `Read [${filename}](${filename}) for current project context.`, POINTER_START, POINTER_END)
}

/** Publish exactly one observed file through the current sandbox and freshness guard.
 * @param scope - Current filesystem world and project limits.
 * @param observed - Exact original observation authorizing this replacement or creation.
 * @param content - Complete new UTF-8 text.
 * @param policy - Session's ordinary filesystem execution policy.
 * @param signal - Active maintenance cancellation.
 * @returns New observation; unchanged text retains its original version.
 */
export async function publishProjectDocument(
  scope: ProjectDocumentScope, observed: ObservedProjectDocument, content: string,
  policy: SandboxExecutionPolicy | undefined, signal: AbortSignal,
): Promise<ObservedProjectDocument> {
  signal.throwIfAborted()
  if (Buffer.byteLength(content, 'utf8') > scope.maxSourceBytes) {
    throw new FsError('The complete project document exceeds maxSourceBytes.', 'FS_TOO_LARGE')
  }
  const target = await checkedTarget(scope, observed.document.path, signal)
  const version = (await scope.fs.stat(target, signal))?.version
  if (target.targetKey !== observed.target.targetKey || version !== (observed.document.version ?? undefined)) {
    throw new FsError(`Project document changed after observation: ${observed.document.path}`, 'FS_STALE_VERSION')
  }
  if (content === observed.document.content) return observed
  const intent: FsWriteIntent = observed.document.version === null ? { kind: 'createIfAbsent' }
    : { kind: 'replaceIfVersion', version: observed.document.version }
  const outcome = await scope.fs.writeText(target, content, intent, signal, policy)
  return { target, document: { path: observed.document.path, content: outcome.after, version: outcome.version } }
}

/** Verify that a canonical destination is still the published file before replacing a duplicate.
 * @param scope - Current filesystem world.
 * @param canonical - Successful canonical publication retained by the writer.
 * @param signal - Active maintenance cancellation.
 */
export async function verifyCanonicalDocument(
  scope: ProjectDocumentScope, canonical: ObservedProjectDocument, signal: AbortSignal,
): Promise<void> {
  const current = await observeProjectDocument(scope, canonical.document.path, signal)
  if (current.document.version !== canonical.document.version || current.document.content !== canonical.document.content) {
    throw new FsError('The canonical project context changed before guide consolidation.', 'FS_STALE_VERSION')
  }
}

/** Format a forwarding document without deleting its path.
 * @param guidePath - Former duplicate guide's project-relative path.
 * @param canonicalPath - Canonical root project-context filename.
 * @returns A complete Markdown forwarding stub.
 */
export function projectContextForwardingText(guidePath: string, canonicalPath: string): string {
  const link = relative(dirname(guidePath), canonicalPath).split(sep).join('/')
  return `# Project context\n\nCurrent project context is maintained in [${canonicalPath}](${link}).\n`
}

/** Ensure one request does not edit a target more than once or claim an unobserved original.
 * @param scope - Current project.
 * @param request - Model-requested guide replacements and forwarding paths.
 * @param observed - Phase-owned exact content/version observations.
 * @returns Observations in request order; each request path has one entry.
 */
export function requestedProjectDocuments(
  scope: ProjectDocumentScope, request: ProjectContextUpdateRequest,
  observed: ReadonlyMap<string, ObservedProjectDocument>,
): Map<string, ObservedProjectDocument> {
  const selected = new Map<string, ObservedProjectDocument>()
  for (const update of [...request.guideUpdates ?? [], ...request.forwardingStubs ?? []]) {
    const path = projectDocumentPath(scope.root, update.path).path
    const previous = observed.get(path)
    if (selected.has(path)) denied(`Project document is repeated in one update: ${path}`)
    if (previous === undefined || previous.document.content !== update.oldText) {
      throw new FsError(`Read the complete current document with project_context_read before changing it: ${path}`, 'FS_NOT_OBSERVED')
    }
    selected.set(path, previous)
  }
  return selected
}
