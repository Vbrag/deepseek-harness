/** Policy registration and private reads for the settings owner. */
import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SubagentModelRoute } from '@deepseek-ai/dsh-subagent'
export { subagentModelSelectionProjectionDefinition } from '@deepseek-ai/dsh-subagent/model-selection-policy'

/**
 * Read the settings owner's registered authorization state.
 * @param handle - ready policy reader.
 * @param session - Session whose first authorization is read.
 * @returns detached routes or undefined for parent-only selection.
 */
export function subagentModelSelectionPolicy(
  handle: Pick<ProjectionHandle<SubagentModelRoute[] | null>, 'stateOf'>,
  session: Session,
): SubagentModelRoute[] | undefined {
  return handle.stateOf(session)?.map(route => ({ ...route })) ?? undefined
}
