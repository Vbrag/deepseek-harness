// @vitest-environment jsdom
/** Model status distinguishes admitted requests from queued future choices. */

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { OrchestrationRoutingState } from '@deepseek-ai/dsh-orchestration/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { OrchestrationRouting, type OrchestrationRoutingProps } from '../src/client/OrchestrationRouting.tsx'
import { de, en, es, fr, ja, pt, ru, zh } from '../src/client/locales.ts'

afterEach(cleanup)

const ROOT = SessionId('root')
const CHILD = SessionId('child')
const OLD = { provider: 'models', model: 'earlier' }
const CURRENT = { provider: 'models', model: 'current' }
const NEXT = { provider: 'models', model: 'selected-next' }
const REQUESTED = { provider: 'models', model: 'requested-next' }

function routing(patch: Partial<OrchestrationRoutingState> = {}): OrchestrationRoutingState {
  return { revision: 1, assessment: { requiredCapabilities: ['coding'], contextTokens: 100 }, request: null,
    route: CURRENT, previous: OLD, status: 'idle', reason: 'Implementation requires coding', checkpoint: '',
    maxTokens: null, automaticChanges: 0, tried: [], emptyLimits: 0, observedInputTokens: 0, ...patch }
}

function fixture(value = routing(), dictionary = en) {
  const sessions = createSnapshotStore<SessionListState>({ ids: [], byId: {}, phase: 'ready',
    projectionsBySession: {
      [ROOT]: { state: 'ready', error: null, values: { subagentCatalog: [
        { id: CHILD, createdAt: 0, mode: 'continuable', label: 'Implement change', name: 'coder' },
      ] } },
      [CHILD]: { state: 'ready', error: null, values: { orchestrationRouting: value,
        modelSelection: { lastUsed: CURRENT, next: NEXT } } },
    } })
  const props = { sessionId: ROOT, useSessions: bindSnapshotSelector(sessions), t: makeTranslate(dictionary) } as OrchestrationRoutingProps
  const view = render(<OrchestrationRouting {...props} />)
  const set = (values: SessionListState['projectionsBySession']) => {
    act(() => { sessions.set({ ...sessions.getSnapshot(), projectionsBySession: values }) })
  }
  return { ...view, sessions, set }
}

it('shows the last request model, previous model, and reason without treating a pending selection as current', () => {
  const view = fixture()
  expect(screen.getByRole('region', { name: en.routingTitle })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'coder' })).toBeTruthy()
  expect(view.container.querySelector('[data-orchestration-current]')?.textContent).toBe('models/current')
  expect(view.container.querySelector('[data-orchestration-selected]')).toBeNull()
  expect(screen.getByText('models/earlier')).toBeTruthy()
  expect(screen.getByText(/Implementation requires coding/u)).toBeTruthy()
  expect(screen.queryByText('models/selected-next')).toBeNull()
})

it('shows a blocked lead recovery alongside its child', () => {
  const view = fixture()
  const state = view.sessions.getSnapshot()
  view.set({ ...state.projectionsBySession, [ROOT]: { state: 'ready', error: null, values: {
    subagentCatalog: [{ id: CHILD, createdAt: 0, mode: 'continuable', label: 'Implement change', name: 'coder' }],
    orchestrationRouting: routing({ status: 'blocked', reason: 'BILLING_EXHAUSTED' }),
    modelSelection: { lastUsed: CURRENT, next: NEXT },
  } } })
  expect(screen.getByRole('heading', { name: en.routingLead })).toBeTruthy()
  expect(screen.getByText(/BILLING_EXHAUSTED/u)).toBeTruthy()
})

