/** Client submission choices and revision-aware persistence. */
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  PromptEnhancementConsentRequest, PromptEnhancementPreflight, PromptEnhancementPreflightRequest,
  PromptEnhancementPreferenceUpdate, PromptEnhancementRemoteRequest,
} from '@deepseek-ai/dsh-prompt-enhancement/client'
import { expect, it, onTestFinished, vi } from 'vitest'
import { EnhancementController } from '../src/client/controller.ts'

function fixture(mode: 'automatic' | 'review' = 'automatic', consent = false) {
  const ctx = new Context()
  class Remote extends Service { constructor() { super(ctx, 'remote') } }
  new Remote()
  const preferences = { enabled: true, mode, provider: '', model: '', maxPromptWords: 100, maxPromptCharacters: 2000, revision: 2 }
  const remote = {
    preferences: vi.fn(async () => ({ ok: true as const, value: preferences })),
    catalog: vi.fn(async () => ({ ok: true as const, value: [] })),
    savePreferences: vi.fn(async (_update: PromptEnhancementPreferenceUpdate, _revision: number) =>
      ({ ok: true as const, value: { status: 'stale' as const } })),
    clearProviderApprovals: vi.fn(async () => ({ ok: true as const, value: true })),
    resetBillingHealth: vi.fn(async () => ({ ok: true as const, value: undefined })),
    preflight: vi.fn(async (_request: PromptEnhancementPreflightRequest, _signal?: AbortSignal)
    : Promise<{ ok: true; value: PromptEnhancementPreflight }> => ({
      ok: true, value: { status: consent ? 'consent-required' : 'ready', provider: 'test', model: 'model', mode },
    })),
    confirmProvider: vi.fn(async (_request: PromptEnhancementConsentRequest, _signal?: AbortSignal) =>
      ({ ok: true as const, value: true })),
    prepare: vi.fn(async (_request: PromptEnhancementRemoteRequest, _signal?: AbortSignal) =>
      ({ ok: true as const, value: { status: 'enhanced' as const, text: 'Fix the parser.' } })),
  }
  ctx.provide('remote.promptEnhancement', remote)
  const controller = new EnhancementController(ctx)
  onTestFinished(async () => { controller.dispose(); await ctx.fiber.dispose() })
  const sessionId = brandString<SessionId>('session-1')
  const request = { sessionId, requestId: brandString<SessionRequestId>('request-1'), original: 'Fix parser',
    displayOriginal: 'Fix parser', attachments: ['notes.txt'], signal: new AbortController().signal }
  return { controller, remote, request }
}

it('uses one prepared result and passes attachment names without contents', async () => {
  const { controller, remote, request } = fixture()
  expect(await controller.prepare(request, request.original)).toEqual({ kind: 'submit', text: 'Fix the parser.' })
  expect(remote.prepare).toHaveBeenCalledOnce()
  expect(remote.prepare.mock.calls[0]?.[0]).toMatchObject({ original: 'Fix parser', attachments: ['notes.txt'],
    provider: 'test', model: 'model', expectedEgress: null })
})

it('lets the owner use the original instead of approving a new endpoint', async () => {
  const { controller, remote, request } = fixture('automatic', true)
  const pending = controller.prepare(request, request.original)
  await vi.waitFor(() => { expect(controller.stateFor(request.sessionId).getSnapshot().kind).toBe('consent') })
  const state = controller.stateFor(request.sessionId).getSnapshot()
  if (state.kind !== 'consent') throw new Error('Consent was not presented')
  state.choose('original')
  expect(await pending).toEqual({ kind: 'submit', text: 'Fix parser' })
  expect(remote.confirmProvider).not.toHaveBeenCalled()
  expect(remote.prepare).not.toHaveBeenCalled()
})

it('sends the original after a length skip without asking for consent or calling the enhancer', async () => {
  const { controller, remote, request } = fixture()
  remote.preflight.mockResolvedValueOnce({ ok: true, value: { status: 'skipped', reason: 'length' } })
  expect(await controller.prepare(request, request.original)).toEqual({ kind: 'submit', text: request.original })
  expect(controller.stateFor(request.sessionId).getSnapshot()).toMatchObject({ kind: 'notice', message: 'noticeLength' })
  expect(remote.confirmProvider).not.toHaveBeenCalled()
  expect(remote.prepare).not.toHaveBeenCalled()
})

