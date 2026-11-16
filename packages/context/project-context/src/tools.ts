/** Ordinary admitted model tools for project-document observations and guarded updates. */

import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { ToolContextUnavailableError, defineTool } from '@deepseek-ai/dsh-tools'
import type { ProjectContextDocument, ProjectContextUpdateRequest, ProjectContextUpdateResult, ProjectContextView } from './types.ts'

/** Service capabilities consumed by the model tools without exposing filesystem privileges. */
export interface ProjectContextToolOwner {
  viewOf(session: Session): ProjectContextView | null
  activeOf(agent: Agent): boolean
  readDocuments(agent: Agent, paths: readonly string[], signal: AbortSignal): Promise<ProjectContextDocument[]>
  executeUpdate(agent: Agent, request: ProjectContextUpdateRequest, signal: AbortSignal): Promise<ProjectContextUpdateResult>
}

/** Register phase-scoped model tools through their selected registry.
 * @param ctx - Plugin effect owner.
 * @param tools - Agent's selected tool registry.
 * @param owner - Project-document operation owner.
 */
export function registerProjectContextTools(ctx: Context, tools: Context['tools'], owner: ProjectContextToolOwner): void {
  ctx.effect(() => tools.register(defineTool({
    name: 'project_context_read',
    description: 'Read complete project Markdown documents and retain their exact versions before updating or consolidating them. '
      + 'Use relative paths. This does not authorize replacing instruction files, README entrypoints, scoped, generated, archived, or vendor documents.',
    parameters: { paths: { type: 'array', required: true, items: { type: 'string' } } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        documents: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
          path: { type: 'string', required: true }, version: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
          content: { type: 'string', required: true },
        } } },
        projectContextPaths: { type: 'array', required: true, items: { type: 'string' } },
      } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value.documents) }],
      presentationMeta: (_args, value) => ({ projectContextPaths: value.projectContextPaths }),
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      if (exec.agent === undefined) throw new ToolContextUnavailableError('Project context requires an Agent Session.')
      const documents = await owner.readDocuments(exec.agent, args.paths, exec.signal)
      const view = owner.viewOf(exec.agent.session)
      return { documents: documents.map(document => ({ ...document })),
        projectContextPaths: documents.map(document => resolve(view?.root ?? '', document.path)) }
    },
  }), { when: ({ agent }) => owner.activeOf(agent) }), 'project-context: read tool')
  ctx.effect(() => tools.register(defineTool({
    name: 'project_context_update',
    description: 'Finish the project-document assessment: updated publishes current project context, unchanged confirms it is current, '
      + 'or deferred records a concrete blocker. Preserve unique facts and rationale before consolidating observed ordinary Markdown guides. '
      + 'Never treat unfinished task work or an unverified test as complete. Context replaces only the managed context section; other authored text is preserved.',
    parameters: {
      outcome: { type: 'string', required: true, enum: ['updated', 'unchanged', 'deferred'] },
      summary: { type: 'string', required: true, description: 'Specific changes, why existing context is current, or the concrete blocker.' },
      context: { type: 'string', description: 'Complete current project facts for the managed canonical section; required for updated.' },
      guideUpdates: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
        path: { type: 'string', required: true }, oldText: { type: 'string', required: true }, newText: { type: 'string', required: true },
      } } },
      forwardingStubs: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
        path: { type: 'string', required: true }, oldText: { type: 'string', required: true },
      } } },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        outcome: { type: 'string', required: true, enum: ['updated', 'unchanged', 'deferred'] },
        summary: { type: 'string', required: true }, contextPath: { type: 'string', required: true },
        changedPaths: { type: 'array', required: true, items: { type: 'string' } },
      } },
      render: (_args, value) => [{ type: 'text', text: `Project context ${value.outcome}: ${value.summary}` }],
      presentationMeta: (_args, value) => ({ projectContextPaths: value.changedPaths }),
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      if (exec.agent === undefined) throw new ToolContextUnavailableError('Project context requires an Agent Session.')
      const result = await owner.executeUpdate(exec.agent, args, exec.signal)
      exec.concludeTurn()
      return { ...result }
    },
  }), { when: ({ agent }) => owner.activeOf(agent) }), 'project-context: update tool')
}
