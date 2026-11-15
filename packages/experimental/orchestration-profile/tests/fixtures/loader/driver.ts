/** Headless production-profile smoke for the normal subagent routing policy. */
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { installModelSelection, type Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-orchestration'
import { SessionId } from '@deepseek-ai/dsh-session'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { bootProductionProfile } from '../../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const ctx = await bootProductionProfile({
  binName: 'orchestration-profile-loader',
  profile: 'headless',
  overlayPaths: [
    fileURLToPath(new URL('./composition.patch.yml', import.meta.url)),
    ...(process.env['DSH_TEST_ORCHESTRATION_FAILURE'] === '1'
      ? [fileURLToPath(new URL('./failure.patch.yml', import.meta.url))] : []),
  ],
})

try {
  const parent = (await ctx.agents.create({
    sessionId: SessionId(`orchestration-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: 'orchestration-mock', model: 'lead' },
    setup: (agentCtx, agent) => {
      installModelSelection(agentCtx)
      agent.model.select({ provider: 'orchestration-mock', model: 'lead' })
    },
  })).agent
  const rootOutput = (await runFixtureTurn(ctx, { task: 'Reply with your assigned route.' })).output
  const defaultOutput = await delegate(parent, [])
  if (process.env['DSH_TEST_ORCHESTRATION_FAILURE'] === '1') {
    process.stdout.write(`${JSON.stringify({ rootOutput, defaultOutput, orchestrationAbsent: ctx.get('orchestrations') === undefined })}\n`)
  } else {
    ctx.orchestrations.select(parent, true)
    const codingOutput = await delegate(parent, ['coding'])
    const visionOutput = await delegate(parent, ['vision'])
    const mixedOutput = await delegate(parent, ['coding', 'vision'])
    const runToolPresent = ctx.tools.schemas(parent).some(tool => tool.name === 'run_orchestration')
    const persistedPool = [{ provider: 'orchestration-mock', model: 'gwdg.gemma-4-31b-it' }]
    const persistAccepted = await ctx.orchestrations.persistPool(persistedPool)
    process.stdout.write(`${JSON.stringify({
      rootOutput, orchestrationsLoaded: ctx.get('orchestrations') !== undefined,
      runToolPresent, defaultOutput, codingOutput, visionOutput, mixedOutput,
      persistAccepted, persistedPool: ctx.orchestrations.getPool(),
    })}\n`)
  }
} finally {
  await ctx.fiber.dispose()
}

async function delegate(parent: Agent, requiredCapabilities: string[]): Promise<string> {
  const activation = await ctx.subagents.startActivation({
    provider: 'spawn', label: 'routing probe', delivery: 'caller', parent,
    signal: new AbortController().signal,
    prompt: [{ type: 'text', text: 'Reply with your assigned route.' }],
    taskAssessment: { requiredCapabilities, contextTokens: 100 },
  })
  try {
    const result = await activation.result
    if (result.stopReason !== 'completed') throw new Error(`child did not complete: ${result.stopReason}`)
    return result.output.filter(block => block.type === 'text').map(block => block.text).join('')
  } finally {
    await activation.dispose()
  }
}
