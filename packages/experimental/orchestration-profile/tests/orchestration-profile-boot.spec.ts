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
    persistedPool: { provider: string; model: string }[]
  }
  expect(report.rootOutput).toBe('ran:lead')
  expect(report.orchestrationsLoaded).toBe(true)
  expect(report.runToolPresent).toBe(false)
  expect(report.defaultOutput).toBe('ran:lead')
  expect(report.codingOutput).toBe('ran:gwdg.glm-5.3-flash')
  expect(report.visionOutput).toBe('ran:gwdg.gemma-4-31b-it')
  expect(report.mixedOutput).toBe('ran:gwdg.qwen3.5-397b-a17b')
  expect(report.persistAccepted).toBe(true)
  expect(report.persistedPool).toEqual([{ provider: 'orchestration-mock', model: 'gwdg.gemma-4-31b-it' }])
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
