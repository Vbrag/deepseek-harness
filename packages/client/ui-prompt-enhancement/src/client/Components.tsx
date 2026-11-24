/** Composer, settings, and transcript presentation for prompt enhancement. */
import { useEffect, useRef, useState } from 'react'
import { Button, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PromptEnhancementPreferences, PromptEnhancementPreferenceUpdate } from '@deepseek-ai/dsh-prompt-enhancement/client'
import type { PreparationState, SettingsState } from './controller.ts'
import { NS } from './locales.ts'
import css from './Components.module.css'

/** Settings state and mutations supplied to the composer and settings page. */
export interface SettingsInjected {
  readonly hooks: { readonly settings: ObservableSnapshot<SettingsState> }
  readonly saveSettings: (update: PromptEnhancementPreferenceUpdate, revision?: number) => Promise<boolean>
  readonly refreshSettings: () => Promise<void>
  readonly readPreferences: () => PromptEnhancementPreferences | null
  readonly clearApprovals: () => Promise<boolean>
  readonly resetBilling: () => Promise<void>
}

/** Session-local interaction supplied to the dock. */
export interface PreparationInjected {
  readonly hooks: { readonly preparation: ObservableSnapshot<PreparationState> }
}

/** Composer switch backed by the effective profile setting. */
export function EnhancementToggle({ useSettings, useSession, saveSettings, t }:
  PropsRuntime<'conversation.input.left'> & PropsLocale<typeof NS> & InjectFace<SettingsInjected>) {
  const state = useSettings(value => value)
  const child = useSession(value => value.subagent !== null)
  const preferences = state.preferences
  if (child) return null
  return <span className={css.toggle}>
    <Switch checked={preferences?.enabled ?? false} disabled={state.busy || preferences?.revision == null}
      label={t('toggle')} title={t('privacy')} onChange={(enabled) => {
        if (preferences === null) return
        const { revision: _revision, ...update } = preferences
        void saveSettings({ ...update, enabled })
      }} />
    <span>{t('toggle')}</span>
    {(state.notice === 'saveFailed' || state.notice === 'saveStale') && <span role="alert">{t(state.notice)}</span>}
  </span>
}

/** Minimal changed span, using Unicode code points so highlights do not split characters. */
export function changedSpan(original: string, enhanced: string): {
  readonly before: string
  readonly removed: string
  readonly changed: string
  readonly after: string
} {
  const left = Array.from(original)
  const right = Array.from(enhanced)
  let start = 0
  while (start < left.length && start < right.length && left[start] === right[start]) start++
  let end = 0
  while (end < left.length - start && end < right.length - start
    && left[left.length - 1 - end] === right[right.length - 1 - end]) end++
  return { before: right.slice(0, start).join(''), removed: left.slice(start, left.length - end).join(''),
    changed: right.slice(start, right.length - end).join(''),
    after: end === 0 ? '' : right.slice(right.length - end).join('') }
}

function Comparison({ original, enhanced, t }: {
  readonly original: string
  readonly enhanced: string
  readonly t: PropsLocale<typeof NS>['t']
}) {
  const diff = changedSpan(original, enhanced)
  return <div className={css.comparison}>
    <div className={css.label}>{t('originalLabel')}</div>
    <div className={css.prompt}>{diff.before}{diff.removed !== '' && <del>{diff.removed}</del>}{diff.after}</div>
    <div className={css.label}>{t('enhancedLabel')}</div>
    <div className={css.prompt}>{diff.before}{diff.changed !== '' && <mark>{diff.changed}</mark>}{diff.after}</div>
  </div>
}

function Review({ state, t }: { readonly state: Extract<PreparationState, { kind: 'review' }>
  readonly t: PropsLocale<typeof NS>['t'] }) {
  const [text, setText] = useState(state.enhanced)
  return <section className={css.panel} aria-label={t('reviewTitle')}>
    <strong>{t('reviewTitle')}</strong>
    <p>{t('reviewHelp')}</p>
    <Comparison original={state.original} enhanced={text} t={t} />
    <textarea className={css.editor} aria-label={t('enhancedLabel')} value={text}
      onChange={(event) => { setText(event.target.value) }} />
    <div className={css.actions}>
      <Button variant="primary" disabled={text.trim() === ''} onClick={() => { state.choose({ kind: 'submit', text }) }}>{t('accept')}</Button>
      <Button variant="outline" onClick={() => { state.choose({ kind: 'original' }) }}>{t('original')}</Button>
      <Button onClick={() => { state.choose({ kind: 'cancel' }) }}>{t('cancel')}</Button>
    </div>
  </section>
}

