// @vitest-environment jsdom
/** Work status stays visible after a turn, including sessions without a goal. */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { makeTranslate, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { TodoPolicyView } from '@deepseek-ai/dsh-tool-todo/client'
import type { GoalId } from '@deepseek-ai/dsh-goal/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkHandoffId, WorkHandoffView } from '@deepseek-ai/dsh-work-handoff/client'
import { WorkHandoffBar } from '../src/client/WorkHandoffBar.tsx'
import type { GoalActionResult, WorkHandoffActions } from '../src/client/slots.ts'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh, commonZh)
const currentPolicy: TodoPolicyView = { purpose: 'current-task', disposition: 'active', completedHighWater: 0, repairAttempts: 0 }

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function handoff(overrides: Partial<WorkHandoffView> = {}): WorkHandoffView {
  return {
    id: brandString<WorkHandoffId>('checkpoint-1'), sourceSessionId: brandString<SessionId>('session-1'),
    turn: 2, reason: 'paused', status: 'work-remains', objective: 'Finish verified work',
    markdown: '# Work remains\n\nCheck the pending tests.\n', saved: true, todos: [], ...overrides,
  }
}

function actions() {
  return {
    onContinueWork: vi.fn<WorkHandoffActions['onContinueWork']>(async () => ({ ok: true, value: undefined })),
    onContinueNewSession: vi.fn<WorkHandoffActions['onContinueNewSession']>(async () => ({ ok: true, value: undefined })),
    onDownloadHandoff: vi.fn<WorkHandoffActions['onDownloadHandoff']>(async () => {}),
  } satisfies WorkHandoffActions
}

