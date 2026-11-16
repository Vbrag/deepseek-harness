/** Pure Markdown rendering of bounded checkpoint facts and explicit capture inputs. */

import type {
  WorkCaptureRequest, WorkHandoffId, WorkHandoffState, WorkWorkspaceFacts,
} from './types.ts'

/** Quote authored values without letting Markdown headings or HTML replace the surrounding sections. */
function inline(value: string): string {
  return value.replace(/[\\`*_[\]<>#]/g, '\\$&').replace(/\r?\n/g, ' ')
}

/** Preserve exact previews even when their content contains Markdown fences. */
function fenced(value: string): string {
  let longest = 2
  for (const match of value.matchAll(/`+/g)) longest = Math.max(longest, match[0].length)
  const fence = '`'.repeat(longest + 1)
  return `${fence}\n${value}\n${fence}`
}

/** Render an explicit empty state instead of implying that an observation was made. */
function bullets(values: readonly string[], empty: string): string {
  return values.length === 0 ? empty : values.map(value => `- ${inline(value)}`).join('\n')
}

/**
 * Render a complete portable handoff without I/O, model calls, or Session history reads.
 * @param facts - bounded recovered facts from the source Session.
 * @param request - service-resolved stop reason, exact goal, and current todo snapshots.
 * @param id - identity allocated for this capture.
 * @param workspace - caller-observed cwd and Git facts; omitted fields are reported as unavailable.
 * @returns Markdown separating model-authored claims from recorded tool evidence and pending work.
 */
export function renderWorkHandoffMarkdown(
  facts: WorkHandoffState,
  request: WorkCaptureRequest,
  id: WorkHandoffId,
  workspace: WorkWorkspaceFacts = {},
): string {
  const checkpoint = facts.checkpoint
  const goal = request.goal
  const todos = request.todos ?? []
  const objective = goal?.objective || facts.humanObjective || 'No objective was recorded.'
  const sections = [
    '# Work handoff',
    `Handoff: ${inline(id)}\n\nSource Session: ${inline(facts.sourceSessionId)}\n\nTurn: ${facts.turn}\n\nStop reason: ${request.reason}`,
    '## Objective\n\n' + inline(objective)
      + (facts.objectiveSeq === undefined ? '' : `\n\nFull source objective: event ${facts.objectiveSeq}.`),
    '## Recorded stop explanation\n\n' + (request.stopDetail === undefined
      ? 'No detailed stop explanation was recorded.' : inline(request.stopDetail)),
    '## Progress summary\n\n' + (checkpoint === null ? 'No progress checkpoint was recorded.' : inline(checkpoint.summary)),
    '## Reported completed work\n\n' + bullets(checkpoint?.completed ?? [], 'No completed work was reported.'),
    '## Todo progress\n\n' + (todos.length === 0 ? 'No todo snapshot was recorded.' : todos.map(todo =>
      `- [${todo.status === 'completed' ? 'x' : ' '}] ${inline(todo.content)} (${todo.status})`).join('\n')),
  ]
  const remaining = checkpoint?.remaining ?? []
  sections.push('## Remaining work and next actions\n\n' + (remaining.length === 0
    ? bullets(todos.filter(todo => todo.status !== 'completed').map(todo => todo.content), 'No next actions were recorded.')
    : remaining.map((item, index) => `### ${index + 1}. ${inline(item.task)}\n\n`
      + bullets(item.nextActions, 'No next actions were specified.')
      + '\n\nReferences:\n\n' + bullets(item.references, 'No references were supplied.')).join('\n\n')))
  const validation = checkpoint?.validation ?? []
  sections.push('## Checkpoint validation reports\n\n' + (validation.length === 0
    ? 'No validation commands were reported.'
    : validation.map(item => `### ${inline(item.result)}\n\n${fenced(item.command)}\n\n`
      + bullets(item.evidence, 'No supporting evidence was supplied.')).join('\n\n')))
  sections.push('## Recorded tool evidence\n\n' + (facts.evidence.length === 0
    ? 'No tool observations were retained.'
    : facts.evidence.map(item => `### ${inline(item.name)} — source event ${item.seq}\n\n`
      + `Call: ${inline(item.callId)}\n\nArguments preview:\n\n${fenced(item.arguments)}\n\n`
      + (item.result === null ? 'No committed result was retained.'
        : `Result preview (${item.isError === true ? 'tool error' : 'returned'}):\n\n${fenced(item.result)}`)).join('\n\n')))
  sections.push('## Blockers\n\n' + bullets(checkpoint?.blockers ?? [], 'No blockers were reported.'))
  sections.push('## Pending jobs\n\n' + bullets(facts.pendingJobs, 'No pending jobs were retained.'))
  sections.push('## Pending subagents\n\n' + bullets(facts.pendingSubagents, 'No pending subagents were retained.'))
  sections.push('## Goal allowance\n\n' + (goal === undefined ? 'No goal snapshot was captured.'
    : `Goal: ${inline(goal.id)}\n\nRevision: ${goal.revision}\n\nRounds started: ${goal.roundsStarted}`
    + `\n\nMaximum rounds: ${goal.maxGoalRounds}\n\nRemaining allowance: ${Math.max(0, goal.maxGoalRounds - goal.roundsStarted)}`))
  const repairs = request.todoRepairs
  sections.push('## Todo recovery\n\nAutomatic continuation has no round limit.\n\n'
    + (repairs === undefined ? 'No recovery counter was captured.'
      : `Consecutive repairs: ${repairs.attempts}\n\nStronger-guidance threshold: ${repairs.limit}`))
  sections.push('## Workspace\n\n'
    + `Working directory: ${inline(workspace.cwd ?? 'Unavailable')}\n\n`
    + `Branch: ${inline(workspace.branch ?? 'Unavailable')}\n\nCommit: ${inline(workspace.commit ?? 'Unavailable')}\n\n`
    + 'Changed paths:\n\n' + (workspace.changes === undefined
    ? 'Changed-file observations are unavailable.' : bullets(workspace.changes, 'No changed paths were observed.'))
    + (workspace.error === undefined ? '' : '\n\nObservation error: ' + inline(workspace.error)))
  sections.push('## Continuation policies\n\n'
    + bullets(facts.policySeeds.map(seed => seed.type), 'No explicit policy overrides were retained.')
    + (facts.policyFailure === null ? '' : '\n\nPolicy carryover unavailable: ' + inline(facts.policyFailure)))
  return sections.join('\n\n') + '\n'
}
