/** Exercise normal workflow creation and self reassignment without exposing unrelated tools. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-orchestration'
import type {} from '@deepseek-ai/dsh-tools'

export const name = 'orchestration-reassignment-fixture'
export const inject = ['orchestrations', 'agents', 'tools']

/**
 * Keep the lead on workflow execution and the existing child on its reassignment tool.
 * @param ctx - Real SDK-profile services; all requests use the recorded replay adapter.
 */
export function apply(ctx: Context): void {
  ctx.on('agent/created', ({ agent }) => {
    const root = agent.session.header.origin !== 'subagent'
    agent.ctx.tools.restrict({ allow: root ? ['workflow'] : ['reassign_subagent'] })
    if (root) {
      agent.options.maxTokens = 4096
      ctx.orchestrations.select(agent, true)
    }
  })
}
