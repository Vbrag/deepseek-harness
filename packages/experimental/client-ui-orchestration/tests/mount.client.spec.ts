/** The Orchestration section's registration: the Remote mount, the Host pool behind the inject face, and setPool persistence. */
import assert from 'node:assert/strict'
import { Context, Service } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { CommandId } from '@deepseek-ai/dsh-commands'
import type { CommandExecution } from '@deepseek-ai/dsh-commands'
import { OrchestrationModeControl, type OrchestrationModeInjected } from '../src/client/OrchestrationModeControl.tsx'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { OrchestrationCatalog, PoolRoute, PoolSaveResult, PoolSettingsState } from '@deepseek-ai/dsh-orchestration/types'
import { PADERBORN_CATALOG, POOL_PROVIDER } from '@deepseek-ai/dsh-orchestration/capabilities'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { RemoteError, type TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { expect, it, vi, type Mock } from 'vitest'
import { apply as hostApply } from '../src/index.ts'
import { apply as clientApply } from '../src/client/index.ts'
import { OrchestrationPanel, type OrchestrationInjected } from '../src/client/OrchestrationPanel.tsx'
import { OrchestrationRouting } from '../src/client/OrchestrationRouting.tsx'
import { inject, mountOrchestration } from '../src/client/mount.ts'

const REMOTE: TypertRemoteContribution = { package: '@deepseek-ai/dsh-orchestration', descriptors: [] }

// The client entry imports the generated Remote contribution as a value; hand
// it the same fake object to keep `$mount` interacting with a plain descriptor.
vi.mock('@deepseek-ai/dsh-orchestration/remote', () => ({
  default: { package: '@deepseek-ai/dsh-orchestration', descriptors: [] },
}))

const INITIAL: readonly PoolRoute[] = [{ provider: POOL_PROVIDER, model: 'gwdg.deepseek-v4-flash-0731' }]

/** One Paderborn provider group carrying every catalogue model as a picker row. */
const CATALOG: OrchestrationCatalog = {
  groups: [{
    provider: POOL_PROVIDER,
    name: 'Paderborn Gateway',
    models: PADERBORN_CATALOG.map(capability => ({
      provider: POOL_PROVIDER,
      providerName: 'Paderborn Gateway',
      offlineCurated: true,
      ...capability,
      domains: [...capability.domains],
      modalities: [...capability.modalities],
      ...capability.rateLimits === undefined ? {} : { rateLimits: { ...capability.rateLimits } },
    })),
  }],
}

/** Narrow the erased registry payload before exercising the section's injected face. */
function assertInjected(value: Record<string, unknown>): asserts value is Record<string, unknown> & OrchestrationInjected {
  assert(Array.isArray(value.pool))
  assert(typeof value.setPool === 'function')
}

/** Wire the services the section needs and a Remote `$mount`; no slot registration yet. */
async function buildCtx(options: {
  getPool?: () => Promise<RemoteResult<PoolSettingsState>>
  persistPool?: (pool: readonly PoolRoute[], revision: number) => Promise<RemoteResult<PoolSaveResult>>
  contribution?: TypertRemoteContribution
} = {}) {
  const ctx = new Context()
  const unmount = vi.fn(async () => {})
  class Remote extends Service {
    constructor() { super(ctx, 'remote') }
    async $mount(contribution: TypertRemoteContribution) {
      expect(contribution).toMatchObject(options.contribution ?? REMOTE)
      return unmount
    }
  }
  new Remote()
  const persistPool = (options.persistPool ?? vi.fn(async (pool: readonly PoolRoute[], revision: number) =>
    ({ ok: true as const, value: { status: 'saved' as const, pool, revision: revision + 1 } })))
    as Mock<(pool: readonly PoolRoute[], revision: number) => Promise<RemoteResult<PoolSaveResult>>>
  ctx.provide('remote.orchestrations', {
    getCatalog: vi.fn(async () => ({ ok: true as const, value: CATALOG })),
    getPoolSettingsState: options.getPool ?? vi.fn(async () => ({ ok: true as const, value: { pool: INITIAL, revision: 0 } })),
    persistPool,
    resetBillingHealth: vi.fn(async () => ({ ok: true as const, value: undefined })),
  })
  ctx.provide('locale', new LocaleRuntime(ctx))
  class Layout extends Service {
    constructor() { super(ctx, 'layout') }
  }
  new Layout()
  const warn = vi.fn()
  ctx.logger.warn = warn as never
  await ctx.plugin(SlotRegistry)
  ctx.slots.register({ name: 'root', children: {
    'settings.section': { kind: 'list', scope: 'root' },
    'conversation.input.left': { kind: 'list', scope: 'session' },
    'conversation.session.panel.section': { kind: 'list', scope: 'session' },
  } } as never, () => null)
  return { ctx, unmount, persistPool, warn }
}

async function mount(options: { getPool?: () => Promise<RemoteResult<PoolSettingsState>> } = {}) {
  const built = await buildCtx(options)
  let dispose: (() => Promise<void>) | undefined
  const fiber = built.ctx.plugin({ inject: [...inject], apply: async (plugin: Context) => {
    dispose = await mountOrchestration(plugin, REMOTE)
  } })
  await fiber
  const entry = built.ctx.slots.entries('settings.section').find(candidate => candidate.component === OrchestrationPanel)
  if (entry === undefined || dispose === undefined) throw new Error('the settings section registered no entry')
  const injectFace = entry.inject
  if (injectFace === undefined) throw new Error('the settings section injects nothing')
  const injected = (): OrchestrationInjected => {
    const value = injectFace()
    assertInjected(value)
    return value
  }
  return { ...built, dispose, entry, injected }
}

it('mounts a session-bound composer selector and withdraws it with the Remote mount', async () => {
  const built = await buildCtx()
  const execute = vi.fn(async (): Promise<RemoteResult<CommandExecution | undefined>> => ({
    ok: true, value: { commandId: CommandId('mode-command'), result: { kind: 'success' } },
  }))
  built.ctx.provide('remote.commands', { execute })
  const dispose = await clientApply(built.ctx)
  const entry = built.ctx.slots.entries('conversation.input.left').find(item => item.component === OrchestrationModeControl)
  if (entry?.inject === undefined) throw new Error('composer selector did not mount')
  const sessionId = SessionId('mode-session')
  const callInject = entry.inject as NonNullable<typeof entry.inject> & ((sessionId: SessionId) => OrchestrationModeInjected)
  const value = callInject(sessionId)
  assert(typeof value.selectMode === 'function')
  const face = value as Record<string, unknown> & OrchestrationModeInjected
  await expect(face.selectMode(true)).resolves.toBe(true)
  expect(execute).toHaveBeenLastCalledWith(sessionId, '/orchestration on', [])
  execute.mockResolvedValueOnce({ ok: true, value: { commandId: CommandId('mode-error'), result: { kind: 'error', text: 'refused' } } })
  await expect(face.selectMode(false)).resolves.toBe(false)
  expect(execute).toHaveBeenLastCalledWith(sessionId, '/orchestration off', [])
  execute.mockResolvedValueOnce({ ok: true, value: undefined })
  await expect(face.selectMode(true)).resolves.toBe(false)
  execute.mockResolvedValueOnce({ ok: false, error: new RemoteError('gateway/bad-request', 'refused', {}) })
  await expect(face.selectMode(true)).resolves.toBe(false)
  await dispose()
  expect(built.ctx.slots.entries('conversation.input.left')).toEqual([])
  expect(built.unmount).toHaveBeenCalledOnce()
  await built.ctx.fiber.dispose()
})

it('exposes the host marker and the browser inject list', () => {
  hostApply()
  expect(inject).toEqual(['layout', 'locale', 'slots', 'remote'])
})

it('adds model progress to the session panel and withdraws it before its Remote owner', async () => {
  const built = await buildCtx()
  const dispose = await clientApply(built.ctx)
  const slot = 'conversation.session.panel.section'
  expect(built.ctx.slots.entries(slot).some(entry => entry.component === OrchestrationRouting)).toBe(true)
  await dispose()
  expect(built.ctx.slots.entries(slot)).toEqual([])
  expect(built.unmount).toHaveBeenCalledOnce()
  await built.ctx.fiber.dispose()
})

it('registers the section through the client apply entry and withdraws it on dispose', async () => {
  const built = await buildCtx()
  const dispose = await clientApply(built.ctx)
  const entry = built.ctx.slots.entries('settings.section')
    .find(candidate => candidate.component === OrchestrationPanel)
  if (entry === undefined) throw new Error('apply registered no settings section')
  await dispose()
  expect(built.unmount).toHaveBeenCalled()
  expect(built.ctx.slots.entries('settings.section')).toEqual([])
})

it('seeds the face from getPool and persists a replacement through persistPool', async () => {
  const f = await mount()
  expect(f.injected().pool).toEqual(INITIAL)
  expect(f.injected().catalog).toEqual(CATALOG)
  await expect(f.injected().setPool([], 0)).resolves.toMatchObject({ status: 'saved' })
  expect(f.persistPool).toHaveBeenCalledWith([], 0)
  await f.dispose()
  expect(f.unmount).toHaveBeenCalled()
  expect(f.warn).not.toHaveBeenCalled()
})

it('resolves the nav label through the locale', async () => {
  const f = await mount()
  expect(resolveSlotLabel(f.entry.options.label)).toBe('Orchestration model pool')
  await f.dispose()
})

it('defaults the pool to empty and logs when getPool is refused', async () => {
  const f = await mount({ getPool: vi.fn(async (): Promise<RemoteResult<PoolSettingsState>> => ({ ok: false as const, error: new RemoteError('gateway/bad-request', 'refused read', {}) })) })
  expect(f.injected().pool).toEqual([])
  expect(f.warn).toHaveBeenCalled()
  await f.dispose()
})

it('stringifies a non-Error getPool refusal in the warning', async () => {
  const f = await mount({ getPool: vi.fn(async (): Promise<RemoteResult<PoolSettingsState>> => ({ ok: false as const, error: 'plain refusal' } as never)) })
  expect(f.injected().pool).toEqual([])
  expect(f.warn).toHaveBeenCalled()
  await f.dispose()
})

it('reports a refused persistPool to the panel as false', async () => {
  const f = await mount()
  f.persistPool.mockResolvedValueOnce({ ok: false as const, error: new RemoteError('gateway/bad-request', 'no', {}) })
  await expect(f.injected().setPool(INITIAL, 0)).resolves.toMatchObject({ status: 'failed' })
  expect(f.warn).toHaveBeenCalled()
  await f.dispose()
})

it('treats a Host-refused pool write (value false) as a failure without refreshing the face', async () => {
  const f = await mount()
  f.persistPool.mockResolvedValueOnce({ ok: true as const, value: { status: 'failed', message: 'refused' } })
  await expect(f.injected().setPool(INITIAL, 0)).resolves.toMatchObject({ status: 'failed' })
  expect(f.injected().pool).toEqual(INITIAL)
  expect(f.warn).not.toHaveBeenCalled()
  await f.dispose()
})

it('keeps the face pool current after a successful persistPool', async () => {
  const f = await mount()
  const next: readonly PoolRoute[] = [{ provider: POOL_PROVIDER, model: 'gwdg.gemma-4-31b-it' }]
  await f.injected().setPool(next, 0)
  expect(f.injected().pool).toEqual(next)
  await f.dispose()
})

it('refreshes the effective pool when the panel opens again', async () => {
  const getPool = vi.fn<() => Promise<RemoteResult<PoolSettingsState>>>()
    .mockResolvedValueOnce({ ok: true, value: { pool: INITIAL, revision: 0 } })
    .mockResolvedValueOnce({ ok: true, value: { pool: [], revision: 1 } })
  const f = await mount({ getPool })
  await expect(f.injected().refresh()).resolves.toMatchObject({ pool: [], revision: 1 })
  expect(f.injected().pool).toEqual([])
  await f.dispose()
})

it('withdraws the Remote mount when the registration fails', async () => {
  const built = await buildCtx()
  vi.spyOn(built.ctx.slots, 'inject').mockImplementationOnce(() => { throw new Error('slot failed') })
  const fiber = built.ctx.plugin({ inject: [...inject], apply: (plugin: Context) => mountOrchestration(plugin, REMOTE) })
  await expect(fiber).rejects.toThrow('slot failed')
  expect(built.unmount).toHaveBeenCalled()
})
