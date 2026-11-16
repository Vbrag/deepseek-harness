/** Root-turn project-document maintenance through ordinary admitted model tools. */

import { resolve } from 'node:path'
import { FiberState, Service, symbols, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { agentCarrier, type Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { HarnessError } from '@deepseek-ai/dsh-error'
import { ToolArgsError, ToolContextUnavailableError } from '@deepseek-ai/dsh-tools'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsTargetKey } from '@deepseek-ai/dsh-fs'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-working-directory'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { findProjectRoot, resolveProjectContextFileName } from '@deepseek-ai/dsh-agent-instructions/discovery'
import { createProjectContextProjection } from './projection.ts'
import { installProjectContextDriver } from './driver.ts'
import { registerProjectContextTools } from './tools.ts'
import {
  assertEditableGuide, canonicalContextText, observeProjectDocument, projectContextForwardingText,
  projectContextPointerText, projectDocumentPath, publishProjectDocument, requestedProjectDocuments,
  verifyCanonicalDocument,
} from './writer.ts'
import type { ObservedProjectDocument, ProjectDocumentScope } from './writer.ts'
import type {
  ProjectContextDocument, ProjectContextState, ProjectContextUpdateRequest, ProjectContextUpdateResult, ProjectContextView,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Current root-turn project documentation and guarded Markdown maintenance. */
    projectContext: ProjectContextService
  }
}

/** Deployment limits for project-document maintenance and its logged original files. */
export interface Config {
  /** Root Markdown filename shared with the active instruction loader; defaults to PROJECT_CONTEXT.md. */
  readonly projectContextFileName?: string
  /** Complete model update JSON and each persisted status label, in characters. */
  readonly maxTextChars: number
  /** Maximum UTF-8 bytes in one complete observed or written project file. */
  readonly maxSourceBytes: number
  /** Maximum distinct documents observed in one maintenance phase, including context and primary instructions. */
  readonly maxDocuments: number
}

interface MaintenancePhase {
  readonly turn: number
  readonly cwd: string
  readonly scope: ProjectDocumentScope
  readonly primary?: string
  readonly documents: Map<string, ObservedProjectDocument>
  readonly loader: string
}

function originalService(service: object): object {
  let identity = service
  while (true) {
    const original: unknown = Reflect.get(identity, symbols.original)
    if (typeof original !== 'object' || original === null || original === identity) return identity
    identity = original
  }
}

/** Owns discovery, logged original documents, and one write queue per project filesystem. */
export class ProjectContextService extends Service {
  static inject = ['agents', 'sessions', 'sessionProjections', 'tools']
  static Config: z<Config> = z.object({
    projectContextFileName: z.string().default('PROJECT_CONTEXT.md'),
    maxTextChars: z.number().min(1).step(1).default(65536),
    maxSourceBytes: z.number().min(1).step(1).default(1048576),
    maxDocuments: z.number().min(2).step(1).default(16),
  })

  private projection!: ProjectionHandle<ProjectContextState>
  private readonly phases = new WeakMap<Agent, MaintenancePhase>()
  private readonly preparations = new Map<Agent, Promise<boolean>>()
  private readonly toolsInstalled = new WeakSet<object>()
  private readonly queues = new WeakMap<object, Map<FsTargetKey, Promise<void>>>()
  private readonly operations = new Set<Promise<unknown>>()
  private readonly lifetime = new AbortController()
  private readonly filename: string

  /** @param ctx - Agent, persistence, projection, and ordinary tool services.
   * @param config - Validated filename and complete input/file bounds.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'projectContext')
    this.filename = resolveProjectContextFileName(config.projectContextFileName)
  }

  protected async [Service.init](): Promise<void> {
    this.projection = await this.ctx.sessionProjections.register(createProjectContextProjection({
      maxTextChars: this.config.maxTextChars, maxSourceBytes: this.config.maxSourceBytes,
    }))
    this.ctx.fiber.assertActive()
    this.ctx.effect(() => async () => {
      this.lifetime.abort(new DOMException('Project context unloaded', 'AbortError'))
      await Promise.allSettled([...this.operations])
    }, 'project-context: drain filesystem operations')
    this.installTools(this.ctx.tools)
    this.ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
      const view = this.viewOf(agent.session)
      if (view !== null && view.status !== 'pending' && messages.some(message => message.source.kind === 'user')) {
        agent.session.append('project-context/status', { sourceTurn: view.sourceTurn,
          knowledgeWatermark: view.knowledgeWatermark, status: 'pending' })
        this.phases.delete(agent)
      }
      return await next()
    })
    installProjectContextDriver(this.ctx, this)
  }

  /** Read detached projected maintenance status without filesystem I/O.
   * @param session - Prepared Session whose latest root turn is displayed.
   * @returns Latest assessment or null before the first root turn.
   */
  viewOf(session: Session): ProjectContextView | null {
    const view = this.projection.stateOf(session).view
    return view === null ? null : { ...view }
  }

