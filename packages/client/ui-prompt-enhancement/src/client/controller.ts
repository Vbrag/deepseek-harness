/** Client-owned preparation and settings state for prompt enhancement. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ComposerSubmissionDecision, ComposerSubmissionPreparation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-prompt-enhancement/remote'
import type {
  PromptEnhancementCatalog, PromptEnhancementConsentRequest, PromptEnhancementPreferenceUpdate,
  PromptEnhancementPreferences,
} from '@deepseek-ai/dsh-prompt-enhancement/client'
import type { PromptEnhancementKey } from './locales.ts'

/** Current persisted settings and catalog. */
export interface SettingsState {
  readonly preferences: PromptEnhancementPreferences | null
  readonly catalog: PromptEnhancementCatalog
  readonly busy: boolean
  readonly notice: PromptEnhancementKey | null
}

/** Short-lived composer interaction for one Session. */
export type PreparationState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'notice'; readonly message: PromptEnhancementKey; readonly dismiss: () => void }
  | { readonly kind: 'consent'; readonly provider: string; readonly model: string; readonly stable: boolean; readonly endpoint?: string;
    readonly choose: (value: 'approve' | 'original' | 'cancel') => void }
  | { readonly kind: 'running'; readonly cancel: () => void }
  | { readonly kind: 'review'; readonly original: string; readonly enhanced: string;
    readonly choose: (value: { readonly kind: 'submit'; readonly text: string } | { readonly kind: 'original' | 'cancel' }) => void }

const IDLE: PreparationState = { kind: 'idle' }

function failureNotice(code: string): PromptEnhancementKey {
  if (code === 'PROMPT_ENHANCEMENT_SENSITIVE_OR_EMPTY') return 'noticeSensitive'
  if (code === 'PROMPT_ENHANCEMENT_TIMEOUT') return 'noticeTimeout'
  if (code === 'PROMPT_ENHANCEMENT_CATALOG_STALE') return 'noticeCatalog'
  if (['QUOTA', 'ACCOUNT_QUOTA', 'BILLING_EXHAUSTED', 'PROMPT_ENHANCEMENT_BILLING_UNAVAILABLE'].includes(code)) return 'noticeBilling'
  return 'noticeFailed'
}

/** Coordinates one frozen composer submission and the active profile's settings. */
export class EnhancementController {
  readonly settings = createSnapshotStore<SettingsState>({ preferences: null, catalog: [], busy: false, notice: null })
  private readonly sessions = new Map<SessionId, SnapshotStore<PreparationState>>()
  private readonly active = new Map<SessionId, AbortController>()
  private readonly lifetime = new AbortController()
  private settingsRead = 0

  /** @param ctx - Client Context with the mounted enhancement Remote. */
  constructor(private readonly ctx: Context) {}

  /** Session-scoped observable for the composer. @param id - Session identity. @returns Its interaction state. */
  stateFor(id: SessionId): SnapshotStore<PreparationState> {
    let state = this.sessions.get(id)
    if (state === undefined) { state = createSnapshotStore<PreparationState>(IDLE); this.sessions.set(id, state) }
    return state
  }

  /** Reload the active profile and registered routes. */
  async refresh(): Promise<void> {
    if (this.settings.getSnapshot().busy) return
    const read = ++this.settingsRead
    try {
      const [preferences, catalog] = await Promise.all([
        this.ctx.remote.promptEnhancement.preferences(), this.ctx.remote.promptEnhancement.catalog(),
      ])
      if (!preferences.ok || !catalog.ok) throw new Error('Prompt enhancement settings unavailable')
      if (read !== this.settingsRead || this.settings.getSnapshot().busy) return
      this.settings.set({ preferences: preferences.value, catalog: catalog.value, busy: false, notice: null })
    } catch (error) {
      if (read === this.settingsRead && !this.settings.getSnapshot().busy) {
        this.settings.set({ ...this.settings.getSnapshot(), notice: 'loadFailed' })
      }
      throw error
    }
  }

  /** Save against the revision actually displayed. @param update - Desired settings. @returns Whether they were saved. */
  async save(update: PromptEnhancementPreferenceUpdate, revision?: number): Promise<boolean> {
    const state = this.settings.getSnapshot()
    if (state.busy || state.preferences?.revision == null) return false
    this.settingsRead++
    this.settings.set({ ...state, busy: true, notice: null })
    try {
      const result = await this.ctx.remote.promptEnhancement.savePreferences(update, revision ?? state.preferences.revision)
      if (!result.ok || result.value.status !== 'saved') {
        this.settings.set({ ...this.settings.getSnapshot(), busy: false,
          notice: result.ok && result.value.status === 'stale' ? 'saveStale' : 'saveFailed' })
        return false
      }
      this.settings.set({ ...this.settings.getSnapshot(), preferences: result.value.preferences, busy: false, notice: 'saved' })
      return true
    } catch {
      this.settings.set({ ...this.settings.getSnapshot(), busy: false, notice: 'saveFailed' })
      return false
    }
  }

  /** Remove saved provider approvals. @returns Whether the operation succeeded. */
  async clearApprovals(): Promise<boolean> {
    const state = this.settings.getSnapshot()
    if (state.busy) return false
    this.settingsRead++
    this.settings.set({ ...state, busy: true, notice: null })
    try {
      const result = await this.ctx.remote.promptEnhancement.clearProviderApprovals()
      if (!result.ok || !result.value) throw new Error('Could not clear approvals')
      this.settings.set({ ...this.settings.getSnapshot(), busy: false })
      await this.refresh()
      this.settings.set({ ...this.settings.getSnapshot(), notice: 'revoked' })
      return true
    } catch {
      this.settings.set({ ...this.settings.getSnapshot(), busy: false, notice: 'revokeFailed' })
      return false
    }
  }

