/** Keep the dedicated documentation recording's actual visible tools independently owned. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'

export const name = 'project-context-tools-fixture'
export const inject = ['agents', 'tools']

/**
 * Retain real documentation admission and execution while narrowing the recorded catalog.
 * @param ctx - SDK Agent and tool owners.
 */
export function apply(ctx: Context): void {
  ctx.on('agent/created', ({ agent }) => {
    agent.ctx.tools.restrict({ allow: ['project_context_read', 'project_context_update'] })
  })
}