  /** Whether this live lead Agent is in its current turn's document phase.
   * @param agent - Model-tool owner being admitted.
   * @returns True only for the active root turn and retained filesystem preparation.
   */
  activeOf(agent: Agent): boolean {
    const phase = this.phases.get(agent)
    const view = this.viewOf(agent.session)
    return !this.lifetime.signal.aborted && this.ctx.agents.get(agent.id) === agent
      && (agent.session.header.delegationDepth ?? 0) === 0 && agent.session.header.origin !== 'subagent'
      && phase !== undefined && view?.sourceTurn === phase.turn && view.status === 'updating'
  }

  /** Prepare or remind the current root turn's ordinary project-document step.
   * @param agent - Lead Agent already at its normal stopping boundary.
   * @param turn - Current source turn; newer work invalidates preparation.
   * @param signal - Current turn and caller cancellation.
   * @returns Whether one logged maintenance input was queued.
   */
  prepare(agent: Agent, turn: number, signal: AbortSignal): Promise<boolean> {
    const pending = this.preparations.get(agent)
    if (pending !== undefined) return pending
    const operation = this.prepareNow(agent, turn, AbortSignal.any([signal, this.lifetime.signal]))
    this.preparations.set(agent, operation)
    this.track(operation)
    const settled = (): void => { if (this.preparations.get(agent) === operation) this.preparations.delete(agent) }
    void operation.then(settled, settled)
    return operation
  }

  /** Read exact complete project documents for a guarded maintenance request.
   * @param agent - Active lead Agent whose phase owns the observations.
   * @param paths - Explicit project-relative Markdown files; no recursive discovery.
   * @param signal - Ordinary tool cancellation.
   * @returns Complete logged original contents and freshness tokens.
   */
  readDocuments(agent: Agent, paths: readonly string[], signal: AbortSignal): Promise<ProjectContextDocument[]> {
    const operation = this.readNow(agent, paths, AbortSignal.any([signal, this.lifetime.signal]))
    this.track(operation)
    return operation
  }

  /** Publish a model's explicit assessment through the project's shared write queue.
   * @param agent - Active lead Agent admitted by the ordinary tool pipeline.
   * @param request - Bounded assessment and exact observed guide replacements.
   * @param signal - Ordinary tool cancellation.
   * @returns Actual terminal assessment and the paths successfully changed.
   */
  executeUpdate(agent: Agent, request: ProjectContextUpdateRequest, signal: AbortSignal): Promise<ProjectContextUpdateResult> {
    this.validateRequest(request)
    const phase = this.phaseOf(agent)
    const queues = this.queues.get(originalService(phase.scope.fs)) ?? new Map<FsTargetKey, Promise<void>>()
    this.queues.set(originalService(phase.scope.fs), queues)
    const previous = queues.get(phase.scope.rootTarget.targetKey) ?? Promise.resolve()
    const operationSignal = AbortSignal.any([signal, this.lifetime.signal])
    const operation = this.queueAdmission(previous, operationSignal).then(() => this.updateNow(agent, phase, request, operationSignal))
    const settled = operation.then(() => undefined, () => undefined)
    const tail = previous.then(() => settled)
    queues.set(phase.scope.rootTarget.targetKey, tail)
    void tail.then(() => { if (queues.get(phase.scope.rootTarget.targetKey) === tail) queues.delete(phase.scope.rootTarget.targetKey) })
    this.track(operation)
    this.track(tail)
    return operation
  }

  private async queueAdmission(previous: Promise<void>, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const cancelled = Promise.withResolvers<undefined>()
    const stop = (): void => { cancelled.reject(signal.reason) }
    signal.addEventListener('abort', stop, { once: true })
    try {
      await Promise.race([previous, cancelled.promise])
      signal.throwIfAborted()
    } finally {
      signal.removeEventListener('abort', stop)
    }
  }

  private track(operation: Promise<unknown>): void {
    this.operations.add(operation)
    void operation.then(() => { this.operations.delete(operation) }, () => { this.operations.delete(operation) })
  }

  private owner<K extends string & keyof Context>(agent: Agent, name: K): Context[K] | undefined {
    return agent.ctx.get('agentPresets')?.serviceFor(agent, name) ?? agent.ctx.get(name)
  }

