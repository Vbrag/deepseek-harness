// @vitest-environment jsdom
/** Composer mode selection follows the host projection and retains it on failure. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { OrchestrationModeControl, type OrchestrationModeProps } from '../src/client/OrchestrationModeControl.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

function setup(mode: { active: boolean; pending: boolean } | undefined, selectMode = vi.fn(async (_active: boolean) => true)) {
  const props = { useProjection: () => mode, selectMode, t: makeTranslate(en) } as OrchestrationModeProps
  const view = render(<OrchestrationModeControl {...props} />)
  return { ...view, selectMode, props }
}

function open() {
  fireEvent.click(screen.getByRole('button', { name: en.modeLabel }))
}

it('hides the selector when the host capability is absent', () => {
  const view = setup(undefined)
  expect(view.container.textContent).toBe('')
})

it('selects Orchestration through its command without optimistic mode state', async () => {
  const f = setup({ active: false, pending: false })
  open()
  fireEvent.click(screen.getByRole('menuitem', { name: en.modeOrchestration }))
  await waitFor(() => { expect(f.selectMode).toHaveBeenCalledWith(true) })
  expect(screen.getByRole('button', { name: en.modeLabel }).textContent).toBe(en.modeDefault)
  f.rerender(<OrchestrationModeControl {...f.props} useProjection={() => ({ active: true, pending: false })} />)
  expect(screen.getByRole('button', { name: en.modeLabel }).textContent).toBe(en.modeOrchestration)
})

it('selects Default and displays a queued mid-turn change', async () => {
  const f = setup({ active: true, pending: false })
  open()
  fireEvent.click(screen.getByRole('menuitem', { name: en.modeDefault }))
  await waitFor(() => { expect(f.selectMode).toHaveBeenCalledWith(false) })
  f.rerender(<OrchestrationModeControl {...f.props} useProjection={() => ({ active: true, pending: true })} />)
  expect(screen.getByRole('button', { name: en.modeLabel }).textContent).toBe(en.modeDefault)
  expect(screen.getByRole('status').textContent).toBe(en.modePending)
})

it('does not submit the already selected mode and closes with Escape', () => {
  const f = setup({ active: false, pending: false })
  open()
  fireEvent.click(screen.getByRole('menuitem', { name: en.modeDefault }))
  expect(f.selectMode).not.toHaveBeenCalled()
  open()
  fireEvent.keyDown(screen.getByRole('menuitem', { name: en.modeDefault }), { key: 'Escape' })
  expect(screen.queryByRole('menuitem')).toBeNull()
})

it.each([false, new Error('transport closed')])('keeps the projected mode visible and offers retry after %s', async (failure) => {
  const selectMode = vi.fn(async (_active: boolean) => {
    if (failure instanceof Error) throw failure
    return failure
  })
  setup({ active: false, pending: false }, selectMode)
  open()
  fireEvent.click(screen.getByRole('menuitem', { name: en.modeOrchestration }))
  expect((await screen.findByRole('alert')).textContent).toBe(en.modeFailed)
  expect(screen.getByRole('button', { name: en.modeLabel }).textContent).toBe(en.modeDefault)
  open()
  fireEvent.click(screen.getByRole('menuitem', { name: en.modeOrchestration }))
  await waitFor(() => { expect(selectMode).toHaveBeenCalledTimes(2) })
})

it('disables repeated activation while the command is outstanding', async () => {
  const pending = Promise.withResolvers<boolean>()
  const selectMode = vi.fn((_active: boolean) => pending.promise)
  setup({ active: false, pending: false }, selectMode)
  open()
  fireEvent.click(screen.getByRole('menuitem', { name: en.modeOrchestration }))
  expect(screen.getByRole<HTMLButtonElement>('button', { name: en.modeLabel }).disabled).toBe(true)
  pending.resolve(true)
  await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: en.modeLabel }).disabled).toBe(false) })
})
