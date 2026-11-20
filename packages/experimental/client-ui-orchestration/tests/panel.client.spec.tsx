// @vitest-environment jsdom
/** The panel draws the catalog rows, seeds the selection from the Host pool, and persists every toggle. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { OrchestrationCatalog, PoolRoute } from '@deepseek-ai/dsh-orchestration/types'
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

function fixture(pool: readonly PoolRoute[] = [], setPool = vi.fn<(pool: readonly PoolRoute[]) => Promise<boolean>>(async () => true)) {
  const props = {
    t: makeTranslate(zh), pool, catalog: CATALOG, setPool,
  } as OrchestrationPanelProps
  render(<OrchestrationPanel {...props} />)
  return { setPool }
}

it('renders every catalog row and selects all models by default when nothing is persisted', () => {
  fixture()
  const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
  expect(checkboxes).toHaveLength(PADERBORN_CATALOG.length)
  for (const checkbox of checkboxes) expect(checkbox.checked).toBe(true)
  expect(screen.getByRole('status').textContent).toContain(zh.selectedPool)
  expect(screen.getByRole('status').textContent).not.toContain(zh.noneSelected)
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
  ])
  await act(async () => { await Promise.resolve() })
  expect(screen.getByRole('status').textContent).toContain(zh.savedOk)
  expect(screen.getByRole('status').textContent).not.toContain(zh.saveFailed)
})

it('persists a toggled-off model on Save, dropping it from the pool', async () => {
  const { setPool } = fixture([ROUTE])
  fireEvent.click(screen.getByRole('checkbox', { name: /DeepSeek V4 Flash/ }))
  fireEvent.click(screen.getByRole('button', { name: zh.save }))
  expect(setPool).toHaveBeenCalledWith([])
  await act(async () => { await Promise.resolve() })
  expect(screen.getByRole('status').textContent).toBe(zh.savedOk)
})

it('shows a failure notice when the Host refuses a write', async () => {
  const { setPool } = fixture([], vi.fn(async () => false))
  fireEvent.click(screen.getByRole('checkbox', { name: /Gemma 4/ }))
  fireEvent.click(screen.getByRole('button', { name: zh.save }))
  expect(setPool).toHaveBeenCalled()
  await act(async () => { await Promise.resolve() })
  expect(screen.getByRole('status').textContent).toBe(zh.saveFailed)
})

it('selects and clears the whole catalog through the toolbar buttons', async () => {
  const { setPool } = fixture([ROUTE])
  fireEvent.click(screen.getByRole('button', { name: zh.clearAll }))
  expect(screen.getByRole<HTMLInputElement>('checkbox', { name: /DeepSeek V4 Flash/ }).checked).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: zh.selectAll }))
  for (const checkbox of screen.getAllByRole('checkbox') as HTMLInputElement[]) {
    expect(checkbox.checked).toBe(true)
  }
  fireEvent.click(screen.getByRole('button', { name: zh.save }))
  expect(setPool).toHaveBeenCalledWith(PADERBORN_CATALOG.map(capability => ({ provider: POOL_PROVIDER, model: capability.id })))
  await act(async () => { await Promise.resolve() })
})