  private installTools(tools: Context['tools']): void {
    const identity = originalService(tools)
    if (this.toolsInstalled.has(identity)) return
    registerProjectContextTools(this.ctx, tools, this)
    this.toolsInstalled.add(identity)
  }

  private discovery(agent: Agent) {
    const loader = this.ctx.bail(agentCarrier(agent), 'agent-instructions/discovery', { agent })
    if (loader?.enabled !== true || loader.projectContextFileName !== this.filename) {
      throw new HarnessError('Enable the matching project-context filename in this Agent’s instruction loader before maintaining project documents.',
        'PROJECT_CONTEXT_LOADER_UNAVAILABLE')
    }
    if ([...loader.instructionFileCandidates, ...loader.localInstructionFileCandidates]
      .some(candidate => candidate.toLowerCase() === this.filename.toLowerCase())) {
      throw new HarnessError('The project-context filename must differ from every instruction candidate and local overlay.',
        'PROJECT_CONTEXT_LOADER_UNAVAILABLE')
    }
    return loader
  }

  private phaseOf(agent: Agent): MaintenancePhase {
    const phase = this.phases.get(agent)
    if (phase === undefined || !this.activeOf(agent)) {
      throw new ToolContextUnavailableError('Project documents can be maintained only in the active lead Agent finalization phase.')
    }
    return phase
  }

  private documentOf(documents: ReadonlyMap<string, ObservedProjectDocument>, path: string): ObservedProjectDocument {
    const document = documents.get(path)
    if (document === undefined) throw new FsError(`Read the complete project document before updating it: ${path}`, 'FS_NOT_OBSERVED')
    return document
  }

  private assertCurrent(agent: Agent, phase: MaintenancePhase, signal: AbortSignal): void {
    signal.throwIfAborted()
    const fs = this.owner(agent, 'fs')
    const cwd = this.owner(agent, 'workingDirectory')?.get(agent.session) ?? agent.session.header.cwd
    if (this.ctx.fiber.state !== FiberState.ACTIVE || !this.activeOf(agent) || this.phases.get(agent) !== phase
      || fs === undefined || originalService(fs) !== originalService(phase.scope.fs) || cwd !== phase.cwd
      || JSON.stringify(this.discovery(agent)) !== phase.loader || agent.inbox.nextTurn.length !== 0) {
      throw new HarnessError('Project work or its filesystem policy changed; reassess the current documents before updating them.', 'PROJECT_CONTEXT_STALE')
    }
  }

  private async flush(session: Session, message: string): Promise<void> {
    try {
      if (!await this.ctx.sessions.flush(session)) throw new HarnessError(message, 'PROJECT_CONTEXT_DURABILITY_REQUIRED')
    } catch (cause) {
      if (cause instanceof HarnessError) throw cause
      throw new HarnessError(message, 'PROJECT_CONTEXT_DURABILITY_REQUIRED', { cause })
    }
  }

  private remember(agent: Agent, phase: MaintenancePhase, observed: ObservedProjectDocument): void {
    if (!phase.documents.has(observed.document.path) && phase.documents.size >= this.config.maxDocuments) {
      throw new ToolArgsError(['The maintenance phase exceeds maxDocuments; defer additional consolidation.'])
    }
    const previous = phase.documents.get(observed.document.path)
    if (previous?.document.version === observed.document.version && previous.document.content === observed.document.content) return
    agent.session.append('project-context/document-observed', { sourceTurn: phase.turn, root: phase.scope.root,
      document: observed.document })
    phase.documents.set(observed.document.path, observed)
  }

