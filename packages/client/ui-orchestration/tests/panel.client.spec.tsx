// @vitest-environment jsdom
/** The panel draws the catalog rows, seeds the selection from the Host pool, and persists every toggle. */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { OrchestrationCatalog, PoolRoute, PoolSaveResult, RouteCapabilities } from '@deepseek-ai/dsh-orchestration/types'
import { PADERBORN_CATALOG, POOL_PROVIDER } from '@deepseek-ai/dsh-orchestration/capabilities'
import { afterEach, expect, it, vi } from 'vitest'
import { OrchestrationPanel, type OrchestrationPanelProps } from '../src/client/OrchestrationPanel.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const ROUTE: PoolRoute = { provider: POOL_PROVIDER, model: 'gwdg.deepseek-v4-flash-0731' }

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

function fixture(pool: readonly PoolRoute[] = [],
  setPool = vi.fn<(pool: readonly PoolRoute[], revision: number, overrides: readonly RouteCapabilities[]) => Promise<PoolSaveResult>>(
    async (next, revision) => ({ status: 'saved', pool: next, revision: revision + 1 }),
  ), refresh: () => Promise<{ pool: readonly PoolRoute[]; catalog: OrchestrationCatalog; revision: number | null }>
    = async () => ({ pool, catalog: CATALOG, revision: 0 })) {
  const props = {
    t: makeTranslate(zh), pool, catalog: CATALOG, revision: 0, capabilityOverrides: [], setPool,
    refresh: async () => ({ ...await refresh(), capabilityOverrides: [] }),
    resetBillingHealth: async () => true,
  } as OrchestrationPanelProps
  const view = render(<OrchestrationPanel {...props} />)
  return { setPool, ...view }
}

it('renders an explicitly empty pool with no models selected', () => {
  fixture()
  const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
  expect(checkboxes).toHaveLength(PADERBORN_CATALOG.length)
  for (const checkbox of checkboxes) expect(checkbox.checked).toBe(false)
  expect(screen.getByRole('status').textContent).toContain(zh.noneSelected)
})

it('seeds the selection from the Host pool', () => {
  fixture([ROUTE])
  expect(screen.getByRole<HTMLInputElement>('checkbox', { name: /DeepSeek V4 Flash/ }).checked).toBe(true)
  expect(screen.getByRole('status').textContent).toContain(zh.selectedPool)
})

it('persists a toggled-on model on Save, computing the pool from the selection', async () => {
  const { setPool } = fixture([ROUTE])
  fireEvent.click(screen.getByRole('checkbox', { name: /Gemma 4/ }))
  expect(setPool).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: zh.save }))
  expect(setPool).toHaveBeenCalledWith([
    ROUTE,
    { provider: POOL_PROVIDER, model: 'gwdg.gemma-4-31b-it' },
  ], 0, [])
  await act(async () => { await Promise.resolve() })
  expect(screen.getByRole('status').textContent).toContain(zh.savedOk)
  expect(screen.getByRole('status').textContent).not.toContain(zh.saveFailed)
})

it('persists a toggled-off model on Save, dropping it from the pool', async () => {
  const { setPool } = fixture([ROUTE])
  fireEvent.click(screen.getByRole('checkbox', { name: /DeepSeek V4 Flash/ }))
  fireEvent.click(screen.getByRole('button', { name: zh.save }))
  expect(setPool).toHaveBeenCalledWith([], 0, [])
  await act(async () => { await Promise.resolve() })
  expect(screen.getByRole('status').textContent).toBe(zh.savedOk)
})

it('saves a user-assigned specialty with its exact route', async () => {
  const { setPool } = fixture([ROUTE])
  const specialties = screen.getByRole('group', { name: zh.specialties })
  fireEvent.click(within(specialties).getByRole('checkbox', { name: zh.badgeEuropean }))
  fireEvent.click(screen.getByRole('button', { name: zh.save }))
  expect(setPool.mock.calls[0]?.[0]).toEqual([ROUTE])
  expect(setPool.mock.calls[0]?.[1]).toBe(0)
  expect(setPool.mock.calls[0]?.[2][0]).toMatchObject(ROUTE)
  expect(setPool.mock.calls[0]?.[2][0]?.capabilities).toContain('european')
  await act(async () => { await Promise.resolve() })
})

it('keeps routes distinct when provider and model identifiers contain slashes', async () => {
  const template = CATALOG.groups[0]!.models[0]!
  const catalog: OrchestrationCatalog = { groups: [
    { provider: 'a/b', name: 'First provider', models: [{ ...template, provider: 'a/b', id: 'c', name: 'First' }] },
    { provider: 'a', name: 'Second provider', models: [{ ...template, provider: 'a', id: 'b/c', name: 'Second' }] },
  ] }
  const setPool = vi.fn(async (pool: readonly PoolRoute[], revision: number): Promise<PoolSaveResult> =>
    ({ status: 'saved', pool, revision: revision + 1 }))
  const props = { t: makeTranslate(zh), pool: [], catalog, revision: 0, capabilityOverrides: [], setPool,
    refresh: async () => ({ pool: [], catalog, revision: 0, capabilityOverrides: [] }),
    resetBillingHealth: async () => true } as OrchestrationPanelProps
  render(<OrchestrationPanel {...props} />)
  fireEvent.click(screen.getByRole('button', { name: zh.selectAll }))
  fireEvent.click(screen.getByRole('button', { name: zh.save }))
  expect(setPool).toHaveBeenCalledWith([{ provider: 'a/b', model: 'c' }, { provider: 'a', model: 'b/c' }], 0, [])
  await act(async () => { await Promise.resolve() })
})

