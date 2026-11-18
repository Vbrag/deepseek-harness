/** Synchronize workflow children while retaining real routing and tool execution. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-orchestration'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-workflow'

export const name = 'orchestration-workflow-fixture'
export const inject = ['orchestrations', 'agents', 'tools']

/**
 * Admit all three workflow children before settling them in label order.
 * @param ctx - Shipped SDK Agent, tool, and orchestration services.
 */
export function apply(ctx: Context): void {
  const created = Promise.withResolvers<void>()
  const ready = Promise.withResolvers<void>()
  const firstFinished = Promise.withResolvers<void>()
  const secondFinished = Promise.withResolvers<void>()
  const firstStarted = Promise.withResolvers<void>()
  const secondStarted = Promise.withResolvers<void>()
  const lifetime = new AbortController()
  let creating = 0
  let waiting = 0
  const wait = async (promise: Promise<void>, signal: AbortSignal): Promise<void> => {
    const operationSignal = AbortSignal.any([signal, lifetime.signal])
    const cancelled = Promise.withResolvers<never>()
    const abort = (): void => { cancelled.reject(operationSignal.reason) }
    operationSignal.throwIfAborted()
    operationSignal.addEventListener('abort', abort, { once: true })
    try { await Promise.race([promise, cancelled.promise]) }
    finally { operationSignal.removeEventListener('abort', abort) }
  }
  ctx.on('agent/created', async ({ agent, signal }) => {
    if (agent.session.header.origin !== 'subagent') {
      agent.ctx.tools.restrict({ allow: ['workflow', 'ralph'] })
      ctx.orchestrations.select(agent, true)
    } else {
      const ordinary = ctx.tools.schemas(agent).map(tool => tool.name).filter(tool => tool !== 'structured_output')
      agent.ctx.tools.restrict({ deny: ordinary })
      creating += 1
      if (creating === 3) created.resolve()
      if (creating <= 3) {
        const descriptor = agent.session.snapshotEvents().find(event => event.type === 'subagent/descriptor')
        await wait(created.promise, signal ?? lifetime.signal)
        if (descriptor?.data.label === 'assessed-coding-fanout child 2') await wait(firstStarted.promise, signal ?? lifetime.signal)
        if (descriptor?.data.label === 'assessed-coding-fanout child 3') await wait(secondStarted.promise, signal ?? lifetime.signal)
      }
    }
  })
  ctx.on('workflow/agent-start', (_run, child) => {
    if (child.label === 'WORKFLOW_CODING_ONE') firstStarted.resolve()
    if (child.label === 'WORKFLOW_CODING_TWO') secondStarted.resolve()
  })
  ctx.on('workflow/agent-end', (_run, child) => {
    if (child.label === 'WORKFLOW_CODING_ONE') firstFinished.resolve()
    if (child.label === 'WORKFLOW_CODING_TWO') secondFinished.resolve()
  })
  ctx.on('agent/pre-step', async ({ agent, step, signal, messages }, next) => {
    const task = messages.flatMap(message => message.content)
      .find(block => block.type === 'text'
        && ['WORKFLOW_CODING_ONE', 'WORKFLOW_CODING_TWO', 'WORKFLOW_CODING_THREE'].includes(block.text))
    if (agent.session.header.origin === 'subagent' && step === 1 && task?.type === 'text') {
      waiting += 1
      if (waiting === 3) ready.resolve()
      await wait(ready.promise, signal)
      if (task.text === 'WORKFLOW_CODING_TWO') await wait(firstFinished.promise, signal)
      if (task.text === 'WORKFLOW_CODING_THREE') await wait(secondFinished.promise, signal)
    }
    return await next()
  })
  ctx.effect(() => () => { lifetime.abort() }, 'release workflow recording barrier')
}
