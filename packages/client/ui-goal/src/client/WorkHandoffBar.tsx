/** Retained work status and explicit continuation actions above the composer. */

import { useRef, useState } from 'react'
import type { WorkHandoffView } from '@deepseek-ai/dsh-work-handoff/client'
import type { TodoPolicyView } from '@deepseek-ai/dsh-tool-todo/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  Button, IconCheckOutlineRegular, IconCopyOutlineRegular, IconDownloadOutlineRegular,
  IconPlayOutlineRegular, IconRightUpOutlineRegular, Tooltip, useClipboardCopy,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { GoalKey } from './locales.ts'
import type { GoalActionResult, WorkHandoffActions } from './slots.ts'
import css from './GoalBar.module.css'

/** Durable work state plus the existing legacy todo signal. */
export interface WorkHandoffBarProps extends WorkHandoffActions {
  readonly handoff: WorkHandoffView | null | undefined
  readonly hasUnfinishedTodos: boolean
  readonly todoPolicy?: TodoPolicyView | null | undefined
  readonly running: boolean
  /** An active planning restriction or stopped goal owns continuation authority. */
  readonly continuationSuspended?: boolean
}

const STATUS_LABELS = {
  'work-remains': 'work.remaining',
  waiting: 'work.waiting',
  paused: 'work.paused',
  'budget-exhausted': 'work.budgetExhausted',
} as const satisfies Record<WorkHandoffView['status'], GoalKey>

/**
 * Keep retained work visible after the model turn ends, independently of a goal.
 * @param props - projected checkpoint, legacy todo state, and user actions.
 * @returns the compact work strip, or no strip when no unfinished work is retained.
 */
export function WorkHandoffBar({
  handoff, hasUnfinishedTodos, todoPolicy, running, continuationSuspended = false,
  onContinueWork, onContinueNewSession, onDownloadHandoff, t,
}: WorkHandoffBarProps & PropsLocale<'goal'>) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pendingRef = useRef(false)
  const { copied, onCopy } = useClipboardCopy(handoff?.markdown ?? '')

  async function run(action: () => Promise<GoalActionResult | void>): Promise<void> {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setError(null)
    try {
      const result = await action()
      if (result !== undefined && !result.ok) setError(`${result.error.message} (${result.error.code})`)
    } catch (_error: unknown) {
      // The action's owner keeps the saved checkpoint; the strip reports the failed gesture.
      setError(t('work.actionFailed'))
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  const automatic = hasUnfinishedTodos && todoPolicy?.purpose === 'current-task'
    && (todoPolicy.disposition === 'active' || todoPolicy.disposition === 'limit')
    && !continuationSuspended && handoff?.saved !== false && (handoff == null || handoff.reason === 'todo-limit')
  if ((running && !automatic) || (handoff == null && !hasUnfinishedTodos)) return null
  const budgetExhausted = handoff?.status === 'budget-exhausted'
  const proposed = todoPolicy?.purpose === 'proposal'
  const legacy = hasUnfinishedTodos && (todoPolicy == null || todoPolicy.purpose === 'legacy')
  let labelKey: GoalKey = 'work.remaining'
  if (budgetExhausted) labelKey = 'work.budgetExhausted'
  else if (automatic) labelKey = 'work.automatic'
  else if (proposed) labelKey = 'work.proposed'
  else if (legacy) labelKey = 'work.confirmationRequired'
  else if (handoff != null) labelKey = STATUS_LABELS[handoff.status]
  else if (todoPolicy?.disposition === 'waiting') labelKey = 'work.waiting'
  else if (todoPolicy?.disposition === 'paused' || continuationSuspended) labelKey = 'work.paused'
  const continueKey = proposed ? 'work.approveContinue' : legacy ? 'work.confirmContinue' : 'work.continue'

  return (
    <div className={`${css.dock} ${css.workDock}`} data-work-handoff>
      <div className={`${css.bar} ${css.workBar}`}>
        <span className={css.label}>{t(labelKey)}</span>
        <span className={css.objective}>{handoff?.objective ?? t('work.unfinishedTodos')}</span>
        <div className={css.actions}>
          {!automatic && !continuationSuspended && !budgetExhausted && handoff?.goal === undefined && (proposed || legacy ? (
            <Button variant="outline" size="sm" className={css.consentBtn} disabled={pending} icon={<IconPlayOutlineRegular size={14} />}
              onClick={() => { void run(onContinueWork) }}>{t(continueKey)}</Button>
          ) : (
            <Tooltip portal label={t(continueKey)} side="bottom" delayMs={500}>
              <button type="button" className={css.iconBtn} disabled={pending}
                aria-label={t(continueKey)} onClick={() => { void run(onContinueWork) }}>
                <IconPlayOutlineRegular size={14} />
              </button>
            </Tooltip>
          ))}
          {!automatic && handoff != null && (
            <>
              <Tooltip portal label={t(copied ? 'work.copied' : 'work.copy')} side="bottom" delayMs={500}>
                <button type="button" className={css.iconBtn} aria-label={t(copied ? 'work.copied' : 'work.copy')}
                  disabled={pending} onClick={onCopy}>
                  {copied ? <IconCheckOutlineRegular size={14} /> : <IconCopyOutlineRegular size={14} />}
                </button>
              </Tooltip>
              <Tooltip portal label={t('work.download')} side="bottom" delayMs={500}>
                <button type="button" className={css.iconBtn} aria-label={t('work.download')} disabled={pending}
                  onClick={() => { void run(() => onDownloadHandoff(handoff)) }}>
                  <IconDownloadOutlineRegular size={14} />
                </button>
              </Tooltip>
              <Tooltip portal label={t('work.newSession')} side="bottom" delayMs={500}>
                <button type="button" className={css.iconBtn} aria-label={t('work.newSession')} disabled={pending || !handoff.saved}
                  onClick={() => { void run(() => onContinueNewSession(handoff.id)) }}>
                  <IconRightUpOutlineRegular size={14} />
                </button>
              </Tooltip>
            </>
          )}
        </div>
        {handoff?.saved === false && <span className={`${css.error} ${css.workError}`} role="alert">{t('work.unsaved')}</span>}
        {error !== null && <span className={`${css.error} ${css.workError}`} role="alert">{error}</span>}
      </div>
    </div>
  )
}