  /** Clear shared billing observations after the account is corrected. */
  async resetBilling(): Promise<void> {
    if (this.settings.getSnapshot().busy) return
    this.settings.set({ ...this.settings.getSnapshot(), busy: true, notice: null })
    try {
      const result = await this.ctx.remote.promptEnhancement.resetBillingHealth()
      this.settings.set({ ...this.settings.getSnapshot(), busy: false, notice: result.ok ? 'billingReset' : 'billingResetFailed' })
    } catch {
      this.settings.set({ ...this.settings.getSnapshot(), busy: false, notice: 'billingResetFailed' })
    }
  }

  /** Run at most one enhancement for a frozen ordinary submission.
   * @param request - Composer transaction and cancellation.
   * @param original - Text supplied by preceding preparation listeners.
   * @returns Text for admission, or cancellation while preserving the draft.
   */
  async prepare(request: ComposerSubmissionPreparation, original: string): Promise<ComposerSubmissionDecision> {
    const store = this.stateFor(request.sessionId)
    const fallback = (): ComposerSubmissionDecision => ({ kind: 'submit', text: original })
    if (this.active.has(request.sessionId)) return fallback()
    const control = new AbortController()
    this.active.set(request.sessionId, control)
    const signal = AbortSignal.any([request.signal, control.signal, this.lifetime.signal])
    const base = { sessionId: request.sessionId, id: request.requestId }
    try {
      store.set({ kind: 'running', cancel: () => { control.abort() } })
      const response = await this.ctx.remote.promptEnhancement.preflight(base, signal)
      if (signal.aborted) return { kind: 'cancel' }
      if (!response.ok) { this.notice(store, 'noticeFailed'); return fallback() }
      const route = response.value
      if (route.status === 'disabled') { store.set(IDLE); return fallback() }
      if (route.status === 'failed') { this.notice(store, failureNotice(route.code)); return fallback() }
      if (route.status === 'consent-required') {
        const choice = await this.choose<'approve' | 'original' | 'cancel'>(store, signal, 'cancel',
          choose => ({ kind: 'consent', provider: route.provider, model: route.model, stable: route.egressId !== undefined,
            ...route.egressLabel === undefined ? {} : { endpoint: route.egressLabel }, choose }))
        if (choice === 'cancel') return { kind: 'cancel' }
        if (choice === 'original') { store.set(IDLE); return fallback() }
        store.set({ kind: 'running', cancel: () => { control.abort() } })
        const consent: PromptEnhancementConsentRequest = { ...base, provider: route.provider, model: route.model,
          ...route.egressId === undefined ? {} : { egressId: route.egressId } }
        const confirmed = await this.ctx.remote.promptEnhancement.confirmProvider(consent, signal)
        if (signal.aborted) return { kind: 'cancel' }
        if (!confirmed.ok || !confirmed.value) { this.notice(store, 'noticeFailed'); return fallback() }
        // A saved approval changes the active settings revision.
        void this.refresh().catch((error: unknown) => {
          this.ctx.logger.warn('prompt enhancement settings could not be refreshed', error)
        })
      }
      store.set({ kind: 'running', cancel: () => { control.abort() } })
      const result = await this.ctx.remote.promptEnhancement.prepare({ ...base, original,
        displayOriginal: request.displayOriginal, attachments: request.attachments, provider: route.provider, model: route.model,
        expectedEgress: route.egressId ?? null, mode: route.mode }, signal)
      if (signal.aborted) return { kind: 'cancel' }
      if (!result.ok) { this.notice(store, 'noticeFailed'); return fallback() }
      if (result.value.status === 'cancelled') return { kind: 'cancel' }
      if (result.value.status !== 'enhanced') {
        this.notice(store, result.value.status === 'failed' ? failureNotice(result.value.code) : 'noticeFailed')
        return fallback()
      }
      if (route.mode === 'automatic') { store.set(IDLE); return { kind: 'submit', text: result.value.text } }
      const enhanced = result.value.text
      const choice = await this.choose<{ readonly kind: 'submit'; readonly text: string } | { readonly kind: 'original' | 'cancel' }>(
        store, signal, { kind: 'cancel' }, choose => ({ kind: 'review', original: request.displayOriginal, enhanced, choose }))
      store.set(IDLE)
      if (choice.kind === 'submit') return { kind: 'submit', text: choice.text }
      return choice.kind === 'original' ? fallback() : { kind: 'cancel' }
    } catch {
      if (signal.aborted) return { kind: 'cancel' }
      this.notice(store, 'noticeFailed')
      return fallback()
    } finally {
      this.active.delete(request.sessionId)
      if (store.getSnapshot().kind === 'running' || store.getSnapshot().kind === 'consent'
        || store.getSnapshot().kind === 'review') store.set(IDLE)
    }
  }

  private notice(store: SnapshotStore<PreparationState>, message: PromptEnhancementKey): void {
    store.set({ kind: 'notice', message, dismiss: () => { store.set(IDLE) } })
  }

  private choose<T>(store: SnapshotStore<PreparationState>, signal: AbortSignal, cancelled: T,
    build: (settle: (value: T) => void) => PreparationState): Promise<T> {
    return new Promise((resolve) => {
      const settle = (value: T): void => { signal.removeEventListener('abort', cancel); resolve(value) }
      const cancel = (): void => { settle(cancelled) }
      signal.addEventListener('abort', cancel, { once: true })
      store.set(build(settle))
      if (signal.aborted) cancel()
    })
  }

  /** Cancel and release client-owned interactions. */
  dispose(): void {
    this.lifetime.abort()
    for (const controller of this.active.values()) controller.abort()
    this.active.clear()
    this.sessions.clear()
  }
}
