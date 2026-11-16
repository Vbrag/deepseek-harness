/**
 * Configuration normalization for workspace instruction discovery and rendering.
 *
 * @module @deepseek-ai/dsh-agent-instructions/config
 */

import { relative } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { HarnessError } from '@deepseek-ai/dsh-error'
import { resolveAgentsHome, resolveDshHome } from '@deepseek-ai/dsh-home-paths'

const DEFAULT_PROJECT_ROOT_MARKERS = ['.git'] as const
const DEFAULT_INSTRUCTION_FILE_CANDIDATES = ['AGENTS.md', 'CLAUDE.md'] as const
const DEFAULT_LOCAL_INSTRUCTION_FILE_CANDIDATES = ['AGENTS.local.md', 'CLAUDE.local.md'] as const
const DEFAULT_MAX_SOURCE_BYTES = 1_048_576
const RESERVED_PATH_SEGMENTS = new Set(['', '.', '..'])

/** User-facing workspace instruction loader configuration. */
export interface Config {
  /** Root-level project knowledge file loaded before standing instruction candidates. */
  projectContextFileName?: string
  /** Directory entries that identify the project root while walking upward from the current working directory. */
  projectRootMarkers?: string[]
  /**
   * UTF-8 byte cap for each instruction chain (user-global, project) within one
   * rendered baseline or dynamic batch, so a baseline or batch holding both
   * chains is at most twice this size; non-positive or non-finite disables loading.
   */
  maxBytes: number
  /** Maximum UTF-8 bytes read from one instruction file; larger files are ignored. */
  maxSourceBytes?: number
  /**
   * Ordered same-directory project candidates; every existing file loads, with
   * per-directory trimmed-content duplicates collapsed to the earliest candidate.
   */
  instructionFileCandidates?: string[]
  /**
   * Ordered same-directory local-overlay candidates loaded after the base files
   * under the same per-directory trimmed-content dedup; empty disables the overlay.
   */
  localInstructionFileCandidates?: string[]
}

export const Config: z<Config> = z.object({
  projectContextFileName: z.string().default('PROJECT_CONTEXT.md'),
  projectRootMarkers: z.array(z.string()).default([...DEFAULT_PROJECT_ROOT_MARKERS]),
  maxBytes: z.number().required(),
  maxSourceBytes: z.number().step(1).min(1).default(DEFAULT_MAX_SOURCE_BYTES),
  instructionFileCandidates: z.array(z.string()).default([...DEFAULT_INSTRUCTION_FILE_CANDIDATES]),
  localInstructionFileCandidates: z.array(z.string()).default([...DEFAULT_LOCAL_INSTRUCTION_FILE_CANDIDATES]),
})

/** Normalized instruction discovery configuration. */
export interface ResolvedDiscoveryConfig {
  dshHome: string
  agentsHome: string
  projectRootMarkers: string[]
  projectContextFileName: string
  instructionFileCandidates: string[]
  localInstructionFileCandidates: string[]
}

/** Normalized configuration used by discovery and reconciliation. */
export interface ResolvedConfig extends ResolvedDiscoveryConfig {
  maxBytes: number
  maxSourceBytes: number
}

/**
 * Identify the discovery, precedence, and budget semantics of one baseline.
 * @param config - normalized plugin configuration.
 * @param cwd - absolute session working directory.
 * @param projectRoot - project root selected for the current baseline.
 * @returns stable serialized identity for compatibility checks on resume.
 */
export function workspaceBaselineIdentity(
  config: ResolvedConfig,
  cwd: string,
  projectRoot: string,
): string {
  return JSON.stringify({
    projectRoot: relative(cwd, projectRoot),
    projectRootMarkers: config.projectRootMarkers,
    projectContextFileName: config.projectContextFileName,
    maxBytes: config.maxBytes,
    maxSourceBytes: config.maxSourceBytes,
    instructionFileCandidates: config.instructionFileCandidates,
    localInstructionFileCandidates: config.localInstructionFileCandidates,
  })
}

