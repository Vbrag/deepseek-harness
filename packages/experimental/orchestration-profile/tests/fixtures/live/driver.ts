/** Real-provider turn through the shipped headless profile and selected executor. */
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import type {} from '@deepseek-ai/dsh-subagent'
import { bootProductionProfile } from '../../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const task = process.argv[3]
if (task === undefined) throw new Error('live delegation fixture requires a task')
const ctx = await bootProductionProfile({
  binName: 'orchestration-live-delegation',
  profile: 'headless',
  overlayPaths: [
    fileURLToPath(new URL('./composition.patch.yml', import.meta.url)),
    ...(process.env['DSH_TEST_DELEGATION_EXECUTOR'] === 'ptc'
      ? [fileURLToPath(new URL('./ptc.patch.yml', import.meta.url))] : []),
  ],
})

try {
  const parent = (await ctx.agents.create({
    sessionId: SessionId(`orchestration-live-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    setup: (agentCtx, agent) => {
      installModelSelection(agentCtx)
      agent.model.select({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    },
  })).agent
  await runFixtureTurn(ctx, { task })
  while (await ctx.subagents.waitForTreeWork(parent)) await parent.whenIdle()
  await ctx.sessions.flush(parent.session)
} finally {
  await ctx.fiber.dispose()
}
