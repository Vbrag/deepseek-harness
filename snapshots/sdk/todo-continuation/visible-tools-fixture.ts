/** Keep this SDK scenario's real model-facing tools bounded and its header independently owned. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
import { AttachmentStore } from '@deepseek-ai/dsh-attachment'

export const name = 'todo-continuation-tools-fixture'
export const inject = ['agents', 'tools', 'attachments']

/**
 * Restrict visibility without replacing execution or continuation policy.
 * @param ctx - actual SDK agent lifecycle and tool services.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    const provider = ctx.attachments
    const saveFile = provider.saveFile
    provider.saveFile = AttachmentStore.prototype.saveFile
    return () => { provider.saveFile = saveFile }
  }, 'fixture: deterministic unsupported file export')
  ctx.on('agent/created', ({ agent }) => {
    agent.ctx.tools.restrict({ allow: ['todo_write', 'write', 'create_goal', 'work_checkpoint'] })
  })
}
