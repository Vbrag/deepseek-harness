import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const driver = fileURLToPath(new URL('./fixtures/loader/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/loader/composition.patch.yml', import.meta.url))

interface DriverReport {
  orchestrationsLoaded: boolean
  runToolPresent: boolean
  succeeded: boolean
  failovers: number
  failedSteps: number
  stepStatuses: { id: string; failed: boolean; failedOver: boolean; routes: string[] }[]
}

it('boots the orchestration service and model tool over headless and fails over a failed worker to a capability-similar model', { timeout: 90_000, retry: 0 }, async () => {
  const { stdout } = await runLoaderSmoke({
    label: 'experimental orchestration capability-matched routing and failover',
    tempDirPrefix: 'dsh-orchestration-loader-',
    binScript: driver,
    libBinScript: driver,
    configPath,
    tsconfigPath: fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url)),
    processTimeoutMs: 75_000,
  })

  const report = JSON.parse(stdout) as DriverReport
  expect(report.orchestrationsLoaded).toBe(true)
  expect(report.runToolPresent).toBe(true)
  expect(report.succeeded).toBe(true)
  expect(report.failovers).toBeGreaterThanOrEqual(1)
  expect(report.failedSteps).toBe(0)
  expect(report.stepStatuses).toEqual([
    { id: 'step-1', failed: false, failedOver: true, routes: ['gwdg.glm-5.3-flash', 'gwdg.qwen3-coder-next'] },
  ])
})
