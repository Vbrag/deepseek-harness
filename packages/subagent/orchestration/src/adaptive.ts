/** Safe-boundary phase routing and bounded request recovery for the lead and local children. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, RequestErrorAction } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-token-meter'
import type {} from '@deepseek-ai/dsh-work-handoff'
import type {} from '@deepseek-ai/dsh-compaction'
import type { LlmCallConfig, LlmResolvedModelInfo, UserMessage } from '@deepseek-ai/dsh-llm'
import { estimateRequestInputTokens } from '@deepseek-ai/dsh-llm/input-estimate'
import { offloadOldestImages } from '@deepseek-ai/dsh-compaction-image-offload/image-offload'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import type {
  SubagentModelChangeContext, SubagentModelChangeResult, SubagentModelRoute,
  SubagentColdModelChangeContext, SubagentModelChangeRequest,
  SubagentModelRoutingContext, SubagentModelRouting, SubagentTaskAssessment,
} from '@deepseek-ai/dsh-subagent'
import type { OrchestrationConfig, OrchestrationRoutingState, PoolRoute } from './types.ts'
import { adaptiveRoutingProjection, type AdaptiveProjectionState } from './adaptive-state.ts'
import { OrchestrationError } from './error.ts'

/** Existing-child admission constraints, independent of descendant delegation permissions. */
export interface AdaptiveAdmission {
  readonly allowedModels: readonly SubagentModelRoute[]
  readonly inputTokens?: number
  readonly excludeRoutes?: readonly PoolRoute[]
  readonly preferredRoute?: PoolRoute
  readonly minimumContextWindow?: number
  readonly readyOnly?: boolean
  readonly isCurrent?: () => boolean
  readonly onWaiting?: () => Promise<void>
}

interface RoutingHost {
  readonly config: Required<Omit<OrchestrationConfig, 'pool' | 'userPool' | 'userPoolConfigured' | 'userRouteCapabilities'>>
  modeOf(agent: Agent): boolean
  preparingEnabled(agent: Agent): boolean
  modeOfSession(session: Session): boolean
  validate(assessment: SubagentTaskAssessment): void
  resolve(request: SubagentModelRoutingContext, admission: AdaptiveAdmission): Promise<SubagentModelRouting>
}

function same(left: PoolRoute, right: PoolRoute): boolean {
  return left.provider === right.provider && left.model === right.model
}

/** Orchestration policy; the ordinary Agent remains the only request and tool driver. */
export class AdaptiveRouting {
  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()
  private readonly locks = new Map<SessionId, Promise<void>>()
  private readonly cooldowns = new Map<string, number>()
  private readonly requestBilling = new WeakMap<Agent, { route: PoolRoute; billing: LlmResolvedModelInfo['billing'] }>()

  private constructor(private ctx: Context, private host: RoutingHost,
    private projection: ProjectionHandle<AdaptiveProjectionState>) {}

  /** Register recovery state before installing callbacks that read it.
   * @param ctx - Owning plugin lifetime.
   * @param host - Shared fresh-child selector and deployment policy.
   * @returns Ready phase-routing owner.
   */
  static async create(ctx: Context, host: RoutingHost): Promise<AdaptiveRouting> {
    const instance = new AdaptiveRouting(ctx, host, await ctx.sessionProjections.register(adaptiveRoutingProjection))
    instance.install()
    return instance
  }

  /** Capture the initial phase before a child's first request.
   * @param agent - Unpublished child with an immutable runtime route grant.
   * @param assessment - Explicit initial task requirements.
   */
  initialize(agent: Agent, assessment: SubagentTaskAssessment): void {
    const route = agent.model.current()
    this.write(agent, { assessment, route: route === undefined ? null : { provider: route.provider, model: route.model },
      maxTokens: agent.options.maxTokens ?? null })
  }

  private state(agent: Agent): OrchestrationRoutingState { return this.projection.stateOf(agent.session).value }

