/** Exercise pool settings through the shipped base profile. */
import { fileURLToPath } from 'node:url'
import type {} from '@deepseek-ai/dsh-orchestration'
import { bootProductionProfile } from '../../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const ctx = await bootProductionProfile({
  binName: 'orchestration-settings-loader',
  profile: 'headless',
  overlayPaths: [fileURLToPath(new URL('./settings-only.patch.yml', import.meta.url))],
})
try {
  const initial = ctx.orchestrations.getPoolConfiguration()
  if (initial.revision === null) throw new Error('Orchestration settings are unavailable')
  const pool = [{ provider: 'example', model: 'worker' }]
  const specialties = [{ ...pool[0]!, capabilities: ['coding' as const] }]
  const saved = await ctx.orchestrations.persistPoolConfiguration(pool, specialties, initial.revision)
  const stale = await ctx.orchestrations.persistPoolConfiguration([], [], initial.revision)
  const current = ctx.orchestrations.getPoolConfiguration()
  if (current.revision === null) throw new Error('Orchestration settings disappeared')
  const empty = await ctx.orchestrations.persistPoolConfiguration([], [], current.revision)
  process.stdout.write(`${JSON.stringify({ initial, saved, stale, current, empty,
    final: ctx.orchestrations.getPoolConfiguration() })}\n`)
} finally {
  await ctx.fiber.dispose()
}
