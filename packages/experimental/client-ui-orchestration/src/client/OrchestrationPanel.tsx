/** Orchestration settings page: pick the multi-model pool from the live provider catalog and save it to the Host. */
import { useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { OrchestrationCatalog, OrchestrationCatalogModel, PoolRoute, PoolSaveResult, PoolSettingsState } from '@deepseek-ai/dsh-orchestration/client'
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
  capability, checked, disabled, onToggle, t,
}: {
  capability: OrchestrationCatalogModel
  checked: boolean
  disabled: boolean
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
          disabled={disabled}
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
  /** Current profile settings revision, or null when settings are unavailable. */
  readonly revision: number | null
  /** Read the current pool and catalog when the panel opens. */
  readonly refresh: () => Promise<PoolSettingsState & { readonly catalog: OrchestrationCatalog }>
  /** Persist a replacement pool against the revision the user read. */
  readonly setPool: (pool: readonly PoolRoute[], revision: number) => Promise<PoolSaveResult>
  /** Clear observed billing failures after the user corrects the account. */
  readonly resetBillingHealth: () => Promise<boolean>
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
 * from the effective Host pool; Select all and Clear adjust it, and Save persists
 * the whole pool through the injected `setPool`, reporting a refused write.
 * @param props - settings runtime, the injected pool and setter, and localized copy.
 * @returns The Orchestration settings section.
 */
export function OrchestrationPanel({
  pool, catalog: initialCatalog, revision: initialRevision, refresh, setPool, resetBillingHealth, t,
}: OrchestrationPanelProps) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(pool.map(routeKey)))
  const [catalog, setCatalog] = useState(initialCatalog)
  const [revision, setRevision] = useState(initialRevision)
  const [notice, setNotice] = useState<OrchestrationKey | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [stale, setStale] = useState(false)
  const dirtyRef = useRef(false)

  useEffect(() => {
    let active = true
    void refresh().then((current) => {
      if (!active || dirtyRef.current) return
      setCatalog(current.catalog)
      setSelected(new Set(current.pool.map(routeKey)))
      setRevision(current.revision)
      if (current.revision === null) setNotice('loadFailed')
    }, () => { if (active) setNotice('loadFailed') })
    return () => { active = false }
  }, [refresh])

  const save = (): void => {
    if (revision === null) return
    setNotice(undefined)
    const routes: readonly PoolRoute[] = [...selected].map(routeFromKey)
    setSaving(true)
    void setPool(routes, revision).then((result) => {
      if (result.status === 'saved') {
        setSelected(new Set(result.pool.map(routeKey)))
        setRevision(result.revision)
        dirtyRef.current = false
        setDirty(false)
        setStale(false)
        setNotice('savedOk')
      } else {
        setStale(result.status === 'stale')
        setNotice(result.status === 'stale' ? 'saveStale' : 'saveFailed')
      }
    }, () => { setNotice('saveFailed') }).finally(() => { setSaving(false) })
  }

  const setSelection = (next: ReadonlySet<string>): void => {
    setSelected(next)
    dirtyRef.current = true
    setDirty(true)
    setNotice(stale ? 'saveStale' : undefined)
  }

  const toggle = (id: string, checked: boolean): void => {
    const next = new Set(selected)
    if (checked) next.add(id)
    else next.delete(id)
    setSelection(next)
  }

  const selectAll = (): void => {
    setSelection(new Set(catalog.groups.flatMap(group =>
      group.models.map(model => routeKey({ provider: model.provider, model: model.id })))))
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
        <button type="button" className={css.linkButton} disabled={saving} onClick={selectAll}>{t('selectAll')}</button>
        <button type="button" className={css.linkButton} disabled={saving} onClick={clear}>{t('clearAll')}</button>
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
                  disabled={saving}
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
        disabled={saving || !dirty || revision === null || stale}
        onClick={save}
      >
        {saving ? t('saving') : t('save')}
      </button>
      {stale && <button type="button" className={css.linkButton} disabled={saving} onClick={() => {
        setSaving(true)
        void refresh().then((current) => {
          if (current.revision === null) { setNotice('loadFailed'); return }
          setCatalog(current.catalog)
          setRevision(current.revision)
          setStale(false)
          setNotice('settingsRefreshed')
        }, () => { setNotice('loadFailed') }).finally(() => { setSaving(false) })
      }}>{t('refreshSettings')}</button>}
      <button type="button" className={css.linkButton} disabled={saving} onClick={() => {
        setSaving(true)
        void resetBillingHealth().then((ok) => { setNotice(ok ? 'billingReset' : 'saveFailed') },
          () => { setNotice('saveFailed') }).finally(() => { setSaving(false) })
      }}>{t('resetBilling')}</button>
    </section>
  )
}
