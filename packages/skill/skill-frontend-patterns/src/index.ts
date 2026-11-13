/** Bundled frontend authoring patterns skill for web and GUI development. */

import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { parse as parseYaml } from 'yaml'
import { BUNDLED_SKILL_RANK, type SkillCandidate, type SkillProvider } from '@deepseek-ai/dsh-skill'

const SKILL_NAMES = ['frontend-patterns'] as const

/** Frontend patterns skill resource location. */
export interface Config {
  /** Absolute assets directory containing the skill folder; defaults to packaged assets. */
  assetRoot?: string
}

/**
 * Parse the YAML frontmatter of a bundled skill and return its description and body.
 * @param raw - the complete raw skill file, including frontmatter.
 * @param path - the skill file path, used in failure messages.
 * @returns the parsed description and body content.
 */
function parseSkill(raw: string, path: string): { description: string; content: string } {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw)
  if (frontmatter?.[1] === undefined) throw new Error(`skill-frontend-patterns: ${path} has no YAML frontmatter`)
  const metadata: unknown = parseYaml(frontmatter[1])
  const description = typeof metadata === 'object' && metadata !== null && 'description' in metadata
    ? metadata.description : undefined
  if (typeof description !== 'string' || description.length === 0) throw new Error(`skill-frontend-patterns: ${path} has no description`)
  return { description, content: raw.slice(frontmatter[0].length).trim() }
}

/**
 * Register the frontend authoring patterns skill with resources readable by the skill loader.
 * @param ctx - context carrying the skill registry.
 * @param config - optional external assets directory for packaged applications.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const assetRoot = config.assetRoot ?? fileURLToPath(new URL('../assets/', import.meta.url))
  if (!isAbsolute(assetRoot)) throw new Error('skill-frontend-patterns: assetRoot must be an absolute directory')
  const candidates: SkillCandidate[] = SKILL_NAMES.map((skillName) => {
    const directory = join(assetRoot, skillName)
    const path = join(directory, 'SKILL.md')
    const { description } = parseSkill(readFileSync(path, 'utf8'), path)
    return {
      name: skillName, description,
      invocation: { modelInvocable: true, userInvocable: true },
      provider: 'dsh-frontend-patterns', source: 'bundled', rank: BUNDLED_SKILL_RANK,
      resourceBase: { kind: 'directory', path: directory.split(sep).join('/') }, locator: path,
    }
  })
  const provider: SkillProvider = {
    name: 'dsh-frontend-patterns',
    list: () => Promise.resolve(candidates),
    async get(candidate, options) {
      const { rank: _rank, locator, ...summary } = candidate
      const raw = await readFile(locator as string, { encoding: 'utf8', signal: options.signal })
      return { ...summary, content: parseSkill(raw, locator as string).content }
    },
  }
  ctx.skills.registerProvider(() => provider)
}

export const name = 'skill-frontend-patterns'
/** Registry used by the bundled provider. */
export const inject = ['skills']
