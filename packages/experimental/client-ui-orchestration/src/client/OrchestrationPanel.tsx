/** Orchestration settings page: pick the multi-model pool from the live provider catalog and save it to the Host. */
import { useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { OrchestrationCatalog, OrchestrationCatalogModel, PoolRoute } from '@deepseek-ai/dsh-orchestration/types'
import type { TaskDomain } from '@deepseek-ai/dsh-orchestration/capabilities'
import { NS, type OrchestrationKey } from './locales.ts'
import css from './OrchestrationPanel.module.css'

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
function hasBadge(capability: OrchestrationCatalogModel, domain: TaskDomain | 'image'): boolean {
  return domain === 'image' ? capability.imageInput : capability.domains.includes(domain)
}

/** A checkable catalog row with its capability badges. */
function CatalogRow({
  capability, checked, onToggle, t,
}: {
  capability: OrchestrationCatalogModel
  checked: boolean
  onToggle: (key: string, checked: boolean) => void
  t: PropsLocale<typeof NS>['t']
}) {
  const badges = BADGES.filter(badge => hasBadge(capability, badge.domain))
  const key = routeKey({ provider: capability.provider, model: capability.id })
  return (
    <li className={css.row} data-orchestration-row={capability.id}>
      <label className={css.rowMain}>
        <input
          type="checkbox"
          className={css.checkbox}
          checked={checked}
          onChange={(event) => { onToggle(key, event.target.checked) }}
        />
        <span className={css.rowText}>
          <span className={css.rowHead}>
            <strong>{capability.name}</strong>
            <code className={css.rowId}>{capability.id}</code>
          </span>
          {capability.suggested.length > 0 && (
            <small className={css.rowSuggested}>{t('suggested')}: {capability.suggested}</small>
          )}
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
  /** Provider-grouped live catalog projected by the Host. */
  readonly catalog: OrchestrationCatalog
  /** The pool persisted on the Host when the panel mounted. */
  readonly pool: readonly PoolRoute[]
  /** Persist a replacement pool to the Host; resolves true when it was accepted. */
  readonly setPool: (pool: readonly PoolRoute[]) => Promise<boolean>
}

/** Props assembled by the settings renderer. */
export type OrchestrationPanelProps =
  PropsRuntime<'settings.section'> & InjectFace<OrchestrationInjected> & PropsLocale<typeof NS>

/** Stable route identity for a model row across providers. */
function routeKey(route: PoolRoute): string {
  return `${route.provider}/${route.model}`
}

/** Recover a route from its provider-prefixed key, splitting on the first separator. */
function routeFromKey(key: string): PoolRoute {
  const index = key.indexOf('/')
  return index < 0 ? { provider: '', model: key } : { provider: key.slice(0, index), model: key.slice(index + 1) }
}

/**
 * Render the live provider catalog grouped by provider with capability badges as
 * checkable rows to select the multi-model pool. Selection is local state drawn
 * from the injected Host pool; Select all and Clear adjust it, and Save persists
 * the whole pool through the injected `setPool`, reporting a refused write. When
 * nothing is persisted the panel defaults to every catalog model selected, so the
 * full pool is available immediately. The component is function-only and uses no DOM refs.
 * @param props - settings runtime, the injected pool and setter, and localized copy.
 * @returns The Orchestration settings section.
 */
export function OrchestrationPanel({ pool, catalog, setPool, t }: OrchestrationPanelProps) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => {
    const persisted = pool.map(routeKey)
    return persisted.length > 0
      ? new Set(persisted)
      : new Set(catalog.groups.flatMap(group => group.models.map(model => routeKey({ provider: model.provider, model: model.id }))))
  })
  const [notice, setNotice] = useState<OrchestrationKey | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  const save = (): void => {
    setNotice(undefined)
    const routes: readonly PoolRoute[] = [...selected].map(routeFromKey)
    setSaving(true)
    void setPool(routes).then((ok) => {
      setSaving(false)
      setDirty(false)
      setNotice(ok ? 'savedOk' : 'saveFailed')
    })
  }

  const setSelection = (next: ReadonlySet<string>): void => {
    setSelected(next)
    setDirty(true)
    setNotice(undefined)
  }

  const toggle = (id: string, checked: boolean): void => {
    const next = new Set(selected)
    if (checked) next.add(id)
    else next.delete(id)
    setSelection(next)
  }

  const selectAll = (): void => {
    setSelection(new Set(catalog.groups.flatMap(group => group.models.map(model => routeKey({ provider: model.provider, model: model.id })))))
  }

  const clear = (): void => {
    setSelection(new Set())
  }

  const status: OrchestrationKey = notice ?? (selected.size === 0 ? 'noneSelected' : 'selectedPool')

  return (
    <section className={css.section}>
      <h2 className={css.title}>{t('title')}</h2>
      <p className={css.subtitle}>{t('subtitle')}</p>
      <div className={css.toolbar}>
        <button type="button" className={css.linkButton} onClick={selectAll}>{t('selectAll')}</button>
        <button type="button" className={css.linkButton} onClick={clear}>{t('clearAll')}</button>
        <span className={css.count}>{t('selectedPool')} ({selected.size})</span>
      </div>
      {catalog.groups.map(group => (
        <div key={group.provider} className={css.group}>
          <h3 className={css.groupTitle}>{group.name}</h3>
          <ul className={css.list}>
            {group.models.map((capability) => {
              const key = routeKey({ provider: capability.provider, model: capability.id })
              return (
                <CatalogRow
                  key={key}
                  capability={capability}
                  checked={selected.has(key)}
                  onToggle={toggle}
                  t={t}
                />
              )
            })}
          </ul>
        </div>
      ))}
      <p className={css.poolHint} role="status">{t(status)}</p>
      <button
        type="button"
        className={css.saveButton}
        disabled={saving || !dirty}
        onClick={save}
      >
        {saving ? t('saving') : t('save')}
      </button>
    </section>
  )
}
