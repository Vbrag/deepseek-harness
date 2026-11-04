/**
 * Real-Loader boot driver for Experimental Orchestration Mode. Boots the
 * shipped headless profile over a test overlay (deterministic mock LLM +
 * orchestration service + orchestration model tool with a mock pool), creates a
 * live parent Agent, proves the service and tool are composed, runs one
 * orchestration whose first worker model settles with a server error, asserts
 * the capability-similar failover completes the coding step, prints a compact
 * JSON report to stdout, then disposes the fiber.
 */

import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type {} from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-tools'
import type { OrchestrationResult, PoolRoute } from '@deepseek-ai/dsh-experimental-orchestration'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { bootProductionProfile } from '../../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const FAILING_MODEL = 'gwdg.glm-5.3-flash'
const BACKUP_MODEL = 'gwdg.qwen3-coder-next'

const POOL: readonly PoolRoute[] = [
  { provider: 'orchestration-mock', model: FAILING_MODEL },
  { provider: 'orchestration-mock', model: BACKUP_MODEL },
]

const ctx = await bootProductionProfile({
  binName: 'orchestration-profile-loader',
  profile: 'headless',
  overlayPaths: [
    fileURLToPath(new URL('./composition.patch.yml', import.meta.url)),
  ],
})

export interface DriverReport {
  orchestrationsLoaded: boolean
  runToolPresent: boolean
  succeeded: boolean
  failovers: number
  failedSteps: number
  stepStatuses: { id: string; failed: boolean; failedOver: boolean; routes: string[] }[]
}

try {
  const orchestrationsLoaded = ctx.get('orchestrations') !== undefined

  const parent = await createParentAgent()
  // The orchestration model tool mounts in each agent scope (tool-orchestration
  // installs on agent/created), so it is visible to the exact parent scope.
  const runTool = ctx.tools.schemas(parent).find(tool => tool.name === 'run_orchestration')

  const signal = new AbortController().signal
  const result: OrchestrationResult = await ctx.orchestrations.run(
    parent,
    'Build a hello world program',
    POOL,
    signal,
  )

  const report: DriverReport = {
    orchestrationsLoaded,
    runToolPresent: runTool !== undefined,
    succeeded: result.succeeded,
    failovers: result.failovers,
    failedSteps: result.failedSteps,
    stepStatuses: result.steps.map(outcome => ({
      id: outcome.step.id,
      failed: outcome.failed,
      failedOver: outcome.failedOver,
      routes: outcome.attempts.map(attempt => attempt.model),
    })),
  }

  // Assert in-process so a regression fails the subprocess loudly with the report.
  if (!orchestrationsLoaded) throw new Error('orchestrations service is not mounted')
  if (runTool === undefined) throw new Error('run_orchestration tool is not mounted in the agent scope')
  const required = runTool.parameters.required ?? []
  if (!(required as readonly string[]).includes('task')) {
    throw new Error('run_orchestration tool must require a task parameter')
  }
  if (!result.succeeded) throw new Error('orchestration run did not succeed')
  if (result.failovers < 1) throw new Error('expected at least one failover to a capability-similar model')
  if (result.failedSteps !== 0) throw new Error('expected zero failed steps after failover')
  const step = result.steps[0]
  if (step === undefined || step.failed || !step.failedOver) {
    throw new Error('expected the coding step to complete on the backup model after failover')
  }
  const routes = step.attempts.map(attempt => attempt.model)
  if (routes[0] !== FAILING_MODEL || routes[1] !== BACKUP_MODEL) {
    throw new Error(`expected failover from ${FAILING_MODEL} to ${BACKUP_MODEL}, saw ${routes.join(' -> ')}`)
  }

  process.stdout.write(`${JSON.stringify(report)}\n`)
} finally {
  await ctx.fiber.dispose()
}

/** Create one live root Agent under the booted headless profile. */
async function createParentAgent(): Promise<Agent> {
  const sessionId = brandString<SessionId>(`session-${randomUUID()}`)
  const handle = await ctx.agents.create({
    sessionId,
    meta: { cwd: process.cwd() },
    agentOptions: { provider: 'orchestration-mock', model: BACKUP_MODEL },
    setup: (agentCtx, agent) => {
      installModelSelection(agentCtx)
      agent.model.select({ provider: 'orchestration-mock', model: BACKUP_MODEL })
    },
  })
  return handle.agent
}
