/** Real-model delegation preference with independently checked repairs. */
import { execFile } from 'node:child_process'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { workspaceFiles } from './fixtures/live/workspace.ts'

const runNode = promisify(execFile)
const verificationEnv = Object.fromEntries(Object.entries(process.env)
  .filter(([name]) => !/KEY|SECRET|TOKEN|PASSWORD/i.test(name)))
const driver = fileURLToPath(new URL('./fixtures/live/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/live/composition.patch.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))
const modules = ['allocate.mjs', 'windows.mjs'] as const
const task = 'Repair the seat-allocation module allocate.mjs and the time-window module windows.mjs. '
  + 'The unchanged acceptance tests allocate.test.mjs and windows.test.mjs specify their separate requirements. '
  + 'Seat allocation must preserve the requested total, distribute largest remainders with stable ties, '
  + 'handle zero cases, and reject invalid arguments. Time-window merging must handle unsorted, nested, '
  + 'touching, empty, and invalid windows without mutating inputs. '
  + 'Use the file editing tools for repairs, leave both test files unchanged, and run '
  + '`node --test allocate.test.mjs windows.test.mjs` to verify both modules before reporting the result.'

/** Persisted facts read independently of the lead agent's answer. */
interface SessionRecord {
  type: string
  id?: string
  parentSession?: string
  data?: {
    childId?: string
    callId?: string
    name?: string
    arguments?: unknown
    isError?: boolean
    meta?: { path?: string; stopped?: boolean; diffs?: { path: string; oldText: string | null; newText: string }[] }
    reason?: { kind?: string }
    source?: { kind?: string }
    content?: { type: string; text?: string }[]
    message?: { isError?: boolean; source?: { callId?: string } }
  }
}

function repairedModule(records: SessionRecord[], module: string): boolean {
  const assigned = records.some(record => record.type === 'user/message' && record.data?.source?.kind === 'user'
    && record.data.content?.some(block => block.type === 'text' && block.text?.includes(module)))
  if (!assigned) return false
  const changed = (meta: NonNullable<SessionRecord['data']>['meta']): boolean => meta?.stopped !== true
    && meta?.diffs?.some(diff => diff.path.split(/[\\/]/).at(-1) === module && diff.oldText !== diff.newText) === true
  return records.some((record) => {
    if (!['write', 'edit', 'apply_patch'].includes(record.data?.name ?? '')) return false
    if (record.type === 'tool/ptc-dispatch') return record.data?.isError === false && changed(record.data.meta)
    const callId = record.data?.callId
    return record.type === 'tool/call' && callId !== undefined && records.some(result => result.type === 'tool/result'
      && result.data?.message?.source?.callId === callId && result.data.message.isError !== true && changed(result.data.meta))
  })
}

it.skipIf(!process.env.DEEPSEEK_API_KEY).each(['native', 'ptc'] as const)(
  'delegates module repairs in Orchestration mode through the %s executor',
  async (executor) => {
    await runLoaderSmoke({
      label: `proactive ${executor} delegation with a real model`,
      tempDirPrefix: `dsh-orchestration-${executor}-`,
      binScript: driver,
      libBinScript: driver,
      configPath,
      binArgs: [configPath, task],
      tsconfigPath,
      env: { DSH_TEST_DELEGATION_EXECUTOR: executor },
      processTimeoutMs: 180_000,
      prepare: async (cwd) => {
        await Promise.all(Object.entries(workspaceFiles).map(([name, content]) => writeFile(join(cwd, name), content)))
        await expect(runNode(process.execPath, ['--test', 'allocate.test.mjs', 'windows.test.mjs'], {
          cwd, timeout: 30_000, windowsHide: true, env: verificationEnv,
        })).rejects.toMatchObject({ code: 1 })
      },
      inspect: async (cwd) => {
        for (const name of ['allocate.test.mjs', 'windows.test.mjs'] as const) {
          expect(await readFile(join(cwd, name), 'utf8'), name).toBe(workspaceFiles[name])
        }
        await runNode(process.execPath, ['--test', 'allocate.test.mjs', 'windows.test.mjs'], {
          cwd, timeout: 30_000, windowsHide: true, env: verificationEnv,
        })
        const sessions = join(cwd, '.sessions')
        const paths = (await readdir(sessions, { recursive: true })).filter(path => path.endsWith('.jsonl'))
        const logs = await Promise.all(paths.map(async path =>
          (await readFile(join(sessions, path), 'utf8')).trimEnd().split('\n')
            .map(line => JSON.parse(line) as SessionRecord)))
        const root = logs.find(records => records[0]?.parentSession === undefined)
        expect(root).toBeDefined()
        const childIds = root!.filter(record => record.type === 'subagent/catalog')
          .map(record => record.data?.childId)
        const children = logs.filter(records => records[0]?.parentSession === root![0]?.id
          && childIds.includes(records[0]?.id))
          .map(records => records.slice(records.findLastIndex(record => record.type === 'subagent/descriptor') + 1))
        const usefulChild = children.some(records =>
          records.some(record => record.type === 'turn/end' && record.data?.reason?.kind === 'completed')
          && modules.some(module => repairedModule(records, module)))
        expect(usefulChild).toBe(true)
        const calls = root!.filter(record => record.type === (executor === 'ptc' ? 'tool/ptc-dispatch' : 'tool/call'))
        expect(calls.some(record => record.data?.name === 'subagent' || record.data?.name === 'subagent_fork')).toBe(true)
      },
    })
  },
  255_000,
)
