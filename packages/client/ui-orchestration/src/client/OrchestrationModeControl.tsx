/** Session-projection-backed composer mode selection. */
import { useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { OrchestrationActivationPreflight, OrchestrationActivationResult, OrchestrationReviewId } from '@deepseek-ai/dsh-orchestration/client'
import { Button, Modal, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { OrchestrationPoolEditor, type OrchestrationInjected } from './OrchestrationPanel.tsx'
import type { NS, OrchestrationKey } from './locales.ts'
import css from './OrchestrationModeControl.module.css'

/** Session-bound operations and the shared pool editor. */
export interface OrchestrationModeInjected extends OrchestrationInjected {
  /** Select a mode through the existing command service. */
  selectMode(this: void, active: boolean): Promise<boolean>
  /** Review the pool and Session permissions before enabling. */
  prepareActivation(this: void): Promise<OrchestrationActivationPreflight>
  /** Apply the reviewed selection and any explicitly approved routes. */
  activateReviewed(this: void, reviewId: OrchestrationReviewId, authorize: boolean): Promise<OrchestrationActivationResult>
  /** Retry an uncertain Session durability checkpoint. */
  retryActivationStorage(this: void): Promise<boolean>
}

/** Composer slot and its session-bound operations. */
export type OrchestrationModeProps = PropsRuntime<'conversation.input.left'>
  & InjectFace<OrchestrationModeInjected> & PropsLocale<typeof NS>

type Review = Extract<OrchestrationActivationPreflight, { status: 'ready' | 'authorize' }>

/** Render the Session mode switch and explicit pool-authorization flow. */
export function OrchestrationModeControl(props: OrchestrationModeProps) {
  const { sessionId, useProjection, selectMode, prepareActivation, activateReviewed, retryActivationStorage, t } = props
  const mode = useProjection('orchestration')
  const [dialog, setDialog] = useState<'pool' | 'review' | null>(null)
  const [review, setReview] = useState<Review | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState<OrchestrationKey | null>(null)
  const inFlight = useRef(false)
  const generation = useRef(0)
  useEffect(() => {
    generation.current++
    inFlight.current = false
    setSubmitting(false)
    setDialog(null)
    setReview(null)
    setNotice(null)
    return () => { generation.current++ }
  }, [sessionId])
  const active = mode === undefined ? false : mode.pending ? !mode.active : mode.active

  const prepare = async (reviewOnly = false): Promise<void> => {
    if (inFlight.current) return
    const turn = generation.current
    inFlight.current = true
    setSubmitting(true)
    setNotice(null)
    try {
      const result = await prepareActivation()
      if (turn !== generation.current) return
      if (result.status === 'needs-pool') { setDialog('pool'); return }
      if (result.status === 'durability') { setNotice('modeDurability'); return }
      if (result.status === 'child-restricted') { setNotice('modeChildRestricted'); return }
      if (result.status === 'unavailable') { setNotice('modeUnavailable'); return }
      if (result.status === 'authorize') { setReview(result); setDialog('review'); return }
      if (!('reviewId' in result)) { setNotice('modeUnavailable'); return }
      if (reviewOnly) { setNotice('modeAccessCurrent'); return }
      const applied = await activateReviewed(result.reviewId, false)
      if (turn !== generation.current) return
      if (applied.status !== 'applied' && applied.status !== 'queued') {
        setNotice(applied.status === 'stale' ? 'modeStale' : 'modeFailed')
      }
    } catch (error: unknown) {
      void error
      if (turn === generation.current) setNotice('modeFailed')
    } finally {
      if (turn === generation.current) { inFlight.current = false; setSubmitting(false) }
    }
  }

  const confirm = async (): Promise<void> => {
    if (review === null || inFlight.current) return
    const turn = generation.current
    inFlight.current = true
    setSubmitting(true)
    try {
      const result = await activateReviewed(review.reviewId, true)
      if (turn !== generation.current) return
      setDialog(null)
      setReview(null)
      if (result.status !== 'applied' && result.status !== 'queued') {
        setNotice(result.status === 'stale' ? 'modeStale' : 'modeDurability')
      }
    } catch (error: unknown) {
      void error
      if (turn === generation.current) { setDialog(null); setNotice('modeFailed') }
    } finally {
      if (turn === generation.current) { inFlight.current = false; setSubmitting(false) }
    }
  }

  const disable = async (): Promise<void> => {
    if (inFlight.current) return
    const turn = generation.current
    inFlight.current = true
    setSubmitting(true)
    setNotice(null)
    try { if (!await selectMode(false) && turn === generation.current) setNotice('modeFailed') }
    catch (error: unknown) { void error; if (turn === generation.current) setNotice('modeFailed') }
    finally { if (turn === generation.current) { inFlight.current = false; setSubmitting(false) } }
  }

  const retry = async (): Promise<void> => {
    if (inFlight.current) return
    const turn = generation.current
    inFlight.current = true
    setSubmitting(true)
    let ok = false
    try { ok = await retryActivationStorage() } catch (error: unknown) { void error }
    if (turn !== generation.current) return
    inFlight.current = false
    setSubmitting(false)
    if (ok) void prepare(active)
    else setNotice('modeDurability')
  }

  return <span className={css.control} aria-busy={submitting || mode?.pending === true}>
    <Switch checked={active} disabled={submitting || mode === undefined} label={t('modeOrchestration')}
      onChange={(wanted) => { if (wanted) void prepare(); else void disable() }} />
    <span>{t('modeOrchestration')}</span>
    {active && <Button variant="toolbar" disabled={submitting} onClick={() => { void prepare(true) }}>{t('reviewAccess')}</Button>}
    {mode?.pending === true && <span className={css.notice} role="status">{t('modePending')}</span>}
    {notice !== null && <span className={css.notice} role={notice === 'modeAccessCurrent' ? 'status' : 'alert'}>{t(notice)}</span>}
    {notice === 'modeDurability' && <Button variant="toolbar" disabled={submitting} onClick={() => { void retry() }}>{t('retry')}</Button>}
    <Modal open={dialog === 'pool'} title={t('title')} closeLabel={t('close')} onClose={() => { setDialog(null) }}>
      <OrchestrationPoolEditor {...props} onSaved={(pool) => {
        if (pool.length > 0) { setDialog(null); void prepare(active) }
      }} />
    </Modal>
    <Modal open={dialog === 'review'} title={t('authorizeTitle')} closeLabel={t('close')} onClose={() => { setDialog(null) }}>
      <p>{t('authorizeHelp')}</p>
      <ul>{review?.additionalRoutes.map(route => <li key={`${route.provider}/${route.model}`}>
        <code>{route.provider}/{route.model}</code>
      </li>)}</ul>
      <Button variant="primary" disabled={submitting} onClick={() => { void confirm() }}>{t('authorize')}</Button>
      <Button disabled={submitting} onClick={() => { setDialog(null) }}>{t('cancel')}</Button>
    </Modal>
  </span>
}
