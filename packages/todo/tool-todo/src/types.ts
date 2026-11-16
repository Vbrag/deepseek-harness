/**
 * Pure types of the todo domain: the ONE home of the `todos` projection-key
 * declaration plus its payload types, free of this package's host-side value
 * imports (dsh-tools, zod). Two namespace projections serve it — `./types`
 * for host consumers, `./client/types` (the browser half-entry's re-export)
 * for client aggregates — with zero content duplication.
 *
 * @module @deepseek-ai/dsh-tool-todo/types
 */

import type { SessionProjectionSummaryExcluded } from '@deepseek-ai/dsh-session-projection/types'

/**
 * One entry in an agent's todo list — the unit of the `todo/write`
 * whole-list snapshot declared by this package.
 *
 * Deliberately minimal: a human-readable `content` line and a three-state
 * `status`. No id, priority, or `activeForm` — the list is replaced wholesale
 * on every write (last-write-wins), so entries need no stable identity. The
 * three statuses describe the complete portable lifecycle needed by model and
 * UI consumers.
 */
export interface TodoItem {
  /** What this task is — a short imperative line shown in the UI. */
  content: string
  /** Lifecycle state. `in_progress` marks a task being worked now; parallel work may mark several. */
  status: 'pending' | 'in_progress' | 'completed'
}

/** Whether a newly authored list describes execution or a proposed plan. */
export type TodoListPurpose = 'current-task' | 'proposal'

/** Durable execution state; historical `limit` records remain automatically recoverable. */
export type TodoDisposition = 'active' | 'paused' | 'waiting' | 'limit'

/** Durable continuation policy; legacy lists require explicit human confirmation. */
export interface TodoPolicyView {
  readonly purpose: TodoListPurpose | 'legacy'
  readonly disposition: TodoDisposition
  readonly completedHighWater: number
  readonly repairAttempts: number
  readonly reason?: string
}

/** Attribution for logged current-task recovery and same-turn repair input. */
export interface TodoReconcileMessageSource {
  readonly kind: 'todo-reconcile'
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'todo-reconcile': TodoReconcileMessageSource
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Whole-list snapshot; latest write wins on replay, and the list persists
     * across turns and resumed sessions until an explicit empty write clears
     * it. Log-only UI state; never derived history.
     */
    'todo/write': { todos: TodoItem[] }
    /** Whole-value continuation policy, separate from the portable list. */
    'todo/policy': TodoPolicyView
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /**
     * The agent's current whole todo list (the latest `todo/write` snapshot),
     * or `null` before the first write. Whole-value rule: every `todo/write`
     * carries the complete replacement list, so the fold is last-wins. The
     * list persists across turns and resumed sessions until an explicit empty
     * write (`todo_write(todos: [])`) clears it. Excluded from Session summary
     * payloads, with `null` kept outside the exclusion mark so the
     * pre-first-write value stays expressible.
     */
    todos: SessionProjectionSummaryExcluded<TodoItem[]> | null
    /** Current list classification and repair accounting, absent for an empty list. */
    todoPolicy: TodoPolicyView | null
  }
}
