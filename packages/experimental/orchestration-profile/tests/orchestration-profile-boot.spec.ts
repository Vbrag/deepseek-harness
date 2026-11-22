/** Real-profile regression for mode-controlled normal subagent model selection. */
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const driver = fileURLToPath(new URL('./fixtures/loader/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/loader/composition.patch.yml', import.meta.url))

it('boots the profile and routes ordinary coding, vision, and mixed subagents only when enabled', { timeout: 90_000 }, async () => {
  const { stdout } = await runLoaderSmoke({
    label: 'normal subagent task-aware model routing',
    tempDirPrefix: 'dsh-orchestration-loader-',
    binScript: driver, libBinScript: driver, configPath,
    tsconfigPath: fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url)),
    processTimeoutMs: 75_000,
  })
  const report = JSON.parse(stdout) as {
    rootOutput: string
    orchestrationsLoaded: boolean
    runToolPresent: boolean
    defaultOutput: string
    codingOutput: string
    visionOutput: string
    mixedOutput: string
    persistAccepted: boolean
    staleSave: string
    emptySave: string
    emptyPool: { provider: string; model: string }[]
    restoreSave: string
    persistedPool: { provider: string; model: string }[]
    compactionConfig: { modelPolicies: { provider: string; model: string; headroomTokens: number; maxTokens: number }[] }
    parentId: string
    requests: { sessionId: string; model: string; context: string }[]
  }
  expect(report.rootOutput).toBe('ran:lead')
  expect(report.orchestrationsLoaded).toBe(true)
  expect(report.runToolPresent).toBe(false)
  expect(report.defaultOutput).toBe('ran:lead')
  expect(report.codingOutput).toBe('ran:gwdg.glm-5.3-flash')
  expect(report.visionOutput).toBe('ran:gwdg.gemma-4-31b-it')
  expect(report.mixedOutput).toBe('ran:gwdg.qwen3.5-397b-a17b')
  // The pool persists to the user-owned `userPool` settings value (the shipped
  // `pool` default stays a layer-provided fallback), so the write is accepted
  // and the effective pool becomes the persisted selection.
  expect(report.persistAccepted).toBe(true)
  expect(report.staleSave).toBe('stale')
  expect(report.emptySave).toBe('saved')
  expect(report.emptyPool).toEqual([])
  expect(report.restoreSave).toBe('saved')
  expect(report.persistedPool).toEqual([{ provider: 'orchestration-mock', model: 'gwdg.gemma-4-31b-it' }])
  expect(report.compactionConfig.modelPolicies).toEqual([
    { provider: 'uni-paderborn', model: 'gwdg.glm-5.3-flash', headroomTokens: 8192, maxTokens: 8192 },
    { provider: 'uni-paderborn', model: 'hs-de.qwen3.8-27b', headroomTokens: 8192, maxTokens: 8192 },
  ])
  const policy = 'Proactively identify independent work that can make useful progress in parallel.'
  const rootRequests = report.requests.filter(request => request.sessionId === report.parentId)
  expect(rootRequests.map(request => request.context.includes(policy))).toEqual([false, true, false])
  const childRequests = report.requests.filter(request => request.sessionId !== report.parentId)
  expect(childRequests.map(request => request.context.includes(policy))).toEqual([false, true, true, true])
  for (const request of childRequests.slice(1)) {
    expect(request.context).toContain('remaining levels 0')
    expect(request.context).toContain('carry out the work directly')
  }
})

it('creates and runs a normal session when the optional orchestration plugin fails to activate', { timeout: 90_000 }, async () => {
  const { stdout } = await runLoaderSmoke({
    label: 'optional orchestration failure isolation',
    tempDirPrefix: 'dsh-orchestration-failure-',
    binScript: driver, libBinScript: driver, configPath,
    tsconfigPath: fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url)),
    processTimeoutMs: 75_000,
    env: { DSH_TEST_ORCHESTRATION_FAILURE: '1' },
  })
  expect(JSON.parse(stdout)).toEqual({
    rootOutput: 'ran:lead', defaultOutput: 'ran:lead', orchestrationAbsent: true,
  })
})
