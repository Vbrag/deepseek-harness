// @vitest-environment jsdom
/** Project-document status remains independent of goal and task completion. */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { ProjectContextView } from '@deepseek-ai/dsh-project-context/types'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { ProjectContextStatus } from '../src/client/ProjectContextStatus.tsx'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh, commonZh)
afterEach(cleanup)

function view(status: ProjectContextView['status']): ProjectContextView {
  return { sourceTurn: 2, knowledgeWatermark: SessionSeq(20), status, contextPath: '/project/PROJECT_CONTEXT.md' }
}

describe('project context status', () => {
  it.each([null, undefined])('renders no status before a project assessment exists: %s', (state) => {
    const result = render(<ProjectContextStatus view={state} t={t} />)
    expect(result.container.firstChild).toBeNull()
  })

  it.each([
    ['pending', '项目笔记待更新'], ['updating', '正在更新项目笔记'], ['updated', '项目笔记已更新'],
    ['unchanged', '项目笔记无需更改'], ['deferred', '项目笔记更新已延后'], ['failed', '项目笔记更新失败'],
  ] as const)('shows %s as document status without completion or continuation actions', (status, label) => {
    render(<ProjectContextStatus view={view(status)} t={t} />)
    expect(screen.getByText(label)).toBeTruthy()
    expect(screen.getByText('/project/PROJECT_CONTEXT.md')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows a deferred reason ahead of its successful earlier summary', () => {
    render(<ProjectContextStatus view={{ ...view('deferred'), summary: 'Saved earlier facts', reason: 'User paused work' }} t={t} />)
    expect(screen.getByText('User paused work')).toBeTruthy()
    expect(screen.queryByText('Saved earlier facts')).toBeNull()
  })
})
