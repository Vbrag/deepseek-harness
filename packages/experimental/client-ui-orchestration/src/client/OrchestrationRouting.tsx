/** Lead and child model progress in the session panel, using published projection snapshots. */

import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { OrchestrationRoutingState, PoolRoute } from '@deepseek-ai/dsh-orchestration/client'
import type {} from '@deepseek-ai/dsh-client-ui-session-panel/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { NS, OrchestrationKey } from './locales.ts'
import css from './OrchestrationRouting.module.css'

/** Session panel section and its framework-bound projection hooks. */
export type OrchestrationRoutingProps =
  PropsRuntime<'conversation.session.panel.section'> & PropsLocale<typeof NS>

const statusKeys = {
  idle: 'routingIdle', queued: 'routingQueued', changing: 'routingChanging',
  waiting: 'routingWaiting', blocked: 'routingBlocked',
} satisfies Record<OrchestrationRoutingState['status'], OrchestrationKey>

function same(left: PoolRoute | null | undefined, right: PoolRoute | null | undefined): boolean {
  return left != null && right != null && left.provider === right.provider && left.model === right.model
}

function routeLabel(route: PoolRoute): string {
  return `${route.provider}/${route.model}`
}

/**
 * Show the model used by the last admitted request separately from selected and requested future routes.
 * Catalog opening owns projection refresh; rendering neither loads Sessions nor reads their logs.
 * @param props - Session list snapshots and localized labels supplied by the session panel section.
 * @returns Model progress for the lead and observed local children, or nothing before routing facts are available.
 */
export function OrchestrationRouting({ sessionId, useSessions, t }: OrchestrationRoutingProps) {
  const projections = useSessions(state => state.projectionsBySession)
  const summaries = useSessions(state => state.byId)
  const children = projections[sessionId]?.values.subagentCatalog ?? []
  const rows = children.flatMap((child) => {
    if (child.mode === 'external') return []
    const snapshot = projections[child.id]
    if (snapshot?.state !== 'ready') return []
    const routing = snapshot.values.orchestrationRouting
    if (routing === undefined || (routing.assessment === null && routing.status === 'idle')) return []
    return [{ id: child.id, name: 'name' in child ? child.name ?? child.id : summaries[child.id]?.displayTitle ?? child.id,
      routing, current: snapshot.values.modelSelection?.lastUsed ?? null }]
  })
  const lead = projections[sessionId]
  const leadRouting = lead?.state === 'ready' ? lead.values.orchestrationRouting : undefined
  if (leadRouting !== undefined && (leadRouting.assessment !== null || leadRouting.status !== 'idle')) {
    rows.unshift({ id: sessionId, name: t('routingLead'), routing: leadRouting,
      current: lead?.state === 'ready' ? lead.values.modelSelection?.lastUsed ?? null : null })
  }
  if (rows.length === 0) return null
  return (
    <section className={css.section} aria-label={t('routingTitle')} data-orchestration-routing>
      <h3 className={css.title}>{t('routingTitle')}</h3>
      <ul className={css.list}>
        {rows.map(({ id, name, routing, current }) => {
          const selected = same(routing.route, current) ? null : routing.route
          const requested = routing.request?.preferredRoute
          return (
            <li key={id} className={css.row} data-orchestration-child={id} data-status={routing.status}>
              <div className={css.heading}>
                <h4 className={css.name}>{name}</h4>
                <span className={css.status}>{t(statusKeys[routing.status])}</span>
              </div>
              <dl className={css.routes}>
                <dt>{t('routingCurrent')}</dt><dd data-orchestration-current>{current === null ? t('routingNoRequest') : routeLabel(current)}</dd>
                {selected !== null && <><dt>{t('routingSelected')}</dt><dd data-orchestration-selected>{routeLabel(selected)}</dd></>}
                {requested !== undefined && !same(requested, selected) && (
                  <><dt>{t('routingRequested')}</dt><dd data-orchestration-requested>{routeLabel(requested)}</dd></>
                )}
                {routing.previous !== null && <><dt>{t('routingPrevious')}</dt><dd>{routeLabel(routing.previous)}</dd></>}
              </dl>
              {routing.reason !== '' && <p className={css.reason}><span>{t('routingReason')}: </span>{routing.reason}</p>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
