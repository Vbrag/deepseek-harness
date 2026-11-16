/** Shipped preset rows publish their todo policy only through the retained Agent composition. */

import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader, { type EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import Group from '@deepseek-ai/cordis-plugin-group'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as ToolTodo from '@deepseek-ai/dsh-tool-todo'
import { expect, it, onTestFinished } from 'vitest'

function todoRow(preset: string): EntryOptions {
  const [declaration] = loadOverlayPatches(preset, fileURLToPath(new URL(`../presets/${preset}.patch.yml`, import.meta.url)))
    .flatMap(patch => patch.insert ?? [])
  const rows = (declaration?.config as { plugins: EntryOptions[] }).plugins
  const row = rows.find(entry => entry.name === '@deepseek-ai/dsh-tool-todo')
  if (row === undefined) throw new Error(`Preset ${preset} does not declare its todo tool`)
  return { ...row, name: 'cordis:todoFixture' }
}

async function fixture(row: EntryOptions) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.group = Group
  ctx.loader.builtins.todoFixture = ToolTodo
  await ctx.plugin(AgentPresets, { default: 'task' })
  await ctx.agentPresets.register({ id: 'task', plugins: [row] })
  await mountAgentLoopTestHarness(ctx)
  return { ctx, create: () => ctx.agents.create({
    sessionId: SessionId('shipped-todo-preset'), meta: { agentPreset: 'task' },
    setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, 'task') },
  }) }
}

it.each(['standard', 'ptc', 'cordis'])('mounts the shipped %s todo row without leaking a global policy service', async (preset) => {
  const { ctx, create } = await fixture(todoRow(preset))
  const { agent } = await create()
  expect(ctx.get('todoPolicy')).toBeUndefined()
  const owner = ctx.agentPresets.serviceFor(agent, 'todoPolicy')
  expect(owner).toBeDefined()
  owner?.writeList(agent, [{ content: 'Verify current task', status: 'pending' }], 'current-task')
  expect(owner?.viewOf(agent.session)?.purpose).toBe('current-task')
})

it('refuses a preset row that omits todo-policy isolation', async () => {
  const { ctx, create } = await fixture({ ...todoRow('standard'), isolate: {} })
  await expect(create()).rejects.toThrow('Preset services require isolate realms: todoPolicy')
  expect(ctx.get('todoPolicy')).toBeUndefined()
})