it('continues after consent even while refreshing the model catalog is pending', async () => {
  const { controller, remote, request } = fixture('automatic', true)
  const catalog = Promise.withResolvers<Awaited<ReturnType<typeof remote.catalog>>>()
  onTestFinished(() => { catalog.resolve({ ok: true, value: [] }) })
  remote.catalog.mockImplementationOnce(() => catalog.promise)
  const pending = controller.prepare(request, request.original)
  await vi.waitFor(() => { expect(controller.stateFor(request.sessionId).getSnapshot().kind).toBe('consent') })
  const state = controller.stateFor(request.sessionId).getSnapshot()
  if (state.kind !== 'consent') throw new Error('Consent was not presented')
  state.choose('approve')
  expect(await pending).toEqual({ kind: 'submit', text: 'Fix the parser.' })
  expect(remote.catalog).toHaveBeenCalledOnce()
  expect(remote.prepare).toHaveBeenCalledOnce()
})

it('cancels instead of dispatching if consent resolves after cancellation', async () => {
  const { controller, remote, request } = fixture('automatic', true)
  const consent = Promise.withResolvers<Awaited<ReturnType<typeof remote.confirmProvider>>>()
  onTestFinished(() => { consent.resolve({ ok: true, value: true }) })
  remote.confirmProvider.mockImplementationOnce(() => consent.promise)
  const cancellation = new AbortController()
  const pending = controller.prepare({ ...request, signal: cancellation.signal }, request.original)
  await vi.waitFor(() => { expect(controller.stateFor(request.sessionId).getSnapshot().kind).toBe('consent') })
  const state = controller.stateFor(request.sessionId).getSnapshot()
  if (state.kind !== 'consent') throw new Error('Consent was not presented')
  state.choose('approve')
  await vi.waitFor(() => { expect(remote.confirmProvider).toHaveBeenCalledOnce() })
  cancellation.abort()
  consent.resolve({ ok: true, value: true })
  expect(await pending).toEqual({ kind: 'cancel' })
  expect(remote.prepare).not.toHaveBeenCalled()
})

it('cancels instead of submitting if enhancement resolves after cancellation', async () => {
  const { controller, remote, request } = fixture()
  const result = Promise.withResolvers<Awaited<ReturnType<typeof remote.prepare>>>()
  onTestFinished(() => { result.resolve({ ok: true, value: { status: 'enhanced', text: 'Fix the parser.' } }) })
  remote.prepare.mockImplementationOnce(() => result.promise)
  const cancellation = new AbortController()
  const pending = controller.prepare({ ...request, signal: cancellation.signal }, request.original)
  await vi.waitFor(() => { expect(remote.prepare).toHaveBeenCalledOnce() })
  cancellation.abort()
  result.resolve({ ok: true, value: { status: 'enhanced', text: 'Fix the parser.' } })
  expect(await pending).toEqual({ kind: 'cancel' })
})

it('submits review edits and preserves the original when review is rejected', async () => {
  const { controller, request } = fixture('review')
  const edited = controller.prepare(request, request.original)
  await vi.waitFor(() => { expect(controller.stateFor(request.sessionId).getSnapshot().kind).toBe('review') })
  const first = controller.stateFor(request.sessionId).getSnapshot()
  if (first.kind !== 'review') throw new Error('Review was not presented')
  first.choose({ kind: 'submit', text: 'Fix parser and add a test.' })
  expect(await edited).toEqual({ kind: 'submit', text: 'Fix parser and add a test.' })
  const next = { ...request, requestId: brandString<SessionRequestId>('request-2') }
  const rejected = controller.prepare(next, next.original)
  await vi.waitFor(() => { expect(controller.stateFor(request.sessionId).getSnapshot().kind).toBe('review') })
  const second = controller.stateFor(request.sessionId).getSnapshot()
  if (second.kind !== 'review') throw new Error('Review was not presented')
  second.choose({ kind: 'original' })
  expect(await rejected).toEqual({ kind: 'submit', text: 'Fix parser' })
})

it('retains the visible settings on a stale save', async () => {
  const { controller } = fixture()
  await controller.refresh()
  expect(await controller.save({ enabled: false, mode: 'automatic', provider: '', model: '', maxPromptWords: 100, maxPromptCharacters: 2000 }, 1)).toBe(false)
  expect(controller.settings.getSnapshot()).toMatchObject({ preferences: { enabled: true, revision: 2 }, notice: 'saveStale' })
})

it('cancels a review without admitting either text', async () => {
  const { controller, request } = fixture('review')
  const pending = controller.prepare(request, request.original)
  await vi.waitFor(() => { expect(controller.stateFor(request.sessionId).getSnapshot().kind).toBe('review') })
  const state = controller.stateFor(request.sessionId).getSnapshot()
  if (state.kind !== 'review') throw new Error('Review was not presented')
  state.choose({ kind: 'cancel' })
  expect(await pending).toEqual({ kind: 'cancel' })
})