  private async prepareNow(agent: Agent, turn: number, signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted()
    const view = this.viewOf(agent.session)
    if (this.ctx.agents.get(agent.id) !== agent || agent.session.header.origin === 'subagent'
      || (agent.session.header.delegationDepth ?? 0) !== 0 || view?.sourceTurn !== turn
      || !['pending', 'updating'].includes(view.status) || agent.inbox.nextStep.length !== 0
      || agent.inbox.nextTurn.length !== 0) return false
    let phase = this.phases.get(agent)
    if (phase === undefined || phase.turn !== turn || view.status === 'pending') {
      const loader = this.discovery(agent)
      const fs = this.owner(agent, 'fs')
      const workingDirectory = this.owner(agent, 'workingDirectory')
      if (fs === undefined || workingDirectory === undefined) {
        throw new HarnessError('Project-document maintenance requires the Agent’s filesystem and working directory.', 'PROJECT_CONTEXT_FILESYSTEM_UNAVAILABLE')
      }
      const cwd = await workingDirectory.ensure(agent, signal)
      const root = await findProjectRoot(cwd, loader.projectRootMarkers, fs, signal)
      const rootTarget = await fs.resolve(root, { signal })
      const names = [...new Set([...loader.instructionFileCandidates, ...loader.localInstructionFileCandidates])]
      const scope: ProjectDocumentScope = { fs, root, rootTarget, contextFileName: this.filename,
        instructionNames: names, maxSourceBytes: this.config.maxSourceBytes }
      let primary: string | undefined
      let protectedPrimary = false
      for (const candidate of names) {
        if (candidate.toLowerCase() === this.filename.toLowerCase()) continue
        const info = await fs.lstat(resolve(root, candidate), {}, signal)
        if (info?.type === 'file') { primary = candidate; break }
        if (info !== undefined) protectedPrimary = true
      }
      if (primary === undefined && protectedPrimary) {
        throw new FsError('Existing primary instructions are symbolic links or non-files; retain them and defer automatic pointer updates.',
          'FS_PERMISSION_DENIED')
      }
      const selectedPrimary = primary ?? loader.instructionFileCandidates[0]
      phase = { turn, cwd, scope, ...selectedPrimary === undefined ? {} : { primary: selectedPrimary },
        documents: new Map(), loader: JSON.stringify(loader) }
      signal.throwIfAborted()
      const queued = (): boolean => agent.inbox.nextStep.length > 0 || agent.inbox.nextTurn.length > 0
      if (this.viewOf(agent.session)?.sourceTurn !== turn || queued()) return false
      this.phases.set(agent, phase)
      agent.session.append('project-context/status', { ...view, status: 'updating', root,
        contextPath: resolve(root, this.filename) })
      this.assertCurrent(agent, phase, signal)
      for (const path of [this.filename, ...phase.primary === undefined ? [] : [phase.primary]]) {
        const observed = await observeProjectDocument(scope, path, signal)
        this.assertCurrent(agent, phase, signal)
        this.remember(agent, phase, observed)
      }
      this.installTools(this.owner(agent, 'tools') ?? this.ctx.tools)
    }
    this.assertCurrent(agent, phase, signal)
    agent.steer(createUserMessage({ source: { kind: 'project-context', sourceTurn: turn }, content: [{ type: 'text',
      text: `Finalize current project documentation for ${JSON.stringify(phase.scope.root)}. Maintain ${this.filename} as the canonical current project context. `
        + 'Use project_context_read for complete original documents before requesting guide changes. '
        + 'Use project_context_update to report updated, unchanged with evidence that context is current, or deferred with a concrete blocker. '
        + 'Preserve unique facts and rationale before consolidating duplicates; preserve authored instructions, README entrypoints, scoped, generated, archived, vendor, and symlinked documents. '
        + 'Record the objective and scope, completed work, pending todos, design decisions and rationale, relevant files and references, '
        + 'observed validation results, blockers, and concrete next actions. Describe verification limits; do not invent successful checks or treat proposals as approved. '
        + 'Continue this assessment until current or explicitly deferred. Do not commit changes automatically.',
    }] }))
    return true
  }

  private async readNow(agent: Agent, paths: readonly string[], signal: AbortSignal): Promise<ProjectContextDocument[]> {
    const phase = this.phaseOf(agent)
    if (paths.length === 0 || paths.length > this.config.maxDocuments) throw new ToolArgsError(['Supply one to maxDocuments explicit Markdown paths.'])
    const documents: ProjectContextDocument[] = []
    for (const path of paths) {
      this.assertCurrent(agent, phase, signal)
      const observed = await observeProjectDocument(phase.scope, path, signal)
      this.assertCurrent(agent, phase, signal)
      this.remember(agent, phase, observed)
      documents.push({ ...observed.document })
    }
    return documents
  }

  private validateRequest(request: ProjectContextUpdateRequest): void {
    if (request.summary.trim() === '' || JSON.stringify(request).length > this.config.maxTextChars) {
      throw new ToolArgsError(['Project-context assessment must have a specific summary and fit maxTextChars.'])
    }
    const writes = (request.guideUpdates?.length ?? 0) + (request.forwardingStubs?.length ?? 0)
    if (writes > this.config.maxDocuments || (request.outcome === 'updated' ? request.context?.trim() === '' || request.context === undefined
      : request.context !== undefined || writes !== 0)) {
      throw new ToolArgsError(['Only updated may supply context or document changes, and it requires non-empty current context.'])
    }
  }