function positiveInteger(value: string): number | null {
  if (!/^\d+$/u.test(value)) return null
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

/** Consent, progress, review, or recovery feedback for the active submission. */
export function PreparationDock({ usePreparation, t }:
  PropsRuntime<'conversation.input.dock'> & PropsLocale<typeof NS> & InjectFace<PreparationInjected>) {
  const state = usePreparation(value => value)
  switch (state.kind) {
    case 'idle': return null
    case 'notice': return <div className={css.panel} role="status">{t(state.message)}
      <Button size="sm" onClick={state.dismiss}>{t('dismiss')}</Button></div>
    case 'running': return <div className={css.panel} role="status">{t('enhancing')}
      <Button size="sm" onClick={state.cancel}>{t('cancel')}</Button></div>
    case 'review': return <Review state={state} t={t} />
    case 'consent': return <section className={css.panel} aria-label={t('consentTitle')}>
      <strong>{t('consentTitle')}</strong>
      <p>{t('consentBody', { provider: state.provider, model: state.model })}</p>
      <p>{state.endpoint === undefined ? t('endpointUnknown') : t('endpoint', { endpoint: state.endpoint })}</p>
      <p>{t(state.stable ? 'consentKnown' : 'consentUnknown')}</p>
      <div className={css.actions}>
        <Button variant="primary" onClick={() => { state.choose('approve') }}>{t('approve')}</Button>
        <Button variant="outline" onClick={() => { state.choose('original') }}>{t('original')}</Button>
        <Button onClick={() => { state.choose('cancel') }}>{t('cancel')}</Button>
      </div>
    </section>
  }
}

/** Active-profile settings editor. */
export function EnhancementSettings({ useSettings, saveSettings, refreshSettings, readPreferences, clearApprovals, resetBilling, t }:
  PropsRuntime<'settings.section'> & PropsLocale<typeof NS> & InjectFace<SettingsInjected>) {
  const state = useSettings(value => value)
  const [draft, setDraft] = useState<PromptEnhancementPreferenceUpdate | null>(null)
  const [revision, setRevision] = useState<number | null>(null)
  const [words, setWords] = useState('')
  const [characters, setCharacters] = useState('')
  const dirty = useRef(false)
  const edits = useRef(0)
  useEffect(() => {
    void refreshSettings().catch((error: unknown) => { void error })
  }, [refreshSettings])
  useEffect(() => {
    if (state.preferences !== null && !dirty.current) {
      const { revision: _revision, ...value } = state.preferences
      setDraft(value)
      setRevision(state.preferences.revision)
      setWords(String(value.maxPromptWords))
      setCharacters(String(value.maxPromptCharacters))
    }
  }, [state.preferences])
  if (draft === null) return <div role="status">{t('loadFailed')}
    <Button onClick={() => { void refreshSettings().catch((error: unknown) => { void error }) }}>{t('refresh')}</Button></div>
  const selected = draft.provider === '' ? '' : JSON.stringify([draft.provider, draft.model])
  const maxPromptWords = positiveInteger(words)
  const maxPromptCharacters = positiveInteger(characters)
  const available = state.catalog.some(group => group.provider === draft.provider && group.models.some(model => model.id === draft.model))
  const update = (next: Partial<PromptEnhancementPreferenceUpdate>): void => {
    dirty.current = true
    edits.current++
    setDraft({ ...draft, ...next })
  }
  return <section className={css.settings}>
    <h2>{t('title')}</h2>
    <p>{t('description')}</p>
    <p>{t('privacy')}</p>
    <p>{t('lengthHelp')}</p>
    <label>{t('maxWords')}
      <input type="number" min="1" step="1" value={words} disabled={state.busy}
        aria-invalid={maxPromptWords === null} onChange={(event) => {
          dirty.current = true; edits.current++; setWords(event.target.value)
        }} />
    </label>
    <label>{t('maxCharacters')}
      <input type="number" min="1" step="1" value={characters} disabled={state.busy}
        aria-invalid={maxPromptCharacters === null} onChange={(event) => {
          dirty.current = true; edits.current++; setCharacters(event.target.value)
        }} />
    </label>
    {(maxPromptWords === null || maxPromptCharacters === null) && <p role="alert">{t('invalidLimits')}</p>}
    <label>{t('mode')}
      <select value={draft.mode} disabled={state.busy} onChange={(event) => {
        update({ mode: event.target.value === 'review' ? 'review' : 'automatic' })
      }}><option value="automatic">{t('automatic')}</option><option value="review">{t('review')}</option></select>
    </label>
    <label>{t('model')}
      <select value={selected} disabled={state.busy} onChange={(event) => {
        const choice = state.catalog.flatMap(group => group.models.map(model => ({ provider: group.provider, model: model.id })))
          .find(item => JSON.stringify([item.provider, item.model]) === event.target.value)
        update(choice ?? { provider: '', model: '' })
      }}>
        <option value="">{t('sessionModel')}</option>
        {selected !== '' && !available && <option value={selected}>{draft.provider} / {draft.model}</option>}
        {state.catalog.map(group => <optgroup key={group.provider} label={group.name}>
          {group.models.map(model => <option key={model.id} value={JSON.stringify([group.provider, model.id])}>{model.name}</option>)}
        </optgroup>)}
      </select>
    </label>
    <div className={css.actions}>
      <Button variant="primary" disabled={state.busy || revision === null || maxPromptWords === null || maxPromptCharacters === null} onClick={() => {
        if (revision === null || maxPromptWords === null || maxPromptCharacters === null) return
        void saveSettings({ ...draft, maxPromptWords, maxPromptCharacters }, revision).then((saved) => {
          if (!saved) return
          dirty.current = false
          const preferences = readPreferences()
          if (preferences === null) return
          const { revision: nextRevision, ...next } = preferences
          setRevision(nextRevision)
          setDraft(next)
          setWords(String(next.maxPromptWords))
          setCharacters(String(next.maxPromptCharacters))
        })
      }}>{t('save')}</Button>
      <Button variant="outline" disabled={state.busy} onClick={() => {
        const before = edits.current
        void refreshSettings().then(() => {
          if (edits.current !== before) return
          const preferences = readPreferences()
          if (preferences === null) return
          dirty.current = false
          const { revision: nextRevision, ...next } = preferences
          setRevision(nextRevision)
          setDraft(next)
          setWords(String(next.maxPromptWords))
          setCharacters(String(next.maxPromptCharacters))
        }).catch((error: unknown) => { void error })
      }}>{t('refresh')}</Button>
      <Button disabled={state.busy} onClick={() => { void clearApprovals() }}>{t('revoke')}</Button>
      <Button disabled={state.busy} onClick={() => { void resetBilling() }}>{t('resetBilling')}</Button>
    </div>
    {state.notice !== null && <p role="status">{t(state.notice)}</p>}
  </section>
}

/** Read a durable RPC identity from an untrusted saved message source. */
export function sourceRequestId(source: unknown): string | null {
  if (source === null || typeof source !== 'object') return null
  if (Reflect.get(source, 'kind') !== 'user') return null
  const id: unknown = Reflect.get(source, 'rpcId')
  return typeof id === 'string' && id !== '' ? id : null
}

type UserComparisonProps = PropsRuntime<'conversation.chat.user.details'> & PropsLocale<typeof NS>
type SteeringComparisonProps = PropsRuntime<'conversation.chat.steering.details'> & PropsLocale<typeof NS>

function TranscriptComparison({ source, useProjection, t }: UserComparisonProps | SteeringComparisonProps) {
  const state = useProjection('promptEnhancement')
  const id = sourceRequestId(source)
  const entry = id === null ? undefined : state?.[id]
  if (entry?.status !== 'enhanced' || entry.submitted !== true || entry.enhanced === undefined) return null
  return <div className={css.transcript}>
    <Comparison original={entry.displayOriginal} enhanced={entry.enhanced} t={t} />
    {entry.submittedText === entry.original && <small>{t('submittedOriginal')}</small>}
    {entry.submittedText !== entry.original && entry.submittedText !== entry.enhanced && <small>{t('submittedEdited')}</small>}
  </div>
}

/** Comparison above an ordinary admitted user message. */
export function UserComparison(props: UserComparisonProps) { return <TranscriptComparison {...props} /> }
/** Comparison above an admitted steering message. */
export function SteeringComparison(props: SteeringComparisonProps) { return <TranscriptComparison {...props} /> }
