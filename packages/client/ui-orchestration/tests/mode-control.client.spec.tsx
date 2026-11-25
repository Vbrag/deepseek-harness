// @vitest-environment jsdom
/** The switch follows projected Session state and asks before granting routes. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { brandString } from '@deepseek-ai/dsh-brand'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { OrchestrationActivationPreflight, OrchestrationReviewId } from '@deepseek-ai/dsh-orchestration/client'
import { OrchestrationModeControl, type OrchestrationModeProps } from '../src/client/OrchestrationModeControl.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
const id = brandString<OrchestrationReviewId>('review')
const route = { provider: 'mock', model: 'coding' }

function setup(mode: { active: boolean; pending: boolean } | undefined,
  preflight: OrchestrationActivationPreflight = { status: 'ready', reviewId: id, pool: [route], additionalRoutes: [] }) {
  const selectMode = vi.fn(async (_active: boolean) => true)
  const prepareActivation = vi.fn(async () => preflight)
  const activateReviewed = vi.fn(async (_reviewId: OrchestrationReviewId, _authorize: boolean) => ({ status: 'applied' as const }))
  const retryActivationStorage = vi.fn(async () => true)
  const props = {
    sessionId: 'session', useProjection: () => mode, selectMode, prepareActivation, activateReviewed, retryActivationStorage,
    pool: [], revision: 0, capabilityOverrides: [], catalog: { groups: [] },
    refresh: async () => ({ pool: [], revision: 0, capabilityOverrides: [], catalog: { groups: [] } }),
    setPool: async () => ({ status: 'saved', pool: [], revision: 1 }), resetBillingHealth: async () => true,
    t: makeTranslate(en),
  } as OrchestrationModeProps
  return { ...render(<OrchestrationModeControl {...props} />), props, selectMode, prepareActivation, activateReviewed,
    retryActivationStorage }
}

it('keeps the switch disabled while the Session projection is unavailable', () => {
  setup(undefined)
  expect(screen.getByRole<HTMLButtonElement>('switch', { name: en.modeOrchestration }).disabled).toBe(true)
})

it('enables a reviewed route without optimistic state', async () => {
  const test = setup({ active: false, pending: false })
  fireEvent.click(screen.getByRole('switch', { name: en.modeOrchestration }))
  await waitFor(() => { expect(test.activateReviewed).toHaveBeenCalledWith(id, false) })
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false')
  test.rerender(<OrchestrationModeControl {...test.props} useProjection={() => ({ active: true, pending: false })} />)
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
})

it('shows an explicit route review and grants only after confirmation', async () => {
  const test = setup({ active: false, pending: false }, { status: 'authorize', reviewId: id, pool: [route], additionalRoutes: [route] })
  fireEvent.click(screen.getByRole('switch'))
  expect(await screen.findByRole('dialog', { name: en.authorizeTitle })).toBeTruthy()
  expect(screen.getByText('mock/coding')).toBeTruthy()
  expect(test.activateReviewed).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: en.authorize }))
  await waitFor(() => { expect(test.activateReviewed).toHaveBeenCalledWith(id, true) })
})

it('opens the pool editor before enabling when no pool exists', async () => {
  const test = setup({ active: false, pending: false }, { status: 'needs-pool' })
  fireEvent.click(screen.getByRole('switch'))
  expect(await screen.findByRole('dialog', { name: en.title })).toBeTruthy()
  expect(test.activateReviewed).not.toHaveBeenCalled()
})

it('queues a disable and shows the requested state', async () => {
  const test = setup({ active: true, pending: false })
  fireEvent.click(screen.getByRole('switch'))
  await waitFor(() => { expect(test.selectMode).toHaveBeenCalledWith(false) })
  test.rerender(<OrchestrationModeControl {...test.props} useProjection={() => ({ active: true, pending: true })} />)
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false')
  expect(screen.getByRole('status').textContent).toBe(en.modePending)
})

it('reports transport failure and allows retry without changing the switch', async () => {
  const test = setup({ active: false, pending: false })
  test.prepareActivation.mockRejectedValueOnce(new Error('offline'))
  fireEvent.click(screen.getByRole('switch'))
  expect((await screen.findByRole('alert')).textContent).toBe(en.modeFailed)
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false')
  fireEvent.click(screen.getByRole('switch'))
  await waitFor(() => { expect(test.activateReviewed).toHaveBeenCalledWith(id, false) })
})

it('offers an explicit storage retry after an uncertain checkpoint', async () => {
  const test = setup({ active: false, pending: false }, { status: 'durability' })
  fireEvent.click(screen.getByRole('switch'))
  expect((await screen.findByRole('alert')).textContent).toBe(en.modeDurability)
  fireEvent.click(screen.getByRole('button', { name: en.retry }))
  await waitFor(() => { expect(test.retryActivationStorage).toHaveBeenCalledOnce() })
})
