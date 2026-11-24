// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { allowAllAccess, bindSnapshotSelector, contextMenuHook, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { afterEach, expect, it, vi } from 'vitest'
import { EnhancementSettings } from '../src/client/Components.tsx'
import type { SettingsState } from '../src/client/controller.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

function unusedHook(): never { throw new Error('This settings page does not use the global hook') }

function fixture(refreshSettings: () => Promise<void>) {
  const store = createSnapshotStore<SettingsState>({
    preferences: { enabled: true, mode: 'automatic', provider: '', model: '', maxPromptWords: 100, maxPromptCharacters: 2000, revision: 2 },
    catalog: [], busy: false, notice: null,
  })
  const saveSettings = vi.fn(async () => false)
  const props: Parameters<typeof EnhancementSettings>[0] = {
    close: vi.fn(), usePanelInfo: unusedHook, useSessions: unusedHook, useSessionStatus: unusedHook,
    useSessionRetainInfo: unusedHook, useWorkspaces: unusedHook, useResource: unusedHook,
    ...allowAllAccess, useContextMenu: contextMenuHook(),
    useSettings: bindSnapshotSelector(store), t: makeTranslate(en), saveSettings, refreshSettings,
    readPreferences: () => store.getSnapshot().preferences,
    clearApprovals: async () => true, resetBilling: async () => {},
  }
  render(<EnhancementSettings {...props} />)
  return { store, saveSettings }
}

it('retains a settings draft and its revision after a failed save and refresh', async () => {
  const refresh = vi.fn<() => Promise<void>>().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('offline'))
  const { store, saveSettings } = fixture(refresh)
  const mode = await screen.findByRole<HTMLSelectElement>('combobox', { name: en.mode })
  fireEvent.change(mode, { target: { value: 'review' } })
  fireEvent.click(screen.getByRole('button', { name: en.save }))
  await waitFor(() => { expect(saveSettings).toHaveBeenCalledWith({ enabled: true, mode: 'review', provider: '', model: '', maxPromptWords: 100, maxPromptCharacters: 2000 }, 2) })
  fireEvent.click(screen.getByRole('button', { name: en.refresh }))
  await waitFor(() => { expect(refresh).toHaveBeenCalledTimes(2) })
  act(() => {
    store.set({ ...store.getSnapshot(), preferences: { enabled: true, mode: 'automatic', provider: '', model: '', maxPromptWords: 100, maxPromptCharacters: 2000, revision: 3 } })
  })
  expect(mode.value).toBe('review')
  fireEvent.click(screen.getByRole('button', { name: en.save }))
  expect(saveSettings).toHaveBeenLastCalledWith({ enabled: true, mode: 'review', provider: '', model: '', maxPromptWords: 100, maxPromptCharacters: 2000 }, 2)
})

it('keeps edits made while a reload is in progress', async () => {
  const pending = Promise.withResolvers<undefined>()
  const refresh = vi.fn<() => Promise<void>>().mockResolvedValueOnce(undefined).mockReturnValueOnce(pending.promise)
  const { store } = fixture(refresh)
  const mode = await screen.findByRole<HTMLSelectElement>('combobox', { name: en.mode })
  fireEvent.click(screen.getByRole('button', { name: en.refresh }))
  fireEvent.change(mode, { target: { value: 'review' } })
  act(() => {
    store.set({ ...store.getSnapshot(), preferences: { enabled: true, mode: 'automatic', provider: '', model: '', maxPromptWords: 100, maxPromptCharacters: 2000, revision: 3 } })
  })
  await act(async () => { pending.resolve(undefined); await pending.promise })
  expect(mode.value).toBe('review')
})

it('saves edited limits and rejects invalid values', async () => {
  const { saveSettings } = fixture(async () => {})
  const words = await screen.findByRole<HTMLInputElement>('spinbutton', { name: en.maxWords })
  const characters = screen.getByRole<HTMLInputElement>('spinbutton', { name: en.maxCharacters })
  fireEvent.change(words, { target: { value: '75' } })
  fireEvent.change(characters, { target: { value: '1500' } })
  fireEvent.click(screen.getByRole('button', { name: en.save }))
  expect(saveSettings).toHaveBeenCalledWith({ enabled: true, mode: 'automatic', provider: '', model: '', maxPromptWords: 75, maxPromptCharacters: 1500 }, 2)
  fireEvent.change(words, { target: { value: '0' } })
  expect(screen.getByRole<HTMLButtonElement>('button', { name: en.save }).disabled).toBe(true)
  expect(screen.getByRole('alert').textContent).toBe(en.invalidLimits)
})