describe('work handoff strip', () => {
  it.each(['active', 'limit'] as const)('shows automatic %s execution without requesting a manual continuation', (disposition) => {
    const verbs = actions()
    render(<WorkHandoffBar todoPolicy={{ ...currentPolicy, disposition }}
      handoff={disposition === 'limit' ? handoff({ reason: 'todo-limit' }) : null}
      hasUnfinishedTodos running={false} {...verbs} t={t} />)
    expect(screen.getByText('正在自动继续')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '继续工作' })).toBeNull()
    expect(verbs.onContinueWork).not.toHaveBeenCalled()
  })

  it('keeps automatic status visible while the authorized task is running', () => {
    render(<WorkHandoffBar todoPolicy={currentPolicy} handoff={null} hasUnfinishedTodos running {...actions()} t={t} />)
    expect(screen.getByText('正在自动继续')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('does not promise automatic execution while a goal is suspended', () => {
    render(<WorkHandoffBar todoPolicy={currentPolicy} handoff={null} hasUnfinishedTodos running={false}
      continuationSuspended {...actions()} t={t} />)
    expect(screen.getByText('已暂停')).toBeTruthy()
    expect(screen.queryByText('正在自动继续')).toBeNull()
    expect(screen.queryByRole('button', { name: '继续工作' })).toBeNull()
  })

  it('offers an explicit continuation for legacy unfinished todos without a goal or checkpoint', async () => {
    const verbs = actions()
    render(<WorkHandoffBar todoPolicy={{ ...currentPolicy, purpose: 'legacy' }} handoff={null}
      hasUnfinishedTodos running={false} {...verbs} t={t} />)
    expect(screen.getByText('需要确认')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '在新会话中继续' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '确认并继续' }))
    await waitFor(() => { expect(verbs.onContinueWork).toHaveBeenCalledOnce() })
  })

  it.each([
    ['work-remains', '仍有待办工作'], ['waiting', '等待中'], ['paused', '已暂停'], ['budget-exhausted', '已暂停：轮次预算耗尽'],
  ] as const)('renders %s independently from turn completion', (status, label) => {
    render(<WorkHandoffBar todoPolicy={currentPolicy} handoff={handoff({ status })}
      hasUnfinishedTodos running={false} {...actions()} t={t} />)
    expect(screen.getByText(label)).toBeTruthy()
    expect(screen.getByText('Finish verified work')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '继续工作' }) !== null).toBe(status !== 'budget-exhausted')
  })

  it('labels a proposed list and requires an explicit approval action', async () => {
    const verbs = actions()
    render(<WorkHandoffBar todoPolicy={{ ...currentPolicy, purpose: 'proposal', disposition: 'paused' }}
      handoff={null} hasUnfinishedTodos running={false} {...verbs} t={t} />)
    expect(screen.getByText('提议的工作')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '继续工作' })).toBeNull()
    expect(verbs.onContinueWork).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '批准并继续' }))
    await waitFor(() => { expect(verbs.onContinueWork).toHaveBeenCalledOnce() })
  })

  it.each([
    ['waiting', '等待中'], ['paused', '已暂停'],
  ] as const)('renders %s policy without requiring a captured handoff', (disposition, label) => {
    render(<WorkHandoffBar todoPolicy={{ ...currentPolicy, disposition }}
      handoff={null} hasUnfinishedTodos running={false} {...actions()} t={t} />)
    expect(screen.getByText(label)).toBeTruthy()
  })

  it('leaves same-session goal continuation to the goal actions', () => {
    render(<WorkHandoffBar todoPolicy={currentPolicy} handoff={handoff({ goal: {
      id: brandString<GoalId>('goal-1'), revision: 2, objective: 'Finish the goal', roundsStarted: 1, maxGoalRounds: 5,
    } })} hasUnfinishedTodos running={false} {...actions()} t={t} />)
    expect(screen.queryByRole('button', { name: '继续工作' })).toBeNull()
    expect(screen.getByRole('button', { name: '在新会话中继续' })).toBeTruthy()
  })

  it('copies and downloads the selected Markdown and sends the exact checkpoint id to a new session', async () => {
    const value = handoff()
    const verbs = actions()
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    render(<WorkHandoffBar todoPolicy={currentPolicy} handoff={value} hasUnfinishedTodos running={false} {...verbs} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '复制交接记录' }))
    await waitFor(() => { expect(writeText).toHaveBeenCalledWith(value.markdown) })
    fireEvent.click(screen.getByRole('button', { name: '下载交接记录' }))
    await waitFor(() => { expect(verbs.onDownloadHandoff).toHaveBeenCalledWith(value) })
    await waitFor(() => { expect(screen.getByRole('button', { name: '在新会话中继续' })).toHaveProperty('disabled', false) })
    fireEvent.click(screen.getByRole('button', { name: '在新会话中继续' }))
    await waitFor(() => { expect(verbs.onContinueNewSession).toHaveBeenCalledWith(value.id) })
  })

  it('single-flights continuation and keeps a failed handoff visible', async () => {
    const verbs = actions()
    const result = Promise.withResolvers<GoalActionResult>()
    verbs.onContinueWork.mockImplementation(() => result.promise)
    render(<WorkHandoffBar todoPolicy={currentPolicy} handoff={handoff()}
      hasUnfinishedTodos running={false} {...verbs} t={t} />)
    const button = screen.getByRole<HTMLButtonElement>('button', { name: '继续工作' })
    act(() => { button.click(); button.click() })
    expect(verbs.onContinueWork).toHaveBeenCalledOnce()
    expect(button.disabled).toBe(true)
    await act(async () => { result.resolve({ ok: false, error: new RemoteError('gateway/internal', 'Changed work', {}) }) })
    expect(screen.getByRole('alert').textContent).toContain('Changed work')
    expect(screen.getByText('Finish verified work')).toBeTruthy()
  })

  it('retains copy and download for an unsaved checkpoint and disables new-session continuation', () => {
    render(<WorkHandoffBar todoPolicy={currentPolicy} handoff={handoff({ saved: false })}
      hasUnfinishedTodos running={false} {...actions()} t={t} />)
    expect(screen.getByRole('alert').textContent).toBe('交接记录尚未保存')
    expect(screen.getByRole('button', { name: '在新会话中继续' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: '下载交接记录' })).toHaveProperty('disabled', false)
  })

  it('hides the checkpoint while work is running and hides empty stopped sessions', () => {
    const shown = render(<WorkHandoffBar todoPolicy={currentPolicy} handoff={handoff()} hasUnfinishedTodos running {...actions()} t={t} />)
    expect(shown.container.firstChild).toBeNull()
    shown.rerender(<WorkHandoffBar todoPolicy={currentPolicy} handoff={null}
      hasUnfinishedTodos={false} running={false} {...actions()} t={t} />)
    expect(shown.container.firstChild).toBeNull()
  })
})