  private async updateNow(agent: Agent, phase: MaintenancePhase, request: ProjectContextUpdateRequest,
    signal: AbortSignal): Promise<ProjectContextUpdateResult> {
    const changedPaths: string[] = []
    try {
      return await this.publishAssessment(agent, phase, request, signal, changedPaths)
    } catch (cause) {
      if (changedPaths.length === 0) throw cause
      const message = `Project-document maintenance stopped after changing ${changedPaths.join(', ')}. `
        + `Re-read those files before retrying. ${cause instanceof Error ? cause.message : String(cause)}`
      const view = this.viewOf(agent.session)
      if (view?.sourceTurn === phase.turn) {
        agent.session.append('project-context/status', { ...view, status: 'updating', reason: message.slice(0, this.config.maxTextChars) })
      }
      throw new HarnessError(message, cause instanceof HarnessError ? cause.code : 'PROJECT_CONTEXT_WRITE_FAILED', { cause })
    }
  }

  private async publishAssessment(agent: Agent, phase: MaintenancePhase, request: ProjectContextUpdateRequest,
    signal: AbortSignal, changedPaths: string[]): Promise<ProjectContextUpdateResult> {
    this.assertCurrent(agent, phase, signal)
    const contextPath = resolve(phase.scope.root, this.filename)
    const original = this.documentOf(phase.documents, this.filename)
    if (request.outcome === 'unchanged' && (original.document.version === null || original.document.content.trim() === '')) {
      throw new ToolArgsError(['Unchanged requires an existing non-empty canonical context document; update it or defer with a concrete blocker.'])
    }
    await this.flush(agent.session, 'Original project documents were not saved. Restore Session storage before modifying their files.')
    this.assertCurrent(agent, phase, signal)
    if (request.outcome === 'updated') {
      const selected = requestedProjectDocuments(phase.scope, request, phase.documents)
      for (const observed of selected.values()) {
        await assertEditableGuide(phase.scope, observed, signal)
        this.assertCurrent(agent, phase, signal)
      }
      const canonical = this.documentOf(phase.documents, this.filename)
      const primary = phase.primary === undefined ? undefined : this.documentOf(phase.documents, phase.primary)
      if (request.context === undefined) throw new ToolArgsError(['Updated project context requires complete current context.'])
      const context = canonicalContextText(canonical.document.content, request.context)
      const pointer = primary === undefined ? undefined : projectContextPointerText(primary.document.content, this.filename)
      const policyOwner = this.owner(agent, 'sandboxPolicy')
      if (phase.scope.fs.sandboxMode !== undefined && policyOwner === undefined) {
        throw new HarnessError('A confining filesystem requires this Agent’s sandbox policy before project documents can change.', 'PROJECT_CONTEXT_POLICY_UNAVAILABLE')
      }
      const publish = async (observed: ObservedProjectDocument, content: string): Promise<ObservedProjectDocument> => {
        this.assertCurrent(agent, phase, signal)
        const policy = this.owner(agent, 'sandboxPolicy')?.resolve({ session: agent.session })
        const written = await publishProjectDocument(phase.scope, observed, content, policy, signal)
        if (written.document.version !== observed.document.version) changedPaths.push(resolve(phase.scope.root, observed.document.path))
        phase.documents.set(observed.document.path, written)
        return written
      }
      const written = await publish(canonical, context)
      await verifyCanonicalDocument(phase.scope, written, signal)
      if (primary !== undefined && pointer !== undefined) await publish(primary, pointer)
      for (const update of request.guideUpdates ?? []) {
        await verifyCanonicalDocument(phase.scope, written, signal)
        await publish(this.documentOf(selected, projectDocumentPath(phase.scope.root, update.path).path), update.newText)
      }
      for (const stub of request.forwardingStubs ?? []) {
        await verifyCanonicalDocument(phase.scope, written, signal)
        const path = projectDocumentPath(phase.scope.root, stub.path).path
        await publish(this.documentOf(selected, path), projectContextForwardingText(path, this.filename))
      }
    }
    this.assertCurrent(agent, phase, signal)
    const view = this.viewOf(agent.session)
    if (view === null) throw new HarnessError('The project-document turn is no longer available.', 'PROJECT_CONTEXT_STALE')
    agent.session.append('project-context/status', { ...view, status: request.outcome, summary: request.summary })
    try {
      await this.flush(agent.session,
        'The final project-document status was not saved. Restore Session storage before claiming completion.')
    } catch (cause) {
      agent.session.append('project-context/status', { ...view, status: 'updating',
        reason: 'The final project-document assessment was not durably acknowledged.' })
      throw cause
    }
    signal.throwIfAborted()
    return { outcome: request.outcome, summary: request.summary, contextPath, changedPaths }
  }
}

export default ProjectContextService