it.each([
  ['queued', en.routingQueued], ['changing', en.routingChanging], ['waiting', en.routingWaiting], ['blocked', en.routingBlocked],
] as const)('keeps %s distinct and displays selected and requested routes separately', (status, label) => {
  const view = fixture(routing({ status, route: NEXT, request: { revision: 2,
    assessment: { requiredCapabilities: ['coding'], contextTokens: 100 }, reason: 'Next phase', checkpoint: 'Work retained',
    preferredRoute: REQUESTED } }))
  expect(screen.getByText(label)).toBeTruthy()
  expect(view.container.querySelector('[data-status]')?.getAttribute('data-status')).toBe(status)
  expect(view.container.querySelector('[data-orchestration-current]')?.textContent).toBe('models/current')
  expect(view.container.querySelector('[data-orchestration-selected]')?.textContent).toBe('models/selected-next')
  expect(view.container.querySelector('[data-orchestration-requested]')?.textContent).toBe('models/requested-next')
})

it('moves a selected route to last-used only after the published request projection changes', () => {
  const view = fixture(routing({ route: NEXT, status: 'changing' }))
  const state = view.sessions.getSnapshot()
  view.set({ ...state.projectionsBySession, [CHILD]: { state: 'ready', error: null, values: {
    orchestrationRouting: routing({ route: NEXT, previous: CURRENT }), modelSelection: { lastUsed: NEXT, next: NEXT },
  } } })
  expect(view.container.querySelector('[data-orchestration-current]')?.textContent).toBe('models/selected-next')
  expect(view.container.querySelector('[data-orchestration-selected]')).toBeNull()
  expect(screen.getByText('models/current')).toBeTruthy()
})

it('does not invent a current model before the first request or duplicate a selected preference', () => {
  const view = fixture(routing())
  const state = view.sessions.getSnapshot()
  view.set({ ...state.projectionsBySession, [CHILD]: { state: 'ready', error: null, values: {
    orchestrationRouting: routing({ route: NEXT, previous: null, reason: '', status: 'queued', request: { revision: 2,
      assessment: { requiredCapabilities: [], contextTokens: 0 }, reason: 'phase', checkpoint: 'saved', preferredRoute: NEXT } }),
  } } })
  expect(view.container.querySelector('[data-orchestration-current]')?.textContent).toBe(en.routingNoRequest)
  expect(view.container.querySelector('[data-orchestration-requested]')).toBeNull()
  expect(screen.queryByText(en.routingPrevious)).toBeNull()
  expect(screen.queryByText(`${en.routingReason}:`)).toBeNull()
})

it('uses only observed local catalog children and withdraws stale or unavailable rows', () => {
  const view = fixture()
  const state = view.sessions.getSnapshot()
  view.set({ ...state.projectionsBySession, [ROOT]: { state: 'ready', error: null, values: { subagentCatalog: [
    { id: CHILD, createdAt: 0, mode: 'external', name: 'remote', label: 'external' },
  ] } } })
  expect(view.container.textContent).toBe('')
  view.set({ ...state.projectionsBySession, [CHILD]: { state: 'loading', error: null, values: {} } })
  expect(view.container.textContent).toBe('')
  view.set({ ...state.projectionsBySession, [CHILD]: { state: 'ready', error: null, values: {} } })
  expect(view.container.textContent).toBe('')
  view.set({ ...state.projectionsBySession, [CHILD]: { state: 'ready', error: null,
    values: { orchestrationRouting: routing({ assessment: null }) } } })
  expect(view.container.textContent).toBe('')
  view.set({})
  expect(view.container.textContent).toBe('')
})

it.each([en, zh, ja, es, fr, de, ru, pt])('localizes waiting and blocked model progress', (dictionary) => {
  const view = fixture(routing({ status: 'waiting' }), dictionary)
  expect(screen.getByText(dictionary.routingWaiting)).toBeTruthy()
  const state = view.sessions.getSnapshot()
  view.set({ ...state.projectionsBySession, [CHILD]: { state: 'ready', error: null,
    values: { orchestrationRouting: routing({ status: 'blocked' }) } } })
  expect(screen.getByText(dictionary.routingBlocked)).toBeTruthy()
})