/**
 * Resolve row defaults, the process harness home, and valid same-directory candidates.
 * Undeclared row fields cannot override the process home.
 * @param config - user-facing plugin configuration.
 * @returns normalized runtime configuration.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  return {
    ...resolveDiscoveryConfig({
      ...config.projectContextFileName === undefined ? {} : { projectContextFileName: config.projectContextFileName },
      ...config.projectRootMarkers === undefined ? {} : { projectRootMarkers: config.projectRootMarkers },
      ...config.instructionFileCandidates === undefined ? {} : { instructionFileCandidates: config.instructionFileCandidates },
      ...config.localInstructionFileCandidates === undefined
        ? {}
        : { localInstructionFileCandidates: config.localInstructionFileCandidates },
    }),
    maxBytes: config.maxBytes,
    maxSourceBytes: config.maxSourceBytes ?? DEFAULT_MAX_SOURCE_BYTES,
  }
}

/**
 * Resolve the subset of configuration used before instruction content is rendered.
 *
 * The harness home comes from the process environment through
 * {@link resolveDshHome}; the row cannot point instruction loading at a second
 * root that other harness consumers would not share. An owner that already
 * resolved the homes passes them as `dshHome` and `agentsHome`, which are
 * normalized here so discovery and reconciliation use the same values.
 * @param config - optional discovery controls plus the already-resolved homes.
 * @returns normalized home, root markers, and instruction candidates.
 */
export function resolveDiscoveryConfig(
  config: Pick<Config, 'projectRootMarkers' | 'projectContextFileName' | 'instructionFileCandidates' | 'localInstructionFileCandidates'>
    & { dshHome?: string; agentsHome?: string },
): ResolvedDiscoveryConfig {
  const resolved = {
    dshHome: resolveDshHome(config.dshHome),
    agentsHome: resolveAgentsHome(config.agentsHome),
    projectRootMarkers: config.projectRootMarkers ?? [...DEFAULT_PROJECT_ROOT_MARKERS],
    projectContextFileName: resolveProjectContextFileName(config.projectContextFileName),
    instructionFileCandidates: resolveInstructionFileCandidates(
      config.instructionFileCandidates,
      DEFAULT_INSTRUCTION_FILE_CANDIDATES,
    ),
    localInstructionFileCandidates: resolveInstructionFileCandidates(
      config.localInstructionFileCandidates,
      DEFAULT_LOCAL_INSTRUCTION_FILE_CANDIDATES,
    ),
  }
  if ([...resolved.instructionFileCandidates, ...resolved.localInstructionFileCandidates]
    .some(candidate => candidate.toLowerCase() === resolved.projectContextFileName.toLowerCase())) {
    throw new HarnessError('projectContextFileName must be distinct from configured standing instruction candidates.',
      'AGENT_INSTRUCTIONS_INVALID_PROJECT_CONTEXT_FILE')
  }
  return resolved
}

function resolveInstructionFileCandidates(candidates: string[] | undefined, fallback: readonly string[]): string[] {
  return (candidates ?? [...fallback]).filter(candidate => (
    !RESERVED_PATH_SEGMENTS.has(candidate) && !/[\\/]/.test(candidate)
  ))
}

/**
 * Resolve a portable project-context filename distinct from standing rules.
 * @param value - optional configured same-directory filename.
 * @returns the validated filename, defaulting to `PROJECT_CONTEXT.md`.
 * @throws HarnessError when the filename is unsafe or names a standing instruction file.
 */
export function resolveProjectContextFileName(value?: string): string {
  const fileName = value ?? 'PROJECT_CONTEXT.md'
  if (fileName.length === 0 || !/\.md$/i.test(fileName) || RESERVED_PATH_SEGMENTS.has(fileName)
    || /[\\/:<>"|?*\u0000-\u001f]/.test(fileName) || /[. ]$/.test(fileName)
    || ['agents.md', 'claude.md', 'agents.local.md', 'claude.local.md'].includes(fileName.toLowerCase())) {
    throw new HarnessError('projectContextFileName must be a portable Markdown filename distinct from AGENTS.md and CLAUDE.md rules.',
      'AGENT_INSTRUCTIONS_INVALID_PROJECT_CONTEXT_FILE')
  }
  return fileName
}
