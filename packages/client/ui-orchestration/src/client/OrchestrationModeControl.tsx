/** Session-projection-backed composer mode selection. */
import { useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { OrchestrationPoolActivationResult } from '@deepseek-ai/dsh-orchestration/client'
import { Button, Modal, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { OrchestrationPoolEditor, type OrchestrationInjected } from './OrchestrationPanel.tsx'
import type { NS, OrchestrationKey } from './locales.ts'
import css from './OrchestrationModeControl.module.css'

/** Session-bound operations and the shared pool editor. */
export interface OrchestrationModeInjected extends OrchestrationInjected {
  /** Turn off orchestration through the command service. */
  selectMode(this: void, active: boolean): Promise<boolean>
  /** Enable orchestration using the current pool. */
  activatePool(this: void): Promise<OrchestrationPoolActivationResult>
  /** Retry an uncertain Session durability checkpoint. */
  retryActivationStorage(this: void): Promise<boolean>
}

/** Composer slot and its session-bound operations. */
export type OrchestrationModeProps = PropsRuntime<'conversation.input.left'>
  & InjectFace<OrchestrationModeInjected> & PropsLocale<typeof NS>

/** Render the switch for root conversations only. */
export function OrchestrationModeControl(props: OrchestrationModeProps) {
  const addressedChild = props.useSession(snapshot => snapshot.subagent !== null)
  const listedChild = props.useSessions(state => state.byId[props.sessionId]?.origin === 'subagent')
  if (addressedChild || listedChild) return null
  return <RootOrchestrationModeControl {...props} />
}

function RootOrchestrationModeControl(props: OrchestrationModeProps) {
  const { sessionId, useProjection, selectMode, activatePool, retryActivationStorage, t } = props
  const mode = useProjection('orchestration')
  const [poolOpen, setPoolOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState<OrchestrationKey | null>(null)
  const inFlight = useRef(false)
  const generation = useRef(0)
  useEffect(() => {
    generation.current++
    inFlight.current = false
    setSubmitting(false)
    setPoolOpen(false)
    setNotice(null)
    return () => { generation.current++ }
  }, [sessionId])
  const active = mode === undefined ? false : mode.pending ? !mode.active : mode.active

  const activate = async (): Promise<void> => {
    if (inFlight.current) return
    const turn = generation.current
    inFlight.current = true
    setSubmitting(true)
    setNotice(null)
    try {
      const result = await activatePool()
      if (turn !== generation.current) return
      if (result.status === 'needs-pool') { setPoolOpen(true); return }
      if (result.status === 'durability') { setNotice('modeDurability'); return }
      if (result.status === 'unavailable') { setNotice('modeUnavailable'); return }
      if (result.status !== 'applied' && result.status !== 'queued') {
        setNotice(result.status === 'stale' ? 'modeStale' : 'modeFailed')
      }
    } catch (error: unknown) {
      void error
      if (turn === generation.current) setNotice('modeFailed')
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
    if (ok) void activate()
    else setNotice('modeDurability')
  }

  return <span className={css.control} aria-busy={submitting || mode?.pending === true}>
    <Switch checked={active} disabled={submitting || mode === undefined} label={t('modeOrchestration')}
      onChange={(wanted) => { if (wanted) void activate(); else void disable() }} />
    <span>{t('modeOrchestration')}</span>
    {mode?.pending === true && <span className={css.notice} role="status">{t('modePending')}</span>}
    {mode?.requiresReactivation === true && <span className={css.notice} role="status">{t('modeReactivate')}</span>}
    {notice !== null && <span className={css.notice} role="alert">{t(notice)}</span>}
    {notice === 'modeDurability' && <Button variant="toolbar" disabled={submitting} onClick={() => { void retry() }}>{t('retry')}</Button>}
    <Modal open={poolOpen} title={t('title')} closeLabel={t('close')} onClose={() => { setPoolOpen(false) }}>
      <OrchestrationPoolEditor {...props} onSaved={(pool) => {
        if (pool.length > 0) { setPoolOpen(false); void activate() }
      }} />
    </Modal>
  </span>
}
