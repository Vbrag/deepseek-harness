/** Session-projection-backed composer mode selection. */
import { useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-experimental-orchestration/client'
import { Button, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NS } from './locales.ts'
import css from './OrchestrationModeControl.module.css'

/** Session-bound command operation provided by the registration. */
export interface OrchestrationModeInjected {
  /** Select a mode; false means the command was refused or unavailable. */
  selectMode(active: boolean): Promise<boolean>
}

/** Derived composer slot, command operation, and localized labels. */
export type OrchestrationModeProps = PropsRuntime<'conversation.input.left'>
  & InjectFace<OrchestrationModeInjected> & PropsLocale<typeof NS>

/**
 * Select Default or Orchestration without optimistic mode state. The host
 * projection owns the displayed choice, including a queued mid-turn selection.
 * @param props - Session hooks, command operation, and localized labels.
 * @returns The composer selector, or nothing when the capability is absent.
 */
export function OrchestrationModeControl({ useProjection, selectMode, t }: OrchestrationModeProps) {
  const mode = useProjection('orchestration')
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [failed, setFailed] = useState(false)
  const inFlight = useRef(false)
  if (mode === undefined) return null
  const active = mode.pending ? !mode.active : mode.active
  const choose = async (id: string): Promise<void> => {
    setOpen(false)
    const wanted = id === 'orchestration'
    if (wanted === active || inFlight.current) return
    inFlight.current = true
    setSubmitting(true)
    setFailed(false)
    try {
      setFailed(!await selectMode(wanted))
    } catch (error) {
      // A rejected command leaves the host-projected choice visible and retryable.
      void error
      setFailed(true)
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }
  return (
    <span className={css.control}>
      <Menu
        open={open}
        portal
        side="top"
        selectedId={active ? 'orchestration' : 'default'}
        items={[
          { id: 'default', label: t('modeDefault') },
          { id: 'orchestration', label: t('modeOrchestration') },
        ]}
        onSelect={(id) => { void choose(id) }}
        onClose={() => { setOpen(false) }}
        anchor={(
          <Button
            variant="toolbar"
            aria-label={t('modeLabel')}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-busy={submitting || mode.pending}
            disabled={submitting}
            onClick={() => { setOpen(!open) }}
          >
            {active ? t('modeOrchestration') : t('modeDefault')}
          </Button>
        )}
      />
      {mode.pending && <span className={css.notice} role="status">{t('modePending')}</span>}
      {failed && <span className={css.notice} role="alert">{t('modeFailed')}</span>}
    </span>
  )
}
