/** Project-document maintenance status, separate from task completion. */

import type { ProjectContextView } from '@deepseek-ai/dsh-project-context/types'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { GoalKey } from './locales.ts'
import css from './GoalBar.module.css'

const LABELS = {
  pending: 'project.pending',
  updating: 'project.updating',
  updated: 'project.updated',
  unchanged: 'project.unchanged',
  deferred: 'project.deferred',
  failed: 'project.failed',
} as const satisfies Record<ProjectContextView['status'], GoalKey>

/**
 * Show the last root-turn assessment without asserting that work is complete.
 * @param props - projected maintenance status and localized copy.
 * @returns a compact status row, or nothing before project maintenance is observed.
 */
export function ProjectContextStatus({ view, t }: {
  readonly view: ProjectContextView | null | undefined
} & PropsLocale<'goal'>) {
  if (view == null) return null
  const detail = view.status === 'failed' || view.status === 'deferred'
    ? view.reason ?? view.summary ?? view.contextPath
    : view.summary ?? view.contextPath
  return (
    <div className={`${css.dock} ${css.workDock}`} data-project-context-status={view.status}>
      <div className={`${css.bar} ${css.workBar}`} title={detail}>
        <span className={css.label}>{t(LABELS[view.status])}</span>
        {detail !== undefined && <span className={css.objective}>{detail}</span>}
      </div>
    </div>
  )
}
