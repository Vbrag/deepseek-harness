// @vitest-environment jsdom
/** The panel draws the catalog rows, seeds the selection from the Host pool, and persists every toggle. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { PoolRoute } from '@deepseek-ai/dsh-experimental-orchestration/types'
import { PADERBORN_CATALOG } from '@deepseek-ai/dsh-experimental-orchestration/src/capabilities.ts'
import { afterEach, expect, it, vi } from 'vitest'
import { OrchestrationPanel, type OrchestrationPanelProps } from '../src/client/OrchestrationPanel.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const ROUTE: PoolRoute = { provider: 'paderborn', model: 'gwdg.deepseek-v4-flash-0731' }

function fixture(pool: readonly PoolRoute[] = [], setPool = vi.fn<(pool: readonly PoolRoute[]) => Promise<boolean>>(async () => true)) {
  const props = { t: makeTranslate(zh), pool, setPool } as OrchestrationPanelProps
  render(<OrchestrationPanel {...props} />)
  return { setPool }
}

it('renders every catalog row and reports an empty selection', () => {
  fixture()
  expect(screen.getAllByRole('checkbox')).toHaveLength(PADERBORN_CATALOG.length)
  expect(screen.getByRole('status').textContent).toBe(zh.noneSelected)
})

it('seeds the selection from the Host pool', () => {
  fixture([ROUTE])
  expect(screen.getByRole<HTMLInputElement>('checkbox', { name: /DeepSeek V4 Flash/ }).checked).toBe(true)
  expect(screen.getByRole('status').textContent).toContain(zh.selectedPool)
})

it('persists a toggled-on model through setPool, computing the pool from the selection', async () => {
  const { setPool } = fixture([ROUTE])
  fireEvent.click(screen.getByRole('checkbox', { name: /Gemma 4/ }))
  expect(setPool).toHaveBeenCalledWith([
    ROUTE,
    { provider: 'paderborn', model: 'gwdg.gemma-4-31b-it' },
  ])
  await act(async () => { await Promise.resolve() })
  expect(screen.getByRole('status').textContent).toContain(zh.selectedPool)
  expect(screen.getByRole('status').textContent).not.toContain(zh.saveFailed)
})

it('persists a toggled-off model, dropping it from the pool', async () => {
  const { setPool } = fixture([ROUTE])
  fireEvent.click(screen.getByRole('checkbox', { name: /DeepSeek V4 Flash/ }))
  expect(setPool).toHaveBeenCalledWith([])
  await act(async () => { await Promise.resolve() })
  expect(screen.getByRole('status').textContent).toBe(zh.noneSelected)
})

it('shows a failure notice when the Host refuses a write', async () => {
  const { setPool } = fixture([], vi.fn(async () => false))
  fireEvent.click(screen.getByRole('checkbox', { name: /Gemma 4/ }))
  expect(setPool).toHaveBeenCalled()
  await act(async () => { await Promise.resolve() })
  expect(screen.getByRole('status').textContent).toBe(zh.saveFailed)
})
