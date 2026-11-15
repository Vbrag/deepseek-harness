/** Exercise real mode selection during SDK delegation; SDK text commands intentionally support only built-ins. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-orchestration'

export const name = 'orchestration-session-mode-fixture'
export const inject = ['orchestrations', 'agents', 'tools']

/** Apply one enabled turn followed by ordinary delegation through the same Session.
 * @param ctx - Real orchestration and Agent services of the SDK profile.
 */
export function apply(ctx: Context): void {
  ctx.on('agent/created', ({ agent }) => {
    agent.ctx.tools.restrict({ allow: ['subagent', 'list_agents', 'send_message', 'wait_agent'] })
    if (agent.session.header.parentSession === undefined) ctx.orchestrations.select(agent, true)
  })
  ctx.on('tools/execute', async (exec, next) => {
    const result = await next()
    if (exec.name === 'subagent' && exec.agent !== undefined
      && exec.agent.session.header.parentSession === undefined && ctx.orchestrations.modeOf(exec.agent)) {
      ctx.orchestrations.select(exec.agent, false)
    }
    return result
  })
}
