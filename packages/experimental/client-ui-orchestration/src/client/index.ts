/** Browser entry registering the Orchestration settings page: mounts the Host's Remote and the settings section over it. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import orchestrationsRemote from '@deepseek-ai/dsh-orchestration/remote'
import { mountOrchestration } from './mount.ts'

export { inject } from './mount.ts'
export type { OrchestrationKey } from './locales.ts'

/**
 * Mount the Host's `orchestrations` Remote contribution and register the
 * Orchestration locale dictionaries and settings section on the Client Context.
 * @param ctx - Client Context with the declared `inject` services available.
 * @returns the disposer that withdraws the section and the Remote mount.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  return await mountOrchestration(ctx, orchestrationsRemote)
}