  /** Read provider feedback shared by fresh and ongoing routing in this Harness instance.
   * @param route - Exact route whose last provider throttle may still apply.
   * @returns Remaining milliseconds, or zero when no provider cooldown is known.
   */
  providerWaitMs(route: PoolRoute): number {
    const key = JSON.stringify([route.provider, route.model])
    const remaining = Math.max(0, (this.cooldowns.get(key) ?? 0) - Date.now())
    if (remaining === 0) this.cooldowns.delete(key)
    return remaining
  }

  /** Whether known billing failures permit dispatch to these provider facts.
   * @param billing - Exact-route billing metadata, when supplied.
   * @returns False when independence from an exhausted budget is unknown.
   */
  billingAvailable(billing: LlmResolvedModelInfo['billing']): boolean {
    return this.ctx.llm.billingHealth.available(billing)
  }

  private hasBillingRestrictions(): boolean {
    return this.ctx.llm.billingHealth.restricted()
  }

  /** Allow a user to retry billing routes after correcting the account. */
  resetBillingHealth(): void {
    this.ctx.llm.billingHealth.reset()
  }

  private async noteBillingFailure(route: PoolRoute, signal: AbortSignal,
    captured?: { readonly billing: LlmResolvedModelInfo['billing'] }): Promise<void> {
    const observation = this.ctx.llm.billingHealth.begin()
    try {
      const billing = captured === undefined
        ? (await this.ctx.llm.resolveModelInfo(route.provider, route.model, signal)).billing : captured.billing
      observation.record(billing)
    } catch (error: unknown) {
      signal.throwIfAborted()
      observation.record(undefined)
      this.ctx.logger.warn('orchestration: billing scope could not be resolved', error)
    } finally {
      observation.dispose()
    }
  }

  private write(agent: Agent, patch: Partial<OrchestrationRoutingState>): void {
    this.writeSession(agent.session, patch)
  }

  private writeSession(session: Session, patch: Partial<OrchestrationRoutingState>): void {
    const current = this.projection.stateOf(session).value
    session.append('orchestration/routing-state', { ...current, ...patch, revision: current.revision + 1 })
  }

  private async flush(agent: Agent): Promise<void> {
    try {
      if (await this.ctx.sessions.flush(agent.session)) return
    } catch (cause: unknown) {
      throw new OrchestrationError('The routing checkpoint could not be saved; request admission is stopped.', 'ORCHESTRATION_DURABILITY_REQUIRED', { cause })
    }
    throw new OrchestrationError('Model change requires durable session storage; no switch was admitted.', 'ORCHESTRATION_DURABILITY_REQUIRED')
  }

  /** Queue an explicit assessed phase, optionally interrupting only the active request.
   * @param request - Runtime-validated caller, child, grant, and phase.
   * @returns Durable queued disposition; no task or Session is restarted.
   */
  async requestChange(request: SubagentModelChangeContext): Promise<SubagentModelChangeResult> {
    return this.serial(request.child, () => this.queueChange(request.child.session, request, request.allowedRoutes,
      () => this.flush(request.child), () => request.child.interruptRequest(request.reason)))
  }

  /** Queue a stopped child's phase without creating an Agent or waking existing work.
   * @param context - Catalog-authorized cold Session with an exclusive writer and explicit checkpoint operation.
   * @returns Saved queued phase; model admission waits for the next authorized resume.
   */
  requestColdChange(context: SubagentColdModelChangeContext): Promise<SubagentModelChangeResult> {
    return this.serial(context.session, () => this.queueChange(context.session, context.request, context.allowedRoutes, context.flush))
  }

