/** Orchestration settings page: pick the multi-model pool from the provider capability catalog and save it to the Host. */
import { useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PoolRoute } from '@deepseek-ai/dsh-experimental-orchestration/types'
import type { ModelCapability, TaskDomain } from '@deepseek-ai/dsh-experimental-orchestration/src/capabilities.ts'
import { PADERBORN_CATALOG } from '@deepseek-ai/dsh-experimental-orchestration/src/capabilities.ts'
import { NS, type OrchestrationKey } from './locales.ts'
import css from './OrchestrationPanel.module.css'

/**
 * The provider route of every catalog entry: the Paderborn AI-Gateway
 * investigates a single OpenAI-compatible provider, so one route serves all.
 */
const PROVIDER = 'paderborn'

/** Capability badge keys, one per catalog discipline plus the image-input flag. */
const BADGES: Readonly<{ key: OrchestrationKey; domain: TaskDomain | 'image' }[]> = [
  { key: 'badgeImage', domain: 'image' },
  { key: 'badgeReasoning', domain: 'reasoning' },
  { key: 'badgeCoding', domain: 'coding' },
  { key: 'badgeVision', domain: 'vision' },
  { key: 'badgeAllrounder', domain: 'allrounder' },
  { key: 'badgeEuropean', domain: 'european' },
]

/** Whether one catalog entry carries the badge named by `domain`. */
function hasBadge(capability: ModelCapability, domain: TaskDomain | 'image'): boolean {
  return domain === 'image' ? capability.imageInput : capability.domains.includes(domain)
}

/** A checkable catalog row with its capability badges. */
function CatalogRow({
  capability, checked, onToggle, t,
}: {
  capability: ModelCapability
  checked: boolean
  onToggle: (id: string, checked: boolean) => void
  t: PropsLocale<typeof NS>['t']
}) {
  const badges = BADGES.filter(badge => hasBadge(capability, badge.domain))
  return (
    <li className={css.row} data-orchestration-row={capability.id}>
      <label className={css.rowMain}>
        <input
          type="checkbox"
          className={css.checkbox}
          checked={checked}
          onChange={(event) => { onToggle(capability.id, event.target.checked) }}
        />
        <span className={css.rowText}>
          <span className={css.rowHead}>
            <strong>{capability.name}</strong>
            <code className={css.rowId}>{capability.id}</code>
          </span>
          <small className={css.rowSuggested}>{t('suggested')}: {capability.suggested}</small>
          <span className={css.badges}>
            {badges.map(badge => <span key={badge.key} className={css.badge}>{t(badge.key)}</span>)}
          </span>
        </span>
      </label>
    </li>
  )
}

/** What the browser plugin injects: the Host pool and the call that persists a replacement. */
export interface OrchestrationInjected {
  /** The pool persisted on the Host when the panel mounted. */
  readonly pool: readonly PoolRoute[]
  /** Persist a replacement pool to the Host; resolves true when it was accepted. */
  readonly setPool: (pool: readonly PoolRoute[]) => Promise<boolean>
}

/** Props assembled by the settings renderer. */
export type OrchestrationPanelProps =
  PropsRuntime<'settings.section'> & InjectFace<OrchestrationInjected> & PropsLocale<typeof NS>

/**
 * Render the provider catalog with capability badges as checkable rows to
 * select the multi-model pool. Selection is optimistic local state drawn from
 * the injected Host pool; every toggle persists the new pool through the
 * injected `setPool` and reports a refused write. The component is function-only
 * and uses no DOM refs.
 * @param props - settings runtime, the injected pool and setter, and localized copy.
 * @returns The Orchestration settings section.
 */
export function OrchestrationPanel({ pool, setPool, t }: OrchestrationPanelProps) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(pool.map(route => route.model)))
  const [notice, setNotice] = useState<OrchestrationKey | undefined>(undefined)
  const toggle = (id: string, checked: boolean): void => {
    const next = new Set(selected)
    if (checked) next.add(id)
    else next.delete(id)
    setSelected(next)
    setNotice(undefined)
    const routes: readonly PoolRoute[] = [...next].map(model => ({ provider: PROVIDER, model }))
    void setPool(routes).then((ok) => {
      if (!ok) setNotice('saveFailed')
    })
  }
  return (
    <section className={css.section}>
      <h2 className={css.title}>{t('title')}</h2>
      <p className={css.subtitle}>{t('subtitle')}</p>
      <ul className={css.list}>
        {PADERBORN_CATALOG.map(capability => (
          <CatalogRow
            key={capability.id}
            capability={capability}
            checked={selected.has(capability.id)}
            onToggle={toggle}
            t={t}
          />
        ))}
      </ul>
      <p className={css.poolHint} role="status">
        {notice !== undefined ? t(notice) : (selected.size === 0
          ? t('noneSelected')
          : `${t('selectedPool')} (${selected.size}) — ${t('poolHint')}`)}
      </p>
    </section>
  )
}
