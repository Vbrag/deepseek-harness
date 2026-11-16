/** Durable unfinished-work capture and explicitly requested continuation. */
import { createHash, randomUUID } from 'node:crypto'
import { FiberState, Service, symbols, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import { emitAgentEvent } from '@deepseek-ai/dsh-agent'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { ToolArgsError, ToolContextUnavailableError, defineTool } from '@deepseek-ai/dsh-tools'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-tool-todo'
import type {} from '@deepseek-ai/dsh-goal'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-working-directory'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-plan-mode'
import type {} from '@deepseek-ai/dsh-subagent'
import { createWorkHandoffProjection, createWorkCheckpointSchema } from './projection.ts'
import { renderWorkHandoffMarkdown } from './markdown.ts'
import { WorkHandoffError } from './error.ts'
import { decodePolicySeed } from './policy-seed.ts'
import type {
  WorkCaptureRequest, WorkCheckpoint, WorkHandoffId, WorkHandoffProjectionConfig,
  WorkHandoffState, WorkHandoffView, WorkStopReason, WorkWorkspaceFacts,
} from './types.ts'

export type * from './types.ts'
export { WorkHandoffError, type WorkHandoffErrorCode } from './error.ts'

function serviceIdentity(service: object | undefined): unknown {
  if (service === undefined) return undefined
  let identity = service
  while (true) {
    const original: unknown = Reflect.get(identity, symbols.original)
    if (typeof original !== 'object' || original === null || original === identity) return identity
    identity = original
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Durable work checkpoints and user-authorized continuation actions. */
    workHandoffs: WorkHandoffService
  }
}

/** Deployment bounds for captured evidence and read-only workspace inspection. */
export interface Config extends WorkHandoffProjectionConfig {
  /** Shared deadline in milliseconds for read-only Git workspace inspection. */
  readonly gitTimeoutMs: number
  /** Termination grace period in milliseconds for a cancelled Git process. */
  readonly processGraceMs: number
}

/** Owns handoff persistence; model requests remain with the ordinary Agent runtime. */
export class WorkHandoffService extends TypertRemoteService {
  static inject = ['agents', 'sessions', 'sessionProjections', 'tools']

  static Config: z<Config> = z.object({
    maxEvidence: z.number().step(1).min(1).default(24),
    maxTextChars: z.number().step(1).min(1).default(16384),
    maxPending: z.number().step(1).min(1).default(64),
    maxPolicyChars: z.number().step(1).min(1).default(1048576),
    gitTimeoutMs: z.number().step(1).min(1).default(5000),
    processGraceMs: z.number().step(1).min(1).default(250),
  })

  private projection: ProjectionHandle<WorkHandoffState> | undefined
  private readonly captures = new Map<Session, Promise<WorkHandoffView>>()
  private readonly operations = new Set<Promise<unknown>>()
  private readonly continuations = new Map<WorkHandoffId, Promise<{ sessionId: SessionId }>>()
  private readonly todoRecoveries = new Map<Agent, Promise<boolean>>()
  private readonly children = new Set<AgentHandle>()
  private readonly lifetime = new AbortController()

  /** @param ctx - Agent, persistence, projection, and model-tool services.
   * @param config - Validated capture bounds and subprocess deadline.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'workHandoffs', { namespace: 'workHandoffs' })
  }

  protected async [Service.init](): Promise<void> {
    this.projection = await this.ctx.sessionProjections.register(createWorkHandoffProjection(this.config))
    this.ctx.fiber.assertActive()
    this.ctx.effect(() => async () => {
      this.lifetime.abort(new DOMException('work handoff service unloaded', 'AbortError'))
      await Promise.allSettled([...this.operations])
      await Promise.allSettled([...this.children].map(handle => handle.dispose()))
      this.children.clear()
    }, 'work-handoff: drain capture and continuation')
    this.registerCheckpointTool()
    this.ctx.on('agent/created', ({ agent }) => {
      const handoff = this.viewOf(agent.session)
      if (handoff !== null && !handoff.saved) this.background(this.capture(agent, {
        reason: handoff.reason, todos: handoff.todos,
        ...handoff.goal === undefined ? {} : { goal: handoff.goal },
      }), agent)
    })
    this.ctx.on('session/event', (session, event) => {
      if (event.type !== 'turn/end' || !['aborted', 'error', 'max-tokens'].includes(event.data.reason.kind)) return
      const agent = this.ctx.agents.get(session.id)
      if (agent === undefined || agent.session !== session) return
      const todos = this.todosOf(agent)
      const goal = this.owningService(agent, 'goals')?.get(agent)
      if (!todos.some(todo => todo.status !== 'completed') && (goal === undefined || goal.phase === 'complete')) return
      const reason: WorkStopReason = event.data.reason.kind === 'aborted' ? 'cancelled'
        : event.data.reason.kind === 'max-tokens' ? 'output-limit' : 'error'
      const ending = event.data.reason
      const stopDetail = ending.kind === 'error' ? ending.error.message
        : ending.kind === 'aborted' ? (ending.reason.kind === 'hook' ? ending.reason.reason : `Cancellation: ${ending.reason.kind}.`)
          : 'The model reached its output-token limit.'
      this.background(this.capture(agent, { reason, stopDetail }), agent)
    })
  }

  /** Read the latest detached handoff without storage I/O.
   * @param session - Prepared source Session.
   * @returns Latest handoff or null after explicit continuation.
   */
  viewOf(session: Session): WorkHandoffView | null {
    const view = this.stateOf(session).latest
    return view === null ? null : structuredClone(view)
  }

  /** Read a prepared Agent's latest handoff.
   * @param agent - Source Agent resolved from its Session identity.
   * @returns Latest projected handoff.
   */
  @Remote('get')
  get(agent: Agent): WorkHandoffView | null {
    return this.viewOf(agent.session)
  }

  /** Save a model-authored checkpoint with explicit unverified claims and evidence.
   * @param agent - Calling live Agent.
   * @param checkpoint - Complete structured progress report.
   */
  checkpoint(agent: Agent, checkpoint: WorkCheckpoint): void {
    const parsed = createWorkCheckpointSchema(this.config).safeParse(checkpoint)
    if (!parsed.success || JSON.stringify(checkpoint).length > this.config.maxTextChars) {
      throw new ToolArgsError(['work checkpoint must match its schema and fit maxTextChars'])
    }
    agent.session.append('work-handoff/checkpoint', { checkpoint: parsed.data })
  }

  /** Capture unfinished work exactly once for the same stopped turn and allowance.
   * @param agent - Source Agent whose current work is captured.
   * @param request - Stop cause and optional authoritative domain snapshots.
   * @returns Saved handoff; storage failures reject without a saved acknowledgement.
   */
  capture(agent: Agent, request: WorkCaptureRequest): Promise<WorkHandoffView> {
    this.ctx.fiber.assertActive()
    const previous = this.captures.get(agent.session)
    const run = (previous === undefined ? Promise.resolve() : previous.catch(() => undefined))
      .then(() => this.captureNow(agent, request))
    this.captures.set(agent.session, run)
    this.track(run)
    const settled = (): void => {
      if (this.captures.get(agent.session) === run) this.captures.delete(agent.session)
    }
    void run.then(settled, settled)
    return run
  }

  /** Recover already authorized unfinished work through one shared idle maintenance operation.
   * @param agent - Live owner whose idle inbox may receive automatic recovery input.
   * @param signal - Caller lifetime; unloading leaves existing authorization unchanged.
   * @returns Whether one durable-checkpointed recovery input was queued.
   */
  recoverTodos(agent: Agent, signal?: AbortSignal): Promise<boolean> {
    const pending = this.todoRecoveries.get(agent)
    if (pending !== undefined) return pending
    if (!this.canRecoverTodos(agent)) return Promise.resolve(false)
    let cleanup = (): void => {}
    let cancelled = (): boolean => false
    let operation: Promise<boolean>
    try {
      operation = agent.runMaintenance((maintenance) => {
        cancelled = () => maintenance.aborted || this.lifetime.signal.aborted || signal?.aborted === true
        return this.recoverTodosNow(agent, maintenance, signal, (dispose) => { cleanup = dispose })
      }).then(queued => queued && !cancelled())
    } catch (_error) {
      // Another maintenance owner may claim an idle Agent before recovery admission.
      return Promise.resolve(false)
    }
    this.todoRecoveries.set(agent, operation)
    this.track(operation)
    const settled = (): void => {
      cleanup()
      if (this.todoRecoveries.get(agent) === operation) this.todoRecoveries.delete(agent)
    }
    void operation.then(settled, settled)
    return operation
  }

  /** Explicitly authorize this Session's current task list and queue one continuation.
   * @param agent - Agent selected by the user action.
   * @returns Completion after authorization and durable input admission.
   */
  @Remote('resumeTodos')
  async resumeTodos(agent: Agent): Promise<void> {
    this.assertIdleSource(agent)
    const turn = this.stateOf(agent.session).turn
    const goal = this.owningService(agent, 'goals')?.get(agent)
    if (goal !== undefined && goal.phase !== 'complete') {
      throw new WorkHandoffError('Use the goal controls to resume this goal or start a new Session from its handoff.',
        'WORK_HANDOFF_UNAVAILABLE')
    }
    const policy = this.owningService(agent, 'todoPolicy')
    if (policy === undefined) throw new WorkHandoffError('Todo continuation is unavailable.', 'WORK_HANDOFF_UNAVAILABLE')
    await policy.continueTask(agent)
    await this.flush(agent.session)
    this.assertIdleSource(agent)
    if (this.stateOf(agent.session).turn !== turn) throw new WorkHandoffError('Work changed while continuation was being saved.',
      'WORK_HANDOFF_STALE')
    const view = this.viewOf(agent.session)
    this.queueContinuation(agent, view?.markdown ?? 'Continue the authorized current task using its saved todo list.')
    agent.session.append('work-handoff/cleared', {})
    await this.flush(agent.session)
  }

  /** Start one fresh Session from an explicitly selected saved handoff.
   * @param agent - Source Agent whose restrictions and composition are retained.
   * @param id - Exact saved handoff selected by the user.
   * @returns The new Session identity; duplicate clicks share one creation.
   */
  @Remote('continueInNewSession')
  continueInNewSession(agent: Agent, id: WorkHandoffId): Promise<{ sessionId: SessionId }> {
    const existing = this.continuations.get(id)
    if (existing !== undefined) return existing
    const run = this.createContinuation(agent, id)
    this.continuations.set(id, run)
    this.track(run)
    void run.catch(() => { if (this.continuations.get(id) === run) this.continuations.delete(id) })
    return run
  }

  private stateOf(session: Session): WorkHandoffState {
    if (this.projection === undefined) throw new WorkHandoffError('Work handoffs have not activated.', 'WORK_HANDOFF_NOT_READY')
    return this.projection.stateOf(session)
  }

  private owningService<K extends 'todoPolicy' | 'goals' | 'workingDirectory' | 'attachments' | 'subprocess' | 'fs'
    | 'planMode' | 'subagents'>(
    agent: Agent, name: K,
  ): Context[K] | undefined {
    return agent.ctx.get('agentPresets')?.serviceFor(agent, name) ?? agent.ctx.get(name)
  }

  private todosOf(agent: Agent): WorkHandoffView['todos'] {
    return this.owningService(agent, 'todoPolicy')?.listOf(agent.session) ?? []
  }

  private canRecoverTodos(agent: Agent): boolean {
    if (this.lifetime.signal.aborted || this.ctx.fiber.state !== FiberState.ACTIVE
      || this.ctx.agents.get(agent.id) !== agent || agent.status !== 'idle'
      || agent.inbox.nextStep.length !== 0 || agent.inbox.nextTurn.length !== 0) return false
    const owner = this.owningService(agent, 'todoPolicy')
    const policy = owner?.viewOf(agent.session)
    if (owner === undefined || policy?.purpose !== 'current-task'
      || !['active', 'limit'].includes(policy.disposition)
      || !owner.listOf(agent.session).some(todo => todo.status !== 'completed')) return false
    const goal = this.owningService(agent, 'goals')?.get(agent)
    const plan = this.owningService(agent, 'planMode')?.get(agent)
    const state = this.stateOf(agent.session)
    const handoff = state.latest
    return (goal === undefined || goal.phase === 'complete') && plan?.active !== true && plan?.pending !== true
      && state.policyFailure === null && (handoff === null || handoff.reason === 'todo-limit')
  }

  private async recoveryWait(task: Promise<unknown>, signal: AbortSignal): Promise<boolean> {
    this.track(task)
    const aborted = Promise.withResolvers<boolean>()
    const onAbort = (): void => { aborted.resolve(false) }
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
    try {
      return await Promise.race([task.then(() => true), aborted.promise])
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  private async recoverTodosNow(agent: Agent, maintenance: AbortSignal, caller: AbortSignal | undefined,
    onCleanup: (dispose: () => void) => void): Promise<boolean> {
    const signal = AbortSignal.any([maintenance, this.lifetime.signal, ...caller === undefined ? [] : [caller]])
    const owner = this.owningService(agent, 'todoPolicy')
    const ownerIdentity = serviceIdentity(owner)
    const initial = this.stateOf(agent.session)
    let policy = JSON.stringify(owner?.viewOf(agent.session))
    const todos = JSON.stringify(owner?.listOf(agent.session))
    const seeds = JSON.stringify(initial.policySeeds)
    const model = JSON.stringify(agent.model.current())
    const current = (): boolean => {
      const state = this.stateOf(agent.session)
      return !signal.aborted && this.canRecoverTodos(agent)
        && serviceIdentity(this.owningService(agent, 'todoPolicy')) === ownerIdentity
        && state.turn === initial.turn && state.objectiveSeq === initial.objectiveSeq
        && state.latest?.id === initial.latest?.id && state.policyFailure === initial.policyFailure
        && JSON.stringify(state.policySeeds) === seeds && JSON.stringify(agent.model.current()) === model
        && JSON.stringify(owner?.viewOf(agent.session)) === policy && JSON.stringify(owner?.listOf(agent.session)) === todos
    }
    const pause = (reason: string): boolean => {
      if (this.ctx.agents.get(agent.id) !== agent || owner === undefined
        || serviceIdentity(this.owningService(agent, 'todoPolicy')) !== ownerIdentity
        || this.stateOf(agent.session).turn !== initial.turn
        || this.stateOf(agent.session).objectiveSeq !== initial.objectiveSeq
        || JSON.stringify(owner.viewOf(agent.session)) !== policy) return false
      void owner.suspend(agent, 'paused', reason)
      return true
    }
    let queued: ReturnType<typeof createUserMessage> | undefined
    let cancellationCleanup: Promise<undefined> | undefined
    const onAbort = (): void => {
      // Abort can arrive from a Session publication observer, which cannot append reentrantly.
      cancellationCleanup = Promise.resolve().then(() => {
        if (queued !== undefined) agent.inbox.remove(queued.id)
        const cancellation: unknown = maintenance.reason
        const disposed = typeof cancellation === 'object' && cancellation !== null
          && 'kind' in cancellation && cancellation.kind === 'disposed'
        if (maintenance.aborted && !disposed && pause('Execution was cancelled before automatic recovery completed.')) {
          const saving = this.flush(agent.session)
          this.track(saving)
          this.background(saving, agent)
        }
        return undefined
      })
      this.track(cancellationCleanup)
      this.background(cancellationCleanup, agent)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    onCleanup(() => { signal.removeEventListener('abort', onAbort) })
    if (signal.aborted) onAbort()
    try {
      if (!current()) return false
      const descendants = this.owningService(agent, 'subagents')
      if (descendants !== undefined && !await this.recoveryWait(descendants.waitForTreeWork(agent), signal)) return false
      if (!current() || owner === undefined || !owner.recoverAuthorizedTask(agent)) return false
      policy = JSON.stringify(owner.viewOf(agent.session))
      if (!await this.recoveryWait(this.flush(agent.session), signal) || !current()) return false
      queued = createUserMessage({ source: { kind: 'todo-reconcile' }, content: [{ type: 'text',
        text: 'Continue the already authorized current task using its saved todo list. '
          + 'Recheck the workspace and permissions. Preserve completed work and existing repair accounting; '
          + 'a proposed implementation still requires approval. Historical repair-attempt limits do not stop execution. '
          + 'Continue until the task is done, the user stops it, or a concrete blocker requires human input.\n\n'
          + initial.humanObjective,
      }] })
      agent.followup(queued)
      if (signal.aborted) return false
      if (initial.latest?.reason === 'todo-limit') agent.session.append('work-handoff/cleared', {})
      return !signal.aborted
    } catch (error) {
      if (!signal.aborted) {
        pause('The continuation checkpoint failed. Restore Session storage before continuing.')
        throw error
      }
      return false
    } finally {
      // Observe cancellation queued by inbox and handoff publication before maintenance can wake a turn.
      await Promise.resolve()
      if (signal.aborted) await cancellationCleanup
    }
  }

  private track<T>(operation: Promise<T>): void {
    this.operations.add(operation)
    void operation.then(() => { this.operations.delete(operation) }, () => { this.operations.delete(operation) })
  }

  private background(operation: Promise<unknown>, agent: Agent): void {
    void operation.catch((error: unknown) => {
      this.ctx.logger.error(`Could not save unfinished work for ${agent.id}: ${String(error)}`)
      emitAgentEvent(this.ctx, agent, 'agent/error', { turn: this.stateOf(agent.session).turn, step: 0, error })
    })
  }

  private async flush(session: Session): Promise<void> {
    try {
      if (!await this.ctx.sessions.flush(session)) throw new Error('No durable Session persistence provider is mounted.')
    } catch (cause) {
      throw new WorkHandoffError('The work handoff was not saved. Restore Session storage before continuing.',
        'WORK_HANDOFF_PERSISTENCE_FAILED', { cause })
    }
  }

  private async captureNow(agent: Agent, request: WorkCaptureRequest): Promise<WorkHandoffView> {
    const signal = AbortSignal.any([this.lifetime.signal, ...request.signal === undefined ? [] : [request.signal]])
    signal.throwIfAborted()
    const state = this.stateOf(agent.session)
    const assertCurrent = (): void => {
      const current = this.stateOf(agent.session)
      if (current.turn !== state.turn || current.objectiveSeq !== state.objectiveSeq
        || this.ctx.agents.get(agent.id) !== agent) {
        throw new WorkHandoffError('Work changed while its handoff was being captured.', 'WORK_HANDOFF_STALE')
      }
    }
    const liveGoal = this.owningService(agent, 'goals')?.get(agent)
    const currentGoal = request.goal ?? (liveGoal?.phase === 'complete' ? undefined : liveGoal)
    const goal = currentGoal === undefined ? undefined : {
      id: currentGoal.id, revision: currentGoal.revision, objective: currentGoal.objective,
      roundsStarted: currentGoal.roundsStarted, maxGoalRounds: currentGoal.maxGoalRounds,
    }
    const stopDetail = request.stopDetail ?? liveGoal?.blockedReason?.message
      ?? this.owningService(agent, 'todoPolicy')?.viewOf(agent.session)?.reason
    const resolved = { ...request, ...(goal === undefined ? {} : { goal }),
      ...stopDetail === undefined ? {} : { stopDetail }, todos: request.todos ?? this.todosOf(agent) }
    const identity: (string | number | undefined)[] = [agent.id, state.turn, request.reason, goal?.id,
      goal?.revision, goal?.roundsStarted, goal?.maxGoalRounds]
    if (stopDetail !== undefined) identity.push(createHash('sha256').update(stopDetail).digest('hex'))
    const key = identity.join(':')
    const id = brandString<WorkHandoffId>(key)
    if (state.latest?.id === id) {
      if (!state.latest.saved) {
        await this.flush(agent.session)
        signal.throwIfAborted()
        assertCurrent()
        agent.session.append('work-handoff/saved', { id })
      }
      const latest = this.viewOf(agent.session)
      if (latest?.id !== id) throw new WorkHandoffError('The handoff changed while it was being saved.', 'WORK_HANDOFF_STALE')
      return latest
    }
    const workspace = await this.workspaceFacts(agent, signal)
    signal.throwIfAborted()
    const current = this.stateOf(agent.session)
    assertCurrent()
    const markdown = renderWorkHandoffMarkdown(current, resolved, id, workspace)
    const attachmentStore = this.owningService(agent, 'attachments')
    let attachment: WorkHandoffView['attachment']
    let exportError: string | undefined
    try {
      if (attachmentStore === undefined) throw new Error('No file attachment provider is mounted; use Copy or download the embedded Markdown.')
      attachment = await attachmentStore.saveFile({ data: new TextEncoder().encode(markdown), name: `work-handoff-${state.turn}.md` })
    } catch (error) {
      exportError = String(error)
    }
    signal.throwIfAborted()
    assertCurrent()
    const handoff: WorkHandoffView = {
      id, sourceSessionId: agent.id, turn: current.turn, reason: request.reason,
      status: request.reason === 'goal-budget' ? 'budget-exhausted' : request.reason === 'waiting' ? 'waiting'
        : ['paused', 'cancelled'].includes(request.reason) ? 'paused' : 'work-remains',
      objective: goal?.objective ?? current.humanObjective,
      ...current.objectiveSeq === undefined ? {} : { objectiveSeq: current.objectiveSeq },
      markdown, saved: false, todos: structuredClone(resolved.todos),
      ...goal === undefined ? {} : { goal },
      ...attachment === undefined ? {} : { attachment },
      ...exportError === undefined ? {} : { exportError },
    }
    agent.session.append('work-handoff/captured', { handoff })
    await this.flush(agent.session)
    signal.throwIfAborted()
    agent.session.append('work-handoff/saved', { id })
    const latest = this.viewOf(agent.session)
    if (latest?.id !== id) throw new WorkHandoffError('The handoff changed while it was being saved.', 'WORK_HANDOFF_STALE')
    return latest
  }

  private async workspaceFacts(agent: Agent, signal: AbortSignal): Promise<WorkWorkspaceFacts> {
    const cwd = this.owningService(agent, 'workingDirectory')?.get(agent.session) ?? agent.session.header.cwd
    const subprocess = this.owningService(agent, 'subprocess')
    if (cwd === undefined || subprocess === undefined) return { ...(cwd === undefined ? {} : { cwd }), error: 'Git state was not inspected.' }
    const inspectSignal = AbortSignal.any([signal, AbortSignal.timeout(this.config.gitTimeoutMs)])
    try {
      const executable = await subprocess.resolveExecutable('git', undefined, inspectSignal)
      const run = async (args: string[]): Promise<string> => {
        const handle = subprocess.spawn({
          argv: [executable, ...args], cwd, signal: inspectSignal, graceMs: this.config.processGraceMs,
          stdio: { stdin: 'ignore', stdout: { maxBytes: this.config.maxTextChars }, stderr: { maxBytes: this.config.maxTextChars } },
        })
        const result = await handle.done
        if (result.exitCode !== 0) throw new Error(handle.collected.stderr?.readFrom(0).text ?? 'Git inspection failed.')
        const output = handle.collected.stdout?.readFrom(0)
        if (output?.lossy) throw new Error('Git output exceeded the captured evidence limit.')
        return output?.text.trim() ?? ''
      }
      const branch = await run(['branch', '--show-current'])
      const commit = await run(['rev-parse', 'HEAD'])
      const changes = (await run(['status', '--porcelain=v1'])).split('\n').filter(Boolean)
      return { cwd, branch, commit, changes }
    } catch (error) {
      signal.throwIfAborted()
      return { cwd, error: `Git state is unknown: ${String(error)}` }
    }
  }

  private queueContinuation(agent: Agent, markdown: string, source?: WorkHandoffView): void {
    const latest = source ?? this.viewOf(agent.session)
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Continue only the authorized task below. Recheck current workspace facts and permissions; '
        + 'do not assume a proposed implementation was approved.\n\n' + markdown }],
      source: latest === null ? { kind: 'user' } : {
        kind: 'work-handoff', sourceSessionId: latest.sourceSessionId, handoffId: latest.id,
      },
    }))
  }

  private async createContinuation(source: Agent, id: WorkHandoffId): Promise<{ sessionId: SessionId }> {
    this.assertIdleSource(source)
    if (source.session.header.origin === 'subagent') {
      throw new WorkHandoffError('Continue delegated work from its lead Session handoff.', 'WORK_HANDOFF_UNAVAILABLE')
    }
    const view = this.viewOf(source.session)
    if (view?.id !== id || !view.saved) throw new WorkHandoffError('Select the latest saved handoff.', 'WORK_HANDOFF_STALE')
    const state = this.stateOf(source.session)
    if (state.policyFailure !== null) throw new WorkHandoffError(state.policyFailure, 'WORK_HANDOFF_POLICY_UNAVAILABLE')
    const model = source.model.current()
    const sourcePurpose = this.owningService(source, 'todoPolicy')?.viewOf(source.session)?.purpose
    const maxTokens = source.options.maxTokens
    const sourcePresets = source.ctx.get('agentPresets')
    const preset = sourcePresets?.presetForSession(source.session) ?? undefined
    if (preset === undefined && source.session.header.agentPreset !== undefined) {
      throw new WorkHandoffError('The current source Agent preset cannot be resolved.', 'WORK_HANDOFF_UNAVAILABLE')
    }
    if (view.goal !== undefined && this.owningService(source, 'goals') === undefined) {
      throw new WorkHandoffError('Goal continuation is unavailable.', 'WORK_HANDOFF_UNAVAILABLE')
    }
    const policies = [...state.policySeeds]
    if (!policies.some(policy => policy.type === 'subagent/model-selection-policy')) {
      if (model === undefined) throw new WorkHandoffError('The original parent-only model permission cannot be resolved.',
        'WORK_HANDOFF_POLICY_UNAVAILABLE')
      policies.push({ type: 'subagent/model-selection-policy', data: {
        allowedModels: [{ provider: model.provider, model: model.model }],
      } })
    }
    const fs = this.owningService(source, 'fs')
    const cwd = this.owningService(source, 'workingDirectory')?.get(source.session) ?? source.session.header.cwd
    if (fs === undefined || cwd === undefined) throw new WorkHandoffError('The source workspace cannot be rechecked.', 'WORK_HANDOFF_WORKSPACE_UNAVAILABLE')
    const directory = await fs.resolve(cwd, { signal: this.lifetime.signal })
    if ((await fs.stat(directory, this.lifetime.signal))?.type !== 'directory') {
      throw new WorkHandoffError('The source workspace no longer exists.', 'WORK_HANDOFF_WORKSPACE_UNAVAILABLE')
    }
    const assertCurrentSource = (): void => {
      this.lifetime.signal.throwIfAborted()
      this.assertIdleSource(source)
      const current = this.stateOf(source.session)
      const currentModel = source.model.current()
      const currentPresets = source.ctx.get('agentPresets')
      if (current.turn !== state.turn || current.objectiveSeq !== state.objectiveSeq
        || current.latest?.id !== id || !current.latest.saved || current.policyFailure !== state.policyFailure
        || JSON.stringify(current.policySeeds) !== JSON.stringify(state.policySeeds)
        || (currentPresets?.presetForSession(source.session) ?? undefined) !== preset
        || (preset !== undefined && currentPresets?.composedPreset(source.ctx) !== preset)
        || currentModel?.provider !== model?.provider || currentModel?.model !== model?.model
        || currentModel?.reasoningEffort !== model?.reasoningEffort || source.options.maxTokens !== maxTokens
        || this.owningService(source, 'todoPolicy')?.viewOf(source.session)?.purpose !== sourcePurpose
        || (this.owningService(source, 'workingDirectory')?.get(source.session) ?? source.session.header.cwd) !== cwd) {
        throw new WorkHandoffError('Source work or restrictions changed while continuation was being prepared.',
          'WORK_HANDOFF_STALE')
      }
    }
    assertCurrentSource()
    const seed = policies.map(decodePolicySeed)
    const handle = await this.ctx.agents.create({
      sessionId: SessionId(`session-${randomUUID()}`), seed,
      meta: { cwd, ...preset === undefined ? {} : { agentPreset: preset } },
      agentOptions: { ...model, ...maxTokens === undefined ? {} : { maxTokens } },
      signal: this.lifetime.signal,
      setup: (agentCtx) => {
        if (preset !== undefined) {
          const presets = agentCtx.get('agentPresets')
          if (presets === undefined) throw new WorkHandoffError('The source Agent preset is unavailable.', 'WORK_HANDOFF_UNAVAILABLE')
          presets.composeFrom(agentCtx, source.ctx)
        }
        return { commit: assertCurrentSource }
      },
    })
    this.children.add(handle)
    try {
      const target = handle.agent
      target.session.append('work-handoff/imported', { sourceSessionId: source.id, handoffId: id, objective: view.objective })
      if (view.todos.length > 0) {
        const policy = this.owningService(target, 'todoPolicy')
        if (policy === undefined) throw new WorkHandoffError('Todo continuation is unavailable.', 'WORK_HANDOFF_UNAVAILABLE')
        if (sourcePurpose === 'proposal') policy.writeList(target, structuredClone(view.todos), 'proposal')
        else {
          target.session.append('todo/write', { todos: structuredClone(view.todos) })
          await policy.continueTask(target)
        }
      }
      const workspaces = this.ctx.get('workspaceRegistry')
      if (workspaces !== undefined) {
        const workspace = await workspaces.create(cwd)
        assertCurrentSource()
        await workspace.attachSession(target.id)
      }
      await this.flush(target.session)
      this.lifetime.signal.throwIfAborted()
      assertCurrentSource()
      this.queueContinuation(target, view.markdown, view)
      if (view.goal !== undefined) {
        const goals = this.owningService(target, 'goals')
        if (goals === undefined) throw new WorkHandoffError('Goal continuation is unavailable.', 'WORK_HANDOFF_UNAVAILABLE')
        goals.create(target, { objective: view.goal.objective, maxGoalRounds: view.goal.maxGoalRounds })
      }
      return { sessionId: target.id }
    } catch (error) {
      this.children.delete(handle)
      await handle.dispose()
      throw error
    }
  }

  private registerCheckpointTool(): void {
    this.ctx.tools.register(defineTool({
      name: 'work_checkpoint',
      description: 'Save a concise structured handoff before a stopping limit. Distinguish verified evidence from unverified claims; '
        + `the complete checkpoint must fit ${this.config.maxTextChars} characters.`,
      parameters: {
        summary: { type: 'string', required: true },
        completed: { type: 'array', items: { type: 'string' }, required: true },
        remaining: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
          task: { type: 'string', required: true }, nextActions: { type: 'array', items: { type: 'string' }, required: true },
          references: { type: 'array', items: { type: 'string' }, required: true },
        } } },
        validation: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
          command: { type: 'string', required: true }, result: { type: 'string', enum: ['passed', 'failed', 'unknown'], required: true },
          evidence: { type: 'array', items: { type: 'string' }, required: true },
        } } },
        blockers: { type: 'array', items: { type: 'string' }, required: true },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { recorded: { type: 'boolean', required: true } } },
        render: () => [{ type: 'text', text: 'Work checkpoint recorded. This does not mark the task complete.' }],
      },
      isConcurrencySafe: () => false,
      execute: (args, exec) => {
        if (exec.agent === undefined) throw new ToolContextUnavailableError('work_checkpoint requires an Agent Session')
        this.checkpoint(exec.agent, args)
        return Promise.resolve({ recorded: true })
      },
    }))
  }

  private assertIdleSource(agent: Agent): void {
    if (agent.status !== 'idle' || this.ctx.agents.get(agent.id) !== agent) {
      throw new WorkHandoffError('Wait until the source task stops before continuing its handoff.', 'WORK_HANDOFF_STALE')
    }
  }
}

export default WorkHandoffService