  private async queueChange(session: Session, request: SubagentModelChangeRequest, allowed: readonly SubagentModelRoute[],
    flush: () => Promise<void>, interrupt?: () => boolean): Promise<SubagentModelChangeResult> {
    const { signal } = request
    signal.throwIfAborted()
    if (!this.host.modeOfSession(session)) throw new OrchestrationError('Enable Orchestration mode for this child before changing its model.', 'ORCHESTRATION_REASSIGNMENT_DISABLED')
    this.host.validate(request.taskAssessment)
    const preferred = request.preferredRoute
    if (preferred !== undefined && !allowed.some(route => same(route, preferred))) {
      throw new OrchestrationError('The requested model is outside this child\'s recorded permissions.', 'ORCHESTRATION_NO_CAPABLE_ROUTE')
    }
    const revision = this.projection.stateOf(session).value.revision + 1
    this.writeSession(session, { request: {
      revision,
      assessment: request.taskAssessment, reason: request.reason, checkpoint: request.checkpoint,
      ...request.preferredRoute === undefined ? {} : { preferredRoute: request.preferredRoute },
      ...request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens },
    }, status: 'queued', reason: request.reason })
    try {
      await flush()
      signal.throwIfAborted()
    } catch (error: unknown) {
      this.writeSession(session, { request: null, status: signal.aborted ? 'idle' : 'blocked', reason: 'Model-change admission did not complete.' })
      try { await flush() }
      catch (rollback: unknown) {
        throw new OrchestrationError('The model-change request was stopped, but its cancellation could not be saved.',
          'ORCHESTRATION_DURABILITY_REQUIRED', { cause: new AggregateError([error, rollback]) })
      }
      throw error
    }
    if (this.projection.stateOf(session).value.request?.revision !== revision) throw new OrchestrationError('A newer model-change request replaced this request.', 'ORCHESTRATION_REASSIGNMENT_STALE')
    if (request.interruptCurrentRequest === true) interrupt?.()
    return { status: 'queued', target: session.id }
  }

  private tracked<T>(task: Promise<T>): Promise<T> {
    this.pending.add(task)
    void task.then(() => { this.pending.delete(task) }, () => { this.pending.delete(task) })
    return task
  }

  private serial<T>(agent: { readonly id: SessionId }, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(agent.id) ?? Promise.resolve()
    const operation = previous.then(() => { this.lifetime.signal.throwIfAborted(); return task() })
    const settled = operation.then(() => undefined, () => undefined)
    this.locks.set(agent.id, settled)
    void settled.then(() => { if (this.locks.get(agent.id) === settled) this.locks.delete(agent.id) })
    return this.tracked(operation)
  }

  private inputTokens(agent: Agent, assessment: SubagentTaskAssessment, messages: readonly UserMessage[] = []): number {
    const observed = this.state(agent).observedInputTokens
    const measured = agent.ctx.get('tokenMeter')?.measure(agent.session).totalTokens
      ?? estimateRequestInputTokens(agent.session.deriveMessages())
    return Math.max(observed, measured + estimateRequestInputTokens(messages), assessment.contextTokens)
      + this.host.config.contextOverheadTokens
  }

  private options(agent: Agent): LlmCallConfig {
    const state = this.state(agent)
    const route = agent.model.current()
    if (route === undefined) throw new OrchestrationError('The child has no admitted model.', 'ORCHESTRATION_NO_CAPABLE_ROUTE')
    const explicitMax = state.request?.maxTokens ?? state.maxTokens ?? agent.options.maxTokens
    return { ...route, ...explicitMax === undefined ? {} : { maxTokens: explicitMax } }
  }

  private async choose(agent: Agent, signal: AbortSignal, reason: string,
    options: { automatic?: boolean; readyOnly?: boolean; minimumContextWindow?: number; messages?: readonly UserMessage[] } = {},
  ): Promise<boolean> {
    if (agent.session.header.origin !== 'subagent' || !this.host.preparingEnabled(agent)) return false
    const before = this.state(agent)
    const assessment = before.request?.assessment ?? before.assessment
    if (assessment === null) return false
    const current = agent.model.current()
    if (current === undefined) return false
    const automatic = options.automatic === true
    if (automatic && before.automaticChanges >= this.host.config.maxAutomaticReassignments) return false
    const allowed = this.ctx.subagents.runningModelPolicyOf(agent.session)
    const exclude = automatic ? [...before.tried, current] : []
    for (const route of allowed) {
      if (this.providerWaitMs(route) > 0) exclude.push(route)
    }
    let revision = before.revision
    const routing = await this.host.resolve({
      parent: agent, childId: agent.id,
      prompt: [...agent.session.deriveMessages(), ...options.messages ?? []].flatMap(message => message.content),
      taskAssessment: assessment,
      agentOptions: this.options(agent), signal,
    }, { allowedModels: allowed, inputTokens: this.inputTokens(agent, assessment, options.messages), excludeRoutes: exclude,
      ...before.request?.preferredRoute === undefined ? {} : { preferredRoute: before.request.preferredRoute },
      ...options.readyOnly === undefined ? {} : { readyOnly: options.readyOnly },
      ...options.minimumContextWindow === undefined ? {} : { minimumContextWindow: options.minimumContextWindow },
      isCurrent: () => this.state(agent).revision === revision && this.host.preparingEnabled(agent),
      onWaiting: async () => {
        if (this.state(agent).revision !== revision || !this.host.preparingEnabled(agent)) {
          throw new OrchestrationError('The phase or mode changed before admission.', 'ORCHESTRATION_REASSIGNMENT_STALE')
        }
        if (this.state(agent).status !== 'waiting') {
          this.write(agent, { status: 'waiting', reason })
          revision = this.state(agent).revision
          await this.flush(agent)
        }
      },
    })
    let admitted = false
    try {
      const selected = routing.agentOptions
      if (selected?.provider === undefined || selected.model === undefined) return false
      signal.throwIfAborted()
      if (!this.host.preparingEnabled(agent)) return false
      if (this.state(agent).revision !== revision) return this.state(agent).request !== null
      const route = { provider: selected.provider, model: selected.model }
      const changed = !same(current, route)
      this.write(agent, { status: 'changing', reason, route })
      await this.flush(agent)
      signal.throwIfAborted()
      if (!this.host.preparingEnabled(agent)) return false
      if (this.state(agent).request?.revision !== before.request?.revision) return this.state(agent).request !== null
      const selectedInfo = await this.ctx.llm.resolveModelInfo(route.provider, route.model, signal)
      if (!this.billingAvailable(selectedInfo.billing)) {
        routing.release?.()
        this.write(agent, { status: 'idle', route: { provider: current.provider, model: current.model } })
        await this.flush(agent)
        return await this.choose(agent, signal, reason, options)
      }
      agent.model.select({ ...route, ...selected.reasoningEffort === undefined ? {} : { reasoningEffort: selected.reasoningEffort } })
      this.write(agent, { assessment, request: null, route, previous: changed ? current : before.previous,
        status: 'idle', reason, checkpoint: before.request?.checkpoint ?? before.checkpoint,
        maxTokens: before.request?.maxTokens ?? before.maxTokens,
        automaticChanges: automatic && changed ? before.automaticChanges + 1 : before.request !== null ? 0 : before.automaticChanges,
        tried: automatic ? [...before.tried, { provider: current.provider, model: current.model }] : [], emptyLimits: 0,
      })
      await this.flush(agent)
      signal.throwIfAborted()
      admitted = true
      return changed || before.request !== null
    } catch (error: unknown) {
      if (!signal.aborted) this.write(agent, { status: 'blocked', reason: error instanceof Error ? error.message : 'Model admission failed.' })
      throw error
    } finally {
      if (!admitted) routing.release?.()
    }
  }

  private async prepareStep(agent: Agent, signal: AbortSignal, messages: readonly UserMessage[]): Promise<void> {
    for (;;) {
      await this.locks.get(agent.id)
      signal.throwIfAborted()
      try { await this.beforeStep(agent, signal, messages) }
      catch (error: unknown) {
        if (error instanceof OrchestrationError && error.code === 'ORCHESTRATION_REASSIGNMENT_STALE') continue
        if (error instanceof OrchestrationError && error.code === 'ORCHESTRATION_NO_CAPABLE_ROUTE') {
          await this.blocked(agent, error.message, signal)
        }
        throw error
      }
      if (!this.host.preparingEnabled(agent)) {
        const state = this.state(agent)
        if (agent.session.header.origin === 'subagent' && (state.status === 'waiting' || state.status === 'changing')) {
          const route = agent.model.current()
          this.write(agent, { status: state.request === null ? 'idle' : 'queued',
            route: route === undefined ? null : { provider: route.provider, model: route.model } })
          await this.flush(agent)
        }
        return
      }
      if (agent.session.header.origin !== 'subagent' || this.state(agent).request === null) return
    }
  }

  private async beforeStep(agent: Agent, signal: AbortSignal, messages: readonly UserMessage[]): Promise<void> {
    if (!this.host.preparingEnabled(agent)) return
    if (agent.session.header.origin !== 'subagent') return
    const operationSignal = AbortSignal.any([signal, this.lifetime.signal])
    const state = this.state(agent)
    if (state.request !== null) {
      const assessment = state.request.assessment
      if (!assessment.requiredCapabilities.includes('vision') && !assessment.requiredModalities?.includes('image')) {
        // The explicit phase checkpoint preserves completed visual findings before the recorded image omission.
        const retained = agent.session.deriveMessages().flatMap(message => message.content)
          .filter(block => block.type === 'image' && block.offloaded !== true).length
        if (retained > 0) offloadOldestImages(agent.session, agent.session.surface.nodes, retained)
      }
      await this.choose(agent, operationSignal, state.request.reason, { messages })
      return
    }
    if (state.assessment === null && !this.hasBillingRestrictions()) return
    const route = agent.model.current()
    if (route === undefined) return
    if (!this.ctx.subagents.runningModelPolicyOf(agent.session).some(allowed => same(allowed, route))) {
      throw new OrchestrationError('The selected child model is outside its recorded running-model permissions.',
        'ORCHESTRATION_NO_CAPABLE_ROUTE')
    }
    const info = await this.ctx.llm.resolveModelInfo(route.provider, route.model, operationSignal)
    if (!this.billingAvailable(info.billing)) {
      try {
        if (await this.choose(agent, operationSignal, 'shared-billing-exhaustion', { automatic: true, readyOnly: true, messages })) return
      } catch (error: unknown) {
        if (!(error instanceof OrchestrationError) || !['ORCHESTRATION_NO_CAPABLE_ROUTE', 'ORCHESTRATION_CAPACITY_BUSY'].includes(error.code)) throw error
      }
      throw new OrchestrationError('No eligible model has an available billing budget.', 'ORCHESTRATION_NO_CAPABLE_ROUTE')
    }
    if (state.assessment === null) return
    const config = await this.ctx.llm.resolveCallConfig(this.options(agent), operationSignal)
    const budget = await agent.ctx.get('compaction')?.pressureBudget(agent, { config }, operationSignal)
    const input = this.inputTokens(agent, state.assessment, messages)
    const capacity = info.context?.contextWindow
    const query = { ...route, inputTokens: input,
      maxTokens: config.maxTokens ?? state.assessment.outputTokens ?? this.host.config.outputReserveTokens }
    const queue = await this.ctx.llm.queueAvailability(query)
    if (queue.kind === 'wait' || queue.kind === 'impossible') {
      const pacing = await this.ctx.llm.requestTokenBudget(query)
      const trigger = pacing === undefined ? undefined : agent.ctx.get('compaction')?.tpmThreshold(config, pacing.tokenLimit)
      if (pacing !== undefined && trigger !== undefined && pacing.estimatedTokens >= trigger) return
      try {
        if (await this.choose(agent, operationSignal, 'quota-pressure', { automatic: true, readyOnly: true, messages })) return
      } catch (error: unknown) {
        if (!(error instanceof OrchestrationError) || !['ORCHESTRATION_NO_CAPABLE_ROUTE', 'ORCHESTRATION_CAPACITY_BUSY'].includes(error.code)) throw error
        // The adapter retains cancellable admission when no alternative is ready.
      }
    }
    if (capacity === undefined || (input < (budget?.thresholdTokens ?? capacity - (config.maxTokens ?? 0)))) return
    try {
      await this.choose(agent, operationSignal, 'context-pressure', {
        automatic: true, readyOnly: true, minimumContextWindow: capacity + 1, messages,
      })
    } catch (error: unknown) {
      if (!(error instanceof OrchestrationError) || !['ORCHESTRATION_NO_CAPABLE_ROUTE', 'ORCHESTRATION_CAPACITY_BUSY'].includes(error.code)) throw error
      // No ready larger route: the existing compaction provider still owns pressure recovery.
    }
  }

  private async blocked(agent: Agent, reason: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    this.write(agent, { status: 'blocked', reason })
    await this.flush(agent)
    const handoffs = agent.ctx.get('workHandoffs')
    if (handoffs !== undefined) {
      const checkpoint = this.state(agent).request?.checkpoint ?? this.state(agent).checkpoint
      await handoffs.capture(agent, { reason: 'error', signal,
        stopDetail: checkpoint === '' ? reason : `${reason}\nRecorded phase checkpoint (model supplied):\n${checkpoint}` })
    }
  }

  private initializeLead(agent: Agent, pending: readonly UserMessage[] = []): void {
    if (agent.session.header.origin === 'subagent') return
    const messages = [...agent.session.deriveMessages(), ...pending]
    const hasImage = messages.some(message => message.content.some(block => block.type === 'image' && block.offloaded !== true))
    const current = agent.model.current()
    const assessment: SubagentTaskAssessment = { requiredCapabilities: [],
      requiredModalities: hasImage ? ['text', 'image'] : ['text'], contextTokens: estimateRequestInputTokens(messages),
      ...agent.options.maxTokens === undefined ? {} : { outputTokens: agent.options.maxTokens } }
    const state = this.state(agent)
    if (JSON.stringify(state.assessment) === JSON.stringify(assessment)
      && (current === undefined ? state.route === null : state.route !== null && same(state.route, current))) return
    this.write(agent, {
      assessment,
      route: current === undefined ? null : { provider: current.provider, model: current.model },
      maxTokens: agent.options.maxTokens ?? null,
    })
  }

  private install(): void {
    this.ctx.effect(() => async () => {
      this.lifetime.abort(new DOMException('adaptive routing unloaded', 'AbortError'))
      await Promise.allSettled([...this.pending])
    }, 'orchestration: settle model reassignment')
    this.ctx.on('agent/step-preparing', ({ agent, signal, messages }) =>
      this.tracked(this.prepareStep(agent, signal, messages)))
    this.ctx.on('agent/request-ready', async ({ agent, request, preparedCall, signal }, next) => {
      if (signal.aborted || this.lifetime.signal.aborted) return next()
      this.requestBilling.set(agent, { route: { provider: request.provider, model: request.model }, billing: preparedCall?.billing })
      if (agent.session.header.origin === 'subagent') return next()
      await this.tracked((async () => {
        const operationSignal = AbortSignal.any([signal, this.lifetime.signal])
        operationSignal.throwIfAborted()
        if (this.host.preparingEnabled(agent) && this.hasBillingRestrictions() && !this.billingAvailable(preparedCall?.billing)) {
          throw new OrchestrationError(
            'The selected model billing budget is exhausted or unavailable. Correct billing or select another model, then retry.',
            'ORCHESTRATION_BILLING_UNAVAILABLE',
          )
        }
        const state = this.state(agent)
        const selected = agent.model.current()
        if (state.status === 'blocked' || state.status === 'waiting' || state.status === 'changing'
          || (selected !== undefined && state.route !== null && !same(state.route, selected))) {
          this.write(agent, { status: 'idle', reason: '',
            route: selected === undefined ? null : { provider: selected.provider, model: selected.model },
            previous: null, request: null, automaticChanges: 0, tried: [], emptyLimits: 0 })
          await this.flush(agent)
          operationSignal.throwIfAborted()
        }
      })())
      return next()
    }, { prepend: true })
    this.ctx.on('agent/request', async ({ agent }, next) => {
      const config = await next()
      if (agent.session.header.origin !== 'subagent' || !this.host.modeOf(agent)) return config
      const maximum = this.state(agent).maxTokens
      return maximum === null ? config : { ...config, maxTokens: maximum }
    })
    this.ctx.systemPrompt.context({ name: 'orchestration-phase', order: 610, required: true,
      text: ({ agent }) => {
        if (agent === undefined || !this.host.modeOf(agent)) return ''
        const state = this.state(agent)
        const checkpoint = state.request?.checkpoint ?? state.checkpoint
        const guidance = 'Use reassign_subagent for a new phase in an existing local child. Supply the phase\'s full task_assessment, a checkpoint of completed work and remaining actions, and max_tokens when an explicit generation cap is needed. outputTokens is only an estimate. Omit target only inside a child; the lead keeps its session model. Changes apply between steps; interrupt_current_request explicitly cancels only model generation, never tools.'
        return checkpoint === '' ? guidance : `${guidance}\nCurrent delegated phase: ${state.request?.reason ?? state.reason}\n${checkpoint}`
      },
    })
    this.ctx.on('agent/request-error', ({ agent, failure, signal, retryPolicy, provider, model, messages, stage }, next): Promise<RequestErrorAction> => this.tracked((async (): Promise<RequestErrorAction> => {
      if (signal.aborted || !this.host.modeOf(agent)) return next()
      const child = agent.session.header.origin === 'subagent'
      const state = this.state(agent)
      if (failure.code === 'REQUEST_INTERRUPTED') {
        if (child && state.request !== null) return { kind: 'reprepare' }
        return child ? next() : undefined
      }
      const billingFailure = ['QUOTA', 'ACCOUNT_QUOTA', 'BILLING_EXHAUSTED'].includes(failure.code)
      const observed = stage === 'stream' ? this.requestBilling.get(agent) : undefined
      const captured = observed !== undefined && same(observed.route, { provider, model }) ? observed : undefined
      if (!child) {
        this.initializeLead(agent, messages)
        if (billingFailure) await this.noteBillingFailure({ provider, model }, signal, captured)
        if (failure.code === 'RATE_LIMIT') this.cooldowns.set(JSON.stringify([provider, model]),
          Date.now() + (failure.providerRetryAfterMs ?? this.host.config.availabilityPollMs))
        const canRetry = !billingFailure && failure.code !== 'ORCHESTRATION_BILLING_UNAVAILABLE' && failure.code !== 'RATE_LIMIT_REQUEST_TOO_LARGE'
          && failure.code !== 'COMPACTION_DURABILITY_REQUIRED' && retryPolicy?.mode === 'normal'
        const action = canRetry ? await next() : undefined
        signal.throwIfAborted()
        if (action !== undefined) return action
        for (const message of messages ?? []) agent.session.append('user/message', message, { surfaceOp: 'append' })
        await this.blocked(agent, failure.code === 'ORCHESTRATION_BILLING_UNAVAILABLE' ? 'BILLING_UNAVAILABLE' : failure.code, signal)
        return undefined
      }
      if (!['CONTEXT_WINDOW_EXCEEDED', 'COMPACTION_INVALID_BUDGET',
        'MODEL_SWITCH_COMPACTION_FAILED', 'RATE_LIMIT', 'RATE_LIMIT_REQUEST_TOO_LARGE', 'QUOTA', 'ACCOUNT_QUOTA', 'BILLING_EXHAUSTED',
        'TIMEOUT', 'SERVER', 'TRANSPORT', 'MODEL_UNSUPPORTED', 'UNKNOWN_MODEL', 'NO_ADAPTER', 'AUTH',
        'INVALID_CREDENTIAL', 'MISSING_CREDENTIAL'].includes(failure.code)) return next()
      if (state.assessment === null) return next()
      if (billingFailure) await this.noteBillingFailure({ provider, model }, signal, captured)
      if (failure.code === 'RATE_LIMIT') {
        this.cooldowns.set(JSON.stringify([provider, model]),
          Date.now() + (failure.providerRetryAfterMs ?? this.host.config.availabilityPollMs))
      }
      try {
        if (await this.choose(agent, AbortSignal.any([signal, this.lifetime.signal]), failure.code,
          { automatic: true, readyOnly: true, ...messages === undefined ? {} : { messages } })) return { kind: 'reprepare' }
      } catch (error: unknown) {
        if (error instanceof OrchestrationError && error.code === 'ORCHESTRATION_REASSIGNMENT_STALE') return { kind: 'reprepare' }
        if (!(error instanceof OrchestrationError) || !['ORCHESTRATION_NO_CAPABLE_ROUTE', 'ORCHESTRATION_CAPACITY_BUSY'].includes(error.code)) throw error
      }
      const action = !billingFailure && retryPolicy?.mode === 'normal' ? await next() : undefined
      if (action !== undefined) return action
      await this.blocked(agent, `No safe model recovery remains: ${failure.code}`, signal)
      return undefined
    })()), { prepend: true })
    this.ctx.on('agent/request-finished', ({ agent, provider, model, finish, content, usage, signal }, next): Promise<RequestErrorAction> => this.tracked((async (): Promise<RequestErrorAction> => {
      if (signal.aborted || !this.host.modeOf(agent)) return next()
      const useful = content.some(block => block.type === 'text' && block.text.trim() !== '')
      if (!useful && finish.kind === 'max-tokens') this.initializeLead(agent)
      const state = this.state(agent)
      if (useful || finish.kind !== 'max-tokens' || state.assessment === null) return next()
      this.write(agent, { emptyLimits: state.emptyLimits + 1,
        observedInputTokens: Math.max(state.observedInputTokens, usage?.inputTokens ?? 0) })
      const info = await this.ctx.llm.resolveModelInfo(provider, model, signal)
      const oversized = (usage?.inputTokens ?? 0) > (info.context?.contextWindow ?? Infinity)
      if (!oversized && state.emptyLimits + 1 < this.host.config.maxEmptyOutputLimits) return { kind: 'retry' }
      if (agent.session.header.origin !== 'subagent') {
        await this.blocked(agent, oversized ? 'CONTEXT_WINDOW_EXCEEDED' : 'MAX_TOKENS', signal)
        return next()
      }
      try {
        const reason = oversized ? 'reported-context-pressure' : 'incomplete-output-limit'
        if (await this.choose(agent, AbortSignal.any([signal, this.lifetime.signal]), reason, { automatic: true })) return { kind: 'reprepare' }
      } catch (error: unknown) {
        if (error instanceof OrchestrationError && error.code === 'ORCHESTRATION_REASSIGNMENT_STALE') return { kind: 'reprepare' }
        if (!(error instanceof OrchestrationError) || error.code !== 'ORCHESTRATION_NO_CAPABLE_ROUTE') throw error
      }
      await this.blocked(agent, 'Compatible models did not produce a usable result before the recovery limit.', signal)
      return next()
    })()), { prepend: true })
  }
}
