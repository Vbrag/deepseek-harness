// @vitest-environment jsdom
/** The root switch enables the selected pool and is absent from child conversations. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { OrchestrationPoolActivationResult } from '@deepseek-ai/dsh-orchestration/client'
import { OrchestrationModeControl, type OrchestrationModeProps } from '../src/client/OrchestrationModeControl.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

function setup(mode: { active: boolean; pending: boolean; requiresReactivation?: boolean } | undefined,
  result: OrchestrationPoolActivationResult = { status: 'applied' }, child: 'addressed' | 'listed' | false = false) {
  const selectMode = vi.fn(async (_active: boolean) => true)
  const activatePool = vi.fn(async (): Promise<OrchestrationPoolActivationResult> => result)
  const retryActivationStorage = vi.fn(async () => true)
  const props = {
    sessionId: 'session', useProjection: () => mode, selectMode, activatePool, retryActivationStorage,
    useSession: (select: (snapshot: { subagent: object | null }) => boolean) => select({ subagent: child === 'addressed' ? {} : null }),
    useSessions: (select: (state: { byId: Record<string, { origin: string }> }) => boolean) =>
      select({ byId: child === 'listed' ? { session: { origin: 'subagent' } } : {} }),
    pool: [], revision: 0, capabilityOverrides: [], catalog: { groups: [] },
    refresh: async () => ({ pool: [], revision: 0, capabilityOverrides: [], catalog: { groups: [] } }),
    setPool: async () => ({ status: 'saved', pool: [], revision: 1 }), resetBillingHealth: async () => true,
    t: makeTranslate(en),
  } as OrchestrationModeProps
  return { ...render(<OrchestrationModeControl {...props} />), props, selectMode, activatePool, retryActivationStorage }
}

it('keeps the switch disabled while the Session projection is unavailable', () => {
  setup(undefined)
  expect(screen.getByRole<HTMLButtonElement>('switch', { name: en.modeOrchestration }).disabled).toBe(true)
})

it('enables the selected pool without a separate access dialog', async () => {
  const test = setup({ active: false, pending: false })
  fireEvent.click(screen.getByRole('switch', { name: en.modeOrchestration }))
  await waitFor(() => { expect(test.activatePool).toHaveBeenCalledOnce() })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.queryByText('Review model access')).toBeNull()
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false')
  test.rerender(<OrchestrationModeControl {...test.props} useProjection={() => ({ active: true, pending: false })} />)
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
})

it.each(['addressed', 'listed'] as const)('hides the switch for a %s child', (child) => {
  setup({ active: true, pending: false }, { status: 'applied' }, child)
  expect(screen.queryByRole('switch')).toBeNull()
})

it('opens the pool editor when no pool exists', async () => {
  setup({ active: false, pending: false }, { status: 'needs-pool' })
  fireEvent.click(screen.getByRole('switch'))
  expect(await screen.findByRole('dialog', { name: en.title })).toBeTruthy()
})

it('queues a disable and shows the requested state', async () => {
  const test = setup({ active: true, pending: false })
  fireEvent.click(screen.getByRole('switch'))
  await waitFor(() => { expect(test.selectMode).toHaveBeenCalledWith(false) })
  test.rerender(<OrchestrationModeControl {...test.props} useProjection={() => ({ active: true, pending: true })} />)
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false')
  expect(screen.getByRole('status').textContent).toBe(en.modePending)
})

it('explains how to restore an older activation', () => {
  setup({ active: true, pending: false, requiresReactivation: true })
  expect(screen.getByRole('status').textContent).toBe(en.modeReactivate)
})

it('reports transport failure and allows retry without changing the switch', async () => {
  const test = setup({ active: false, pending: false })
  test.activatePool.mockRejectedValueOnce(new Error('offline'))
  fireEvent.click(screen.getByRole('switch'))
  expect((await screen.findByRole('alert')).textContent).toBe(en.modeFailed)
  fireEvent.click(screen.getByRole('switch'))
  await waitFor(() => { expect(test.activatePool).toHaveBeenCalledTimes(2) })
})

it('offers storage retry after an uncertain checkpoint', async () => {
  const test = setup({ active: false, pending: false }, { status: 'durability' })
  fireEvent.click(screen.getByRole('switch'))
  expect((await screen.findByRole('alert')).textContent).toBe(en.modeDurability)
  fireEvent.click(screen.getByRole('button', { name: en.retry }))
  await waitFor(() => { expect(test.retryActivationStorage).toHaveBeenCalledOnce() })
})