it('shows a failure notice when the Host refuses a write', async () => {
  const { setPool } = fixture([], vi.fn(async (): Promise<PoolSaveResult> => ({ status: 'failed', message: 'refused' })))
  fireEvent.click(screen.getByRole('checkbox', { name: /Gemma 4/ }))
  fireEvent.click(screen.getByRole('button', { name: zh.save }))
  expect(setPool).toHaveBeenCalled()
  await act(async () => { await Promise.resolve() })
  expect(screen.getByRole('status').textContent).toBe(zh.saveFailed)
  await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.save }).disabled).toBe(false) })
})

it('retains the draft when the save request rejects', async () => {
  fixture([ROUTE], vi.fn(async (): Promise<PoolSaveResult> => { throw new Error('offline') }))
  fireEvent.click(screen.getByRole('checkbox', { name: /Gemma 4/ }))
  fireEvent.click(screen.getByRole('button', { name: zh.save }))
  await waitFor(() => { expect(screen.getByRole('status').textContent).toBe(zh.saveFailed) })
  expect(screen.getByRole<HTMLInputElement>('checkbox', { name: /Gemma 4/ }).checked).toBe(true)
})

it('keeps the selected draft after a stale settings revision', async () => {
  const save = vi.fn<(pool: readonly PoolRoute[], revision: number) => Promise<PoolSaveResult>>()
    .mockResolvedValueOnce({ status: 'stale', message: 'changed' })
    .mockImplementationOnce(async (pool, revision) => ({ status: 'saved', pool, revision: revision + 1 }))
  const refresh = vi.fn<() => Promise<{ pool: readonly PoolRoute[]; catalog: OrchestrationCatalog; revision: number | null }>>()
    .mockResolvedValueOnce({ pool: [ROUTE], catalog: CATALOG, revision: 0 })
    .mockResolvedValueOnce({ pool: [], catalog: CATALOG, revision: 1 })
  const { setPool } = fixture([ROUTE], save, refresh)
  fireEvent.click(screen.getByRole('checkbox', { name: /Gemma 4/ }))
  fireEvent.click(screen.getByRole('button', { name: zh.save }))
  await waitFor(() => { expect(screen.getByRole('status').textContent).toBe(zh.saveStale) })
  expect(screen.getByRole<HTMLInputElement>('checkbox', { name: /Gemma 4/ }).checked).toBe(true)
  expect(setPool).toHaveBeenCalledWith(expect.arrayContaining([ROUTE]), 0, [])
  expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.save }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: zh.refreshSettings }))
  await waitFor(() => { expect(screen.getByRole('status').textContent).toBe(zh.settingsRefreshed) })
  expect(screen.getByRole<HTMLInputElement>('checkbox', { name: /Gemma 4/ }).checked).toBe(true)
  await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.save }).disabled).toBe(false) })
  fireEvent.click(screen.getByRole('button', { name: zh.save }))
  expect(setPool).toHaveBeenLastCalledWith(expect.arrayContaining([ROUTE]), 1, [])
  await waitFor(() => { expect(screen.getByRole('status').textContent).toBe(zh.savedOk) })
})

it('prevents selection changes while a save is pending', async () => {
  const pending = Promise.withResolvers<PoolSaveResult>()
  fixture([ROUTE], vi.fn(() => pending.promise))
  fireEvent.click(screen.getByRole('checkbox', { name: /Gemma 4/ }))
  fireEvent.click(screen.getByRole('button', { name: zh.save }))
  expect(screen.getByRole<HTMLInputElement>('checkbox', { name: /Gemma 4/ }).disabled).toBe(true)
  await act(async () => { pending.resolve({ status: 'failed', message: 'offline' }); await pending.promise })
  await waitFor(() => { expect(screen.getByRole<HTMLInputElement>('checkbox', { name: /Gemma 4/ }).disabled).toBe(false) })
})

it('selects and clears the whole catalog through the toolbar buttons', async () => {
  const { setPool, container } = fixture([ROUTE])
  fireEvent.click(screen.getByRole('button', { name: zh.clearAll }))
  expect(screen.getByRole<HTMLInputElement>('checkbox', { name: /DeepSeek V4 Flash/ }).checked).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: zh.selectAll }))
  for (const checkbox of container.querySelectorAll<HTMLInputElement>('[data-orchestration-row] > label > input')) {
    expect(checkbox.checked).toBe(true)
  }
  fireEvent.click(screen.getByRole('button', { name: zh.save }))
  expect(setPool).toHaveBeenCalledWith(PADERBORN_CATALOG.map(capability => ({ provider: POOL_PROVIDER, model: capability.id })), 0, [])
  await act(async () => { await Promise.resolve() })
})
