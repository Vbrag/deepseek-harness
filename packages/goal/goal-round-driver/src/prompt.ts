/** Model-visible continuation prompt for one same-session goal round. */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { GoalView } from '@deepseek-ai/dsh-goal'

/**
 * Render the complete goal-round instruction retained in session history.
 * @param goal - exact active goal revision being admitted.
 * @param round - next positive round number.
 * @returns a fresh one-block prompt for `Agent.followup()`.
 */
export function renderGoalRoundPrompt(goal: GoalView, round: number): ContentBlock[] {
  return [{
    type: 'text',
    text: '<goal_round>\n'
      + `Objective: ${JSON.stringify(goal.objective)}\n`
      + `Round: ${round}/${goal.maxGoalRounds}\n\n`
      + 'Continue working toward the objective in this same session. Treat the current workspace, '
      + 'tool results, and durable session state as authoritative; inspect them instead of assuming '
      + 'earlier narration is still current. Make concrete progress and verify the result. Before '
      + 'claiming completion, gather evidence that the whole objective is achieved, read the current '
      + 'goal, and mark it complete. If work remains, leave the goal active for the next round. Follow '
      + 'the configured goal-tool policy before reporting a blocker.\n'
      + (round === goal.maxGoalRounds
        ? 'This is the last permitted automatic round. If work remains, call work_checkpoint before '
          + 'ending this round to preserve verified results, unfinished work, evidence, and concrete '
          + 'next actions. Tell the user that automatic rounds are exhausted and how to continue. '
          + 'Do not report complete or blocked merely because this budget is exhausted.\n'
        : '')
      + '</goal_round>',
  }]
}
