/** Model-facing requests to reassign an existing local child without granting new delegation authority. */

import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool, ToolArgsError, ToolContextUnavailableError } from '@deepseek-ai/dsh-tools'
import { TASK_ASSESSMENT_PARAMETER, validateTaskAssessment } from './task-assessment.ts'

/** Register running-model control with the scope's existing model-discovery owner.
 * @param ctx - Effect owner of the tool and its selected subagent service.
 */
export function registerReassignSubagent(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'reassign_subagent',
    description: 'Request a different model for an existing local subagent when its task needs change. '
      + 'Omit target to request your own model change; an ancestor may name its descendant. '
      + 'Supply a concrete reason, current checkpoint, and complete task requirements. '
      + 'The child keeps its Session, workspace, and task. Routing cannot expand its recorded model permissions. '
      + 'The active routing policy owns the safe application boundary; this does not create another child or increase delegation depth.',
    parameters: {
      target: { type: 'string', description: 'Child name/path or Session id. Omit for your own local subagent Session.' },
      task_assessment: { ...TASK_ASSESSMENT_PARAMETER, required: true },
      reason: { type: 'string', required: true, description: 'Why the current model should change for the next task phase.' },
      checkpoint: { type: 'string', required: true, description: 'Current work, verified facts, pending work, and next actions retained across the model change.' },
      preferred_route: { type: 'object', additionalProperties: false, properties: {
        provider: { type: 'string', required: true }, model: { type: 'string', required: true },
      }, description: 'Optional exact route preference, still subject to task requirements and permissions.' },
      max_tokens: { type: 'integer', description: 'Optional positive safe-integer response limit for the requested model phase.' },
      interrupt_current_request: { type: 'boolean', description: 'Default false. Request interruption of the current model request only when supported by the routing policy.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        status: { type: 'string', required: true, enum: ['queued', 'applied'] },
        target: { type: 'string', required: true },
        route: { type: 'object', additionalProperties: false, properties: {
          provider: { type: 'string', required: true }, model: { type: 'string', required: true },
        } },
      } },
      render: (_args, value) => [{ type: 'text', text: `Model change ${value.status} for ${value.target}.`
        + (value.route === undefined ? '' : ` Route: ${value.route.provider}/${value.route.model}.`) }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const caller = exec.agent
      if (caller === undefined) throw new ToolContextUnavailableError('reassign_subagent requires a calling Agent')
      validateTaskAssessment(args.task_assessment)
      if (args.reason.trim() === '' || args.checkpoint.trim() === '') {
        throw new ToolArgsError(['reason and checkpoint must be non-empty strings'])
      }
      if (args.max_tokens !== undefined && (!Number.isSafeInteger(args.max_tokens) || args.max_tokens < 1)) {
        throw new ToolArgsError(['max_tokens must be a positive safe integer'])
      }
      if (args.preferred_route !== undefined && (args.preferred_route.provider.trim() === '' || args.preferred_route.model.trim() === '')) {
        throw new ToolArgsError(['preferred_route requires non-empty provider and model ids'])
      }
      if (args.target !== undefined && args.target.trim() === '') throw new ToolArgsError(['target must be non-empty when supplied'])
      const target = args.target === undefined ? caller.id : ctx.get('agents')?.get(SessionId(args.target))?.id
        ?? await ctx.subagents.resolveName(caller, args.target, exec.signal)
      const result = await ctx.subagents.requestModelChange({ caller, target, taskAssessment: args.task_assessment,
        reason: args.reason, checkpoint: args.checkpoint, interruptCurrentRequest: args.interrupt_current_request ?? false,
        ...args.preferred_route === undefined ? {} : { preferredRoute: args.preferred_route },
        ...args.max_tokens === undefined ? {} : { maxTokens: args.max_tokens }, signal: exec.signal })
      return { ...result }
    },
  }))
}
