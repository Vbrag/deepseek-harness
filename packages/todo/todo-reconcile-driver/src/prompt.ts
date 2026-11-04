/** Model-visible reconciliation prompt for a resumed session with a persisted todo list. */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { GoalView } from '@deepseek-ai/dsh-goal'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo'

/** Human-readable status label for the persisted todo list summary. */
function statusLabel(status: TodoItem['status']): string {
  switch (status) {
    case 'completed': return 'completed'
    case 'in_progress': return 'in progress'
    case 'pending': return 'pending'
  }
}

/**
 * Render the complete resume-reconciliation instruction retained in session
 * history: the persisted to-do list with statuses, the current goal, and the
 * done-versus-remaining summary, ending with the explicit reconcile action.
 * @param todos - the persisted whole to-do list (non-empty) at resume.
 * @param goal - the current durable goal view at resume.
 * @returns a fresh one-block prompt for `Agent.followup()`.
 */
export function renderTodoReconcilePrompt(todos: TodoItem[], goal: GoalView): ContentBlock[] {
  const listed = todos.map(todo => `- ${JSON.stringify(todo.content)} [${statusLabel(todo.status)}]`).join('\n')
  const done = todos.filter(todo => todo.status === 'completed').length
  const remaining = todos.length - done
  return [{
    type: 'text',
    text: '<todo_reconcile>\n'
      + `Objective: ${JSON.stringify(goal.objective)}\n`
      + `Phase: ${goal.phase} (rounds ${goal.roundsStarted}/${goal.maxGoalRounds})\n\n`
      + 'Persisted task list:\n'
      + `${listed}\n\n`
      + `Done: ${done}, remaining: ${remaining}.\n\n`
      + 'This session was resumed with a persisted plan. Inspect the current workspace, tool results, '
      + 'and durable session state to determine what actually finished, then reconcile the list by '
      + 'calling `todo_write` with the complete updated list: mark finished items `completed`, keep or '
      + 're-activate the next step. Do not clear the list unless the work is truly abandoned.\n'
      + '</todo_reconcile>',
  }]
}
