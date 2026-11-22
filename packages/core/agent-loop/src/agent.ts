/**
 * Default Agent driver over queued turns and step-boundary input. Every request
 * is derived from the session log.
 * @module dsh-agent-loop/agent
 */

import type {
  Agent,
  AgentCancelCause,
  AgentEventDispatch,
  AgentOptions,
  AgentStatus,
  CancelOptions,
  ModelSelection,
  ModelSelectionProjectionState,
  InboxTarget,
  InboxState,
  PreStepDecision,
  RequestErrorAction,
  RequestReadyAction,
  TurnStoppingCause,
} from '@deepseek-ai/dsh-agent'
import { AgentModel, agentEvents, assembleContextFor } from '@deepseek-ai/dsh-agent'
import type { GenerateOptions, LlmCallConfig, Message, PreparedLlmCall, ResolvedRetryPolicy } from '@deepseek-ai/dsh-llm'
import {
  LlmError,
  createAssistantMessage,
  createDeveloperMessage,
  errorChain,
  markAgentLoopRequest,
} from '@deepseek-ai/dsh-llm'
import { assertNever, deepFreeze } from '@deepseek-ai/dsh-util-values'
import { HarnessError } from '@deepseek-ai/dsh-error'
import type { Scope } from '@deepseek-ai/dsh-scope'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { EpochHeader, RequestContext, Session, SessionId, SessionSeq, TurnEndReason, UserMessage } from '@deepseek-ai/dsh-session'
import { canonicalHeader, headerEquals, ToolCallRecovery } from '@deepseek-ai/dsh-session'
import { renderContextSections } from '@deepseek-ai/dsh-system-prompt'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import { ToolBatchExecutionError } from '@deepseek-ai/dsh-tools'
import type { ResolvedToolSet } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import { ReactLoopInbox } from './inbox.ts'
import { RuntimeContextProjection } from './runtime-context.ts'
import { AssistantStreamAttempt } from './assistant-stream.ts'

/** Projected facts consumed by this driver; registration stays with the factory. */
interface LoopProjections {
  /** Current model selection, including pending changes. */
  readonly modelSelection: () => ModelSelectionProjectionState
  /** Current queued and claimed input. */
  readonly inbox: () => InboxState
}

type Phase =
  | { kind: 'idle'; lastTurn: number }
  | {
    kind: 'maintenance'
    abort: AbortController
    lastTurn: number
    wakeRequested: boolean
  }
  | { kind: 'running'; abort: AbortController; turn: number; step: number; wakeRequested: boolean }

type PreparedStep =
  | { kind: 'reject' }
  | {
    kind: 'enter'
    messages: UserMessage[]
    startsRequestSeries?: true
    assembly: PromptAssembly
    selection: Readonly<ModelSelection>
    /** Admission shared by the step's declarations and dispatch; the turn disposes it after the step. */
    toolSet: ResolvedToolSet
  }

type RequestAttempt =
  | { kind: 'settled'; live: AssistantStreamAttempt; request: GenerateOptions; preparedCall: PreparedLlmCall | undefined }
  | { kind: 'recover'; action: Exclude<RequestErrorAction, undefined> }

interface StepAdmissions {
  firstAttempt: boolean
  offerMessages: boolean
  readonly ids: Set<UserMessage['id']>
}

/** Remove adapter-derived values before plugins propose the next request config. */
function requestProposal(header: EpochHeader): LlmCallConfig {
  if (header.adapterDefaults === undefined) return header.config
  const proposal = { ...header.config }
  if (header.adapterDefaults.reasoningEffort === true) delete proposal.reasoningEffort
  if (header.adapterDefaults.maxTokens === true) delete proposal.maxTokens
  return proposal
}

/**
 * Read the cause `cancel()` passed when aborting a loop-owned signal, copying
 * only the fields `turn/end` records. The live reason stays the caller's
 * object, and Node's fetch assigns a `stack` onto it that `Session.append`
 * would either log or reject as data JSON cannot hold.
 * @param signal - a turn or maintenance signal this loop owns.
 * @returns the copied cause, or undefined while the signal is still live.
 */
function abortedCancelCause(signal: AbortSignal): AgentCancelCause | undefined {
  if (!signal.aborted) return undefined
  // `cancel()` is the only aborter of the signals this loop owns.
  const cause = signal.reason as AgentCancelCause
  switch (cause.kind) {
    case 'user':
    case 'parent':
    case 'disposed':
      return { kind: cause.kind }
    case 'hook':
      return { kind: 'hook', reason: cause.reason }
    /* v8 ignore next -- cancel accepts the closed AgentCancelCause union */
    default:
      return assertNever(cause)
  }
}

/** Drives one session through turn and step boundaries. */
export class ReactLoopAgent implements Agent {
  readonly model: AgentModel
  readonly inbox: ReactLoopInbox
  private phase: Phase
  private activityDone: Promise<void> = Promise.resolve()
  /** Present only while request preparation or its transport is still active. */
  private requestAbort: AbortController | undefined

  /** The agent-scoped registration boundary; the lifecycle owner unwinds it after the driver exits. */
  readonly scope: Scope
  readonly ctx: Context

  /** Fused dispatcher, built once in the constructor so hot-path dispatches never allocate. */
  private readonly dispatch: AgentEventDispatch

  /** Whether this loop instance has appended its initial/resume request anchor. */
  private requestHeaderLogged = false
  /** Surface generation at attachment or the preceding built request. */
  private requestSurfaceGeneration: number
  private readonly runtimeContext: RuntimeContextProjection
  /** Process-local revision of assistant frames for this attached Session. */
  private assistantStreamRevision = 0
  private assistantAttemptCounter = 0
  /** Identities fully frozen by this loop; weak references do not retain replaced history. */
  private readonly frozenMessages = new WeakSet<Message>()

  constructor(
    private loopCtx: Context,
    public readonly id: SessionId,
    public readonly options: AgentOptions,
    public readonly session: Session,
    projections: LoopProjections,
    lastTurn: number,
    private readonly lifetimeSignal: AbortSignal,
  ) {
    this.requestSurfaceGeneration = session.surface.contentGeneration
    this.dispatch = agentEvents(loopCtx, this)
    this.scope = createScope(loopCtx, this)
    this.ctx = this.scope.ctx
    this.model = new AgentModel(projections.modelSelection, session, options)
    this.inbox = new ReactLoopInbox(projections.inbox, session, this.dispatch)
    this.phase = { kind: 'idle', lastTurn }
    this.runtimeContext = new RuntimeContextProjection(this.ctx, session)
  }

  get status(): AgentStatus {
    return this.phase.kind === 'idle' || this.phase.kind === 'maintenance' ? 'idle' : 'running'
  }

  /** Commit a phase and publish its externally visible status transition. */
  private setPhase(next: Phase): void {
    const previousStatus = this.status
    this.phase = next
    const status = this.status
    if (status !== previousStatus) {
      this.dispatch.emit('agent/status', { status })
    }
  }

  send(message: UserMessage, target: InboxTarget, wakeup: boolean): void {
    // Waking input cannot join an aborted activity, so it starts the next turn.
    // Captured before the insertion so a reentrant cancel from a splice observer cannot reclassify it.
    const wakingAfterAbort = wakeup && this.phase.kind !== 'idle' && this.phase.abort.signal.aborted
    const resolvedTarget = wakingAfterAbort ? 'next-turn' : target
    this.inbox.splice(resolvedTarget, Infinity, 0, [message])
    if (wakeup) this.wakeDriver(wakingAfterAbort)
  }

  followup(input: UserMessage): void {
    this.send(input, 'next-turn', true)
  }

  steer(input: UserMessage): void {
    this.send(input, 'next-step', true)
  }

  inject(input: UserMessage): void {
    this.send(input, 'next-step', false)
  }

  cancel(cause: AgentCancelCause, options: CancelOptions = {}): void {
    try {
      if (!options.keepInbox) this.inbox.clear()
    } finally {
      // Queue persistence must not prevent cancellation of admitted work.
      if (this.phase.kind !== 'idle') {
        if (!options.keepInbox) this.phase.wakeRequested = false
        this.phase.abort.abort(cause)
      }
    }
  }

  interruptRequest(reason?: string): boolean {
    const request = this.requestAbort
    if (request === undefined || request.signal.aborted || this.phase.kind !== 'running' || this.phase.abort.signal.aborted) return false
    request.abort(new DOMException(reason ?? 'The active model request was interrupted.', 'AbortError'))
    return true
  }

  runMaintenance<T>(job: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.phase.kind !== 'idle') throw new Error(`agent "${this.id}" already has active work`)
    const done = Promise.withResolvers<void>()
    const maintenance: Phase = {
      kind: 'maintenance',
      abort: new AbortController(),
      lastTurn: this.phase.lastTurn,
      wakeRequested: false,
    }
    this.setPhase(maintenance)
    this.activityDone = done.promise
    return (async () => {
      try {
        return await job(maintenance.abort.signal)
      } finally {
        this.setPhase({ kind: 'idle', lastTurn: maintenance.lastTurn })
        const cause = abortedCancelCause(maintenance.abort.signal)
        if (cause?.kind !== 'disposed' && maintenance.wakeRequested && this.inbox.hasPending) this.wakeDriver()
        done.resolve()
      }
    })()
  }

  /**
   * Start one driver, or latch its wake behind maintenance or an aborted
   * activity. A wake sent while idle always opens its turn boundary, even
   * when its message was cleared; only a latched replay is suppressed when
   * the queue no longer holds the wake.
   * @param wakeAfterAbort - the {@link send} classification, captured before
   *   the inbox insertion so a reentrant cancel cannot reclassify it.
   */
  private wakeDriver(wakeAfterAbort = false): void {
    if (this.lifetimeSignal.aborted) return
    if (this.phase.kind !== 'idle') {
      // Maintenance and aborted drivers cannot deliver the wake: latch it for
      // replay at convergence. Live drivers claim queued work themselves;
      // disposal never latches, so teardown waits on no model turn.
      const reason = abortedCancelCause(this.phase.abort.signal)
      if (reason?.kind !== 'disposed' && (this.phase.kind === 'maintenance' || wakeAfterAbort)) {
        this.phase.wakeRequested = true
      }
      return
    }
    const driver = Promise.withResolvers<void>()
    this.activityDone = driver.promise
    this.setPhase({
      kind: 'running',
      abort: new AbortController(),
      turn: this.phase.lastTurn,
      step: 0,
      wakeRequested: false,
    })
    this.loopCtx.agents.withInitiator(this, () => this.kick()).then(driver.resolve, driver.reject)
  }

  async whenIdle(): Promise<void> {
    let activity: Promise<void>
    do {
      await (activity = this.activityDone)
    } while (activity !== this.activityDone)
  }

  /** Report one failure at its live boundary, then preserve it for driver containment. */
  private throwError(error: unknown): never {
    const turn = this.phase.kind === 'running' ? this.phase.turn : this.phase.lastTurn
    const step = this.phase.kind === 'running' ? this.phase.step : 0
    this.dispatch.emit('agent/error', { turn, step, error })
    throw error
  }

  private async kick(): Promise<void> {
    try {
      while (await this.turn()) {}
    } catch (_error) {
      // Reported failures and cancellation are contained at the driver boundary.
    } finally {
      /* v8 ignore next -- kick owns a running phase until this driver boundary */
      if (this.phase.kind === 'running') {
        const { turn, wakeRequested } = this.phase
        this.setPhase({ kind: 'idle', lastTurn: turn })
        if (wakeRequested && this.inbox.hasPending) this.wakeDriver()
      }
    }
  }

  private async preStep(target: InboxTarget, position: { turn: number; step: number }, offered?: UserMessage[]): Promise<PreparedStep> {
    /* v8 ignore next -- private callers establish the running phase before proposing a step */
    if (this.phase.kind !== 'running') throw new Error(`agent "${this.id}": pre-step outside running phase`)
    const signal = this.phase.abort.signal
    const claimed = offered ?? this.inbox.claim(target, position.turn)
    while (true) {
      const previousSelection = this.model.current()
      try {
        await this.dispatch.serial('agent/step-preparing', { ...position, messages: claimed, signal })
      } catch (error: unknown) {
        const selection = this.model.current() ?? previousSelection
        if (selection === undefined) throw error
        const action = await this.requestError(error, selection, position, signal, 'step-preparation', undefined, undefined, claimed)
        if (action === undefined) throw error
        continue
      }
      signal.throwIfAborted()
      const selection = this.model.current()
      if (selection === undefined) {
        throw new Error(`agent "${this.id}" has no provider/model: set AgentOptions.provider and AgentOptions.model or record a model selection`)
      }
      let toolSet: ResolvedToolSet | undefined
      try {
        toolSet = await this.loopCtx.tools.resolve({ agent: this, modelSelection: selection, signal })
        const assembly = await this.loopCtx.systemPrompt.assemble({
          ...assembleContextFor(this, signal), modelSelection: selection, toolSet,
        })
        signal.throwIfAborted()
        const decision = await this.dispatch.waterfall(
          'agent/pre-step', { messages: claimed, ...position, signal, modelSelection: selection },
          (): Promise<PreStepDecision> => {
            const sections = renderContextSections(assembly)
            const context = this.runtimeContext.project(sections)
            return Promise.resolve<PreStepDecision>({
              kind: 'enter',
              messages: context === undefined ? claimed : [...claimed, context],
            })
          },
        )
        signal.throwIfAborted()
        if (decision.kind === 'reject') {
          toolSet.dispose()
          return decision
        }
        return { ...decision, assembly, selection, toolSet }
      } catch (error: unknown) {
        toolSet?.dispose()
        const action = await this.requestError(error, selection, position, signal, 'step-preparation', undefined, undefined, claimed)
        if (action === undefined) throw error
      }
    }
  }

  /** Open one turn before claiming its first proposed step. */
  private async turn(): Promise<boolean> {
    if (this.phase.kind !== 'running') {
      this.throwError(new Error(`agent "${this.id}": turn without driver reservation`))
    }
    const phase = this.phase
    const { signal } = phase.abort
    signal.throwIfAborted()
    const turn = phase.turn + 1
    try {
      this.session.append('turn/start', { turn })
    } catch (error: unknown) {
      this.throwError(error)
    }
    phase.turn = turn
    let turnEnds: TurnEndReason | null = null
    let stoppingCause: TurnStoppingCause | null = null
    let target: InboxTarget = 'next-turn'
    try {
      while (true) {
        signal.throwIfAborted()
        const step = phase.step + 1
        const decision = await this.preStep(target, { turn, step })
        if (decision.kind === 'reject') {
          turnEnds = { kind: 'blocked' }
          return false
        }
        try {
          if (turnEnds && decision.messages.length === 0) break
          // A removed waking message or an enter decision rewritten to empty
          // still owns the initial turn boundary, but it spends no model call.
          if (phase.step === 0 && decision.messages.length === 0) {
            turnEnds = { kind: 'completed' }
            return false
          }
          signal.throwIfAborted()
          this.session.append('step/start', { turn, step })
          phase.step = step
          const toolRecovery = new ToolCallRecovery()
          const stopRecovery = this.ctx.on('session/event', (session, event) => {
            if (session === this.session) toolRecovery.observe(event)
          })
          try {
            const stepCause = await this.step(decision)
            if (stepCause === 'rejected') {
              turnEnds = { kind: 'blocked' }
              return false
            }
            // max-tokens stays sticky: a later completed step must not
            // downgrade the turn outcome.
            if (turnEnds === null || turnEnds.kind !== 'max-tokens') {
              stoppingCause = stepCause
              turnEnds = stepCause === null ? null : { kind: stepCause === 'output-limit' ? 'max-tokens' : 'completed' }
            }
          } catch (error: unknown) {
            try {
              for (const event of toolRecovery.results()) {
                this.session.append('tool/result', event.data, {
                  surfaceOp: 'append',
                  ...event.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: event.sourceEventSeqs },
                })
              }
            } catch (recoveryError: unknown) {
              throw new AggregateError([error, recoveryError], 'Step failed and its pending tool results could not be recorded', { cause: error })
            }
            throw error
          } finally {
            stopRecovery()
            this.session.append('step/end', { turn, step })
          }
        } finally {
          // Admission closes once the step's tool batch settles or no step opens.
          decision.toolSet.dispose()
        }
        signal.throwIfAborted()
        if (stoppingCause !== null && this.inbox.nextStep.length === 0) {
          await this.dispatch.serial('agent/turn-stopping', { turn, cause: stoppingCause, signal })
          signal.throwIfAborted()
        }
        if (turnEnds && this.inbox.nextStep.length === 0) break
        target = 'next-step'
      }
    } catch (error: unknown) {
      // A cause is present exactly while the signal is aborted.
      const cause = abortedCancelCause(signal)
      if (cause !== undefined) {
        turnEnds = { kind: 'aborted', reason: cause }
        throw error
      }
      // Every failure is structured: an `LlmError` keeps its facts, a harness
      // failure keeps its code, and anything else flattens to
      // `errorChain` text under the `UNKNOWN` code.
      turnEnds = {
        kind: 'error',
        error: error instanceof LlmError
          ? error.failure
          : { message: errorChain(error), code: error instanceof HarnessError ? error.code : 'UNKNOWN' },
      }
      this.throwError(error)
    } finally {
      try {
        // oxlint-disable-next-line typescript/no-non-null-assertion -- every exit assigns a turn ending
        this.session.append('turn/end', { turn, reason: turnEnds! })
      } catch (error: unknown) {
        this.throwError(error)
      }
    }
    if (!this.inbox.hasPending) return false
    phase.abort = new AbortController()
    // A fresh controller makes a latch set on the old one stale: the live driver claims the queue itself.
    phase.wakeRequested = false
    phase.step = 0
    return true
  }

  /** Offer only structured operational failures to the request recovery owner. */
  private async requestError(
    error: unknown, selection: Readonly<ModelSelection>, position: { turn: number; step: number },
    signal: AbortSignal, stage: 'step-preparation' | 'request-preparation' | 'stream',
    retryPolicy?: ResolvedRetryPolicy, interruption?: string, messages?: readonly UserMessage[],
  ): Promise<RequestErrorAction> {
    signal.throwIfAborted()
    const failure = interruption !== undefined ? { code: 'REQUEST_INTERRUPTED', message: interruption }
      : error instanceof LlmError ? error.failure
        : error instanceof HarnessError ? { code: error.code, message: error.message } : undefined
    if (failure === undefined) throw error
    const action = await this.dispatch.waterfall('agent/request-error', {
      ...position, provider: selection.provider, model: selection.model, failure, retryPolicy, signal, stage,
      ...interruption === undefined ? {} : { requestInterrupted: true as const },
      ...messages === undefined ? {} : { messages },
    }, () => Promise.resolve<RequestErrorAction>(undefined))
    signal.throwIfAborted()
    return action
  }

  /** Retain an interrupted or discarded generation before any recovery can proceed. */
  private settleFailedAttempt(live: AssistantStreamAttempt, request: GenerateOptions, signal: AbortSignal): void {
    if (live.ended) return
    const content = signal.aborted ? live.interruptedBlocks() : []
    if (content.length > 0) {
      live.settle('assistant/message', () => this.session.append('assistant/message', {
        turn: live.turn, step: live.step,
        message: createAssistantMessage({ content, source: {
          provider: request.provider, model: request.model,
          ...live.replayState === undefined ? {} : { replayState: live.replayState },
        } }), interrupted: true,
        ...live.usage === undefined ? {} : { usage: live.usage }, stream: live.stream,
      }, { surfaceOp: 'append' }).seq)
    } else {
      live.settle('assistant/attempt', () => this.session.append('assistant/attempt', {
        turn: live.turn, step: live.step, stream: live.stream,
      }).seq)
    }
  }

  /** Prepare, admit, and settle the transport before exposing request recovery. */
  private async requestAttempt(
    decision: Extract<PreparedStep, { kind: 'enter' }>, position: { turn: number; step: number },
    admissions: StepAdmissions, turnSignal: AbortSignal,
  ): Promise<RequestAttempt> {
    const abort = new AbortController()
    this.requestAbort = abort
    const signal = AbortSignal.any([turnSignal, abort.signal])
    let preparedCall: PreparedLlmCall | undefined
    let live: AssistantStreamAttempt | undefined
    let request: GenerateOptions | undefined
    let started = false
    try {
      const prepared = await this.prepareRequest(position.turn, position.step, decision.selection, signal)
      preparedCall = prepared.preparedCall
      const assembly = decision.assembly
      const currentContext = this.loopCtx.systemPrompt.refreshContext(assembly, {
        ...assembleContextFor(this, signal), modelSelection: decision.selection,
      })
      const context = this.runtimeContext.project(renderContextSections(currentContext))
      signal.throwIfAborted()
      const startsRequestSeries = admissions.firstAttempt && decision.startsRequestSeries === true
      for (const { message, intent } of assembly.systemUpdates(!admissions.offerMessages)) {
        this.session.append('system/message', { ...position, message }, intent)
      }
      const admit = (message: UserMessage): void => {
        if (admissions.ids.has(message.id)) return
        this.session.append('user/message', message, { surfaceOp: 'append' })
        admissions.ids.add(message.id)
      }
      let contextAdmitted = false
      if (admissions.offerMessages) {
        for (const message of decision.messages) {
          if (message.source.kind === 'runtime-context') {
            if (context !== undefined && !contextAdmitted) { admit(context); contextAdmitted = true }
          } else admit(message)
        }
      }
      if (context !== undefined && !contextAdmitted) admit(context)
      admissions.firstAttempt = false
      admissions.offerMessages = false
      request = this.buildRequest(prepared.config, preparedCall, assembly.tools, position, startsRequestSeries, signal)
      const ready = await this.dispatch.waterfall('agent/request-ready', {
        ...position, request, preparedCall, signal,
      }, () => Promise.resolve<RequestReadyAction>(undefined))
      signal.throwIfAborted()
      if (ready !== undefined) return { kind: 'recover', action: ready }
      live = new AssistantStreamAttempt(this.session.id, ++this.assistantAttemptCounter,
        () => ++this.assistantStreamRevision, position.turn, position.step,
        (frame) => { this.dispatch.emit('agent/assistant-stream', { frame }) })
      const stream = preparedCall?.stream(request) ?? this.loopCtx.llm.stream(request)
      signal.throwIfAborted()
      live.start()
      started = true
      for await (const chunk of stream) {
        signal.throwIfAborted()
        live.push(chunk)
      }
      signal.throwIfAborted()
      return { kind: 'settled', live, request, preparedCall }
    } catch (error: unknown) {
      if (started && live !== undefined && request !== undefined) {
        try {
          this.settleFailedAttempt(live, request, turnSignal)
        } catch (settlementError: unknown) {
          throw new AggregateError([error, settlementError],
            'Assistant stream failed and its durable settlement was rejected', { cause: error })
        }
      }
      if (this.requestAbort === abort) this.requestAbort = undefined
      turnSignal.throwIfAborted()
      const reason: unknown = abort.signal.reason
      const interruption = abort.signal.aborted ? reason instanceof Error ? reason.message : 'The model request was interrupted.' : undefined
      const action = await this.requestError(error, decision.selection, position, turnSignal,
        started ? 'stream' : 'request-preparation', preparedCall?.retryPolicy, interruption,
        admissions.offerMessages ? decision.messages : undefined)
      if (action === undefined) {
        if (interruption !== undefined) throw new HarnessError(interruption, 'REQUEST_INTERRUPTED', { cause: error })
        throw error
      }
      return { kind: 'recover', action }
    } finally {
      if (this.requestAbort === abort) this.requestAbort = undefined
    }
  }

  private async step(initial: Extract<PreparedStep, { kind: 'enter' }>): Promise<TurnStoppingCause | 'rejected' | null> {
    if (this.phase.kind !== 'running') throw new Error('agent "' + this.id + '": step outside running phase')
    const { turn, step, abort: { signal } } = this.phase
    signal.throwIfAborted()
    const offered = [...initial.messages]
    const admissions: StepAdmissions = { firstAttempt: true, offerMessages: true, ids: new Set() }
    let decision = initial
    const reprepare = async (): Promise<boolean> => {
      decision.toolSet.dispose()
      const next = await this.preStep('next-step', { turn, step }, offered)
      if (next.kind === 'reject') return false
      decision = next
      admissions.offerMessages = true
      return true
    }
    try {
      while (true) {
        const attempt = await this.requestAttempt(decision, { turn, step }, admissions, signal)
        if (attempt.kind === 'recover') {
          if (attempt.action.kind === 'reprepare' && !await reprepare()) return 'rejected'
          continue
        }
        const { live, request, preparedCall } = attempt
        try {
          const finish = live.finish
          if (finish.kind === 'error' || finish.kind === 'aborted') {
            live.settle('assistant/attempt', () => this.session.append('assistant/attempt', { turn, step, stream: live.stream }).seq)
            const failure = LlmError.fromFailure(finish.failure)
            const action = await this.requestError(failure, decision.selection, { turn, step }, signal, 'stream', preparedCall?.retryPolicy)
            if (action === undefined) throw failure
            if (action.kind === 'reprepare' && !await reprepare()) return 'rejected'
            continue
          }
          const action = await this.dispatch.waterfall('agent/request-finished', {
            turn, step, provider: request.provider, model: request.model, finish, content: live.blocks(),
            ...live.usage === undefined ? {} : { usage: live.usage }, signal,
          }, () => Promise.resolve<RequestErrorAction>(undefined))
          signal.throwIfAborted()
          if (action !== undefined) {
            live.settle('assistant/attempt', () => this.session.append('assistant/attempt', { turn, step, stream: live.stream }).seq)
            if (action.kind === 'reprepare' && !await reprepare()) return 'rejected'
            continue
          }
          const message = createAssistantMessage({ content: live.blocks(), source: {
            provider: request.provider, model: request.model,
            ...live.replayState === undefined ? {} : { replayState: live.replayState },
          } })
          live.settle('assistant/message', () => this.session.append('assistant/message', {
            turn, step, message, ...live.usage === undefined ? {} : { usage: live.usage }, stream: live.stream,
          }, { surfaceOp: 'append' }).seq)
          if (finish.kind === 'max-tokens') return 'output-limit'
          const toolCalls = message.content.filter(block => block.type === 'tool-call')
          if (toolCalls.length === 0) return 'model-finished'
          const maxParallelToolCalls = this.loopCtx.agentLoop.config.maxParallelToolCalls.get()
          try {
            const result = await this.loopCtx.tools.execute({ calls: toolCalls, signal, agent: this,
              log: { turn, step }, maxParallelToolCalls, toolSet: decision.toolSet })
            for (const context of result.additionalContexts) this.inbox.splice('next-step', this.inbox.nextStep.length, 0, [context])
            return result.concluded ? 'tool-concluded' : null
          } catch (error: unknown) {
            if (!(error instanceof ToolBatchExecutionError)) throw error
            for (const context of error.partial.additionalContexts) this.inbox.splice('next-step', this.inbox.nextStep.length, 0, [context])
            throw error.cause
          }
        } catch (error: unknown) {
          if (!live.ended) {
            if (signal.aborted) this.settleFailedAttempt(live, request, signal)
            else live.abandon()
          }
          throw error
        }
      }
    } finally {
      if (decision !== initial) decision.toolSet.dispose()
    }
  }

  /** Resolve request config for the step's selection and bind its adapter before admitting model-visible input. */
  private async prepareRequest(
    turn: number,
    step: number,
    selection: Readonly<ModelSelection>,
    signal: AbortSignal,
  ): Promise<{ config: LlmCallConfig; preparedCall?: PreparedLlmCall }> {
    const { session } = this

    // A loop instance seeds output controls from its options until it logs its
    // own header; later steps re-resolve marked defaults.
    const maxTokens = this.options.maxTokens
    const persisted: Partial<LlmCallConfig> = this.requestHeaderLogged
      // oxlint-disable-next-line typescript/no-non-null-assertion -- the instance logged the header it now folds
      ? requestProposal(session.requestHeader()!)
      : maxTokens === undefined ? {} : { maxTokens }
    const { provider: _provider, model: _model, reasoningEffort: _effort, ...controls } = persisted
    const seedConfig = deepFreeze(structuredClone({ ...controls, ...selection }))
    const proposedConfig = await this.dispatch.waterfall(
      'agent/request', { turn, step, signal },
      () => Promise.resolve(seedConfig),
    )
    signal.throwIfAborted()
    if (proposedConfig.provider !== selection.provider || proposedConfig.model !== selection.model) {
      throw new Error(`agent "${this.id}": agent/request proposed "${proposedConfig.provider}/${proposedConfig.model}" after step preparation fixed "${selection.provider}/${selection.model}"; use agent.model.select() before step preparation`)
    }
    if (proposedConfig.reasoningEffort !== selection.reasoningEffort) {
      throw new Error(`agent "${this.id}": agent/request proposed reasoning effort "${proposedConfig.reasoningEffort ?? 'adapter default'}" after step preparation fixed "${selection.reasoningEffort ?? 'adapter default'}"; use agent.model.select() before step preparation`)
    }
    let config: LlmCallConfig
    let preparedCall: PreparedLlmCall | undefined
    try {
      preparedCall = await this.loopCtx.llm.prepareCall(proposedConfig, signal)
      config = preparedCall.config
    } catch (error: unknown) {
      // Middleware may serve an unregistered route; terminal dispatch still requires an adapter.
      if (!(error instanceof LlmError) || error.code !== 'NO_ADAPTER') throw error
      config = proposedConfig
    }
    signal.throwIfAborted()
    return { config, ...preparedCall === undefined ? {} : { preparedCall } }
  }

  /** Log the resolved envelope and derive a frozen request from the admitted surface. */
  private buildRequest(
    config: LlmCallConfig,
    preparedCall: PreparedLlmCall | undefined,
    tools: GenerateOptions['tools'] & object,
    position: { turn: number; step: number },
    startsRequestSeries: boolean,
    signal: AbortSignal,
  ): GenerateOptions {
    const { session } = this
    const surfaceGeneration = session.surface.contentGeneration
    const header = canonicalHeader({
      config,
      ...preparedCall === undefined ? {} : { adapterDefaults: preparedCall.adapterDefaults },
      ...tools.length > 0 ? { tools } : {},
    })
    const baseline = this.session.requestHeader()
    const startsSeries = startsRequestSeries
      || this.requestSurfaceGeneration !== surfaceGeneration
    let headerSeq: SessionSeq | undefined
    if (!this.requestHeaderLogged) {
      // Compaction during the first resumed pre-step must still mark a new series.
      headerSeq = this.session.append('request/header', {
        header,
        reason: baseline === undefined ? 'initial' : 'resume',
        ...startsSeries ? { startsSeries: true } : {},
      }).seq
      this.requestHeaderLogged = true
    } else if (baseline === undefined || !headerEquals(baseline, header)) {
      headerSeq = this.session.append('request/header', {
        header,
        reason: 'change',
        ...startsSeries ? { startsSeries: true } : {},
      }).seq
    } else if (startsSeries) {
      this.session.append('request/header', { header, reason: 'series' })
    }
    if (baseline !== undefined && headerSeq !== undefined) {
      const previousNames = new Set(baseline.tools?.map(tool => tool.name))
      const currentNames = new Set(tools.map(tool => tool.name))
      const additions = tools.filter(tool => !previousNames.has(tool.name))
        .map(tool => ({ type: 'tool-addition' as const, toolName: tool.name }))
      const removals = (baseline.tools ?? []).filter(tool => !currentNames.has(tool.name))
        .map(tool => ({ type: 'tool-removal' as const, toolName: tool.name }))
      if (additions.length > 0 || removals.length > 0) {
        session.append('developer/message', {
          ...position,
          message: createDeveloperMessage({ source: { kind: 'tool-registry' }, content: [...additions, ...removals] }),
          ...additions.length > 0 ? { headerSeq } : {},
        }, { surfaceOp: 'append' })
      }
    }
    this.requestSurfaceGeneration = surfaceGeneration

    const contextWindow = preparedCall?.context?.contextWindow
    const systemPromptUpdate = preparedCall?.systemPromptUpdate
    const requestContext: RequestContext = {
      provider: config.provider,
      model: config.model,
      ...contextWindow === undefined ? {} : { contextWindow },
      ...systemPromptUpdate === undefined ? {} : { systemPromptUpdate },
    }
    const previousContext = session.requestContext()
    if (previousContext?.provider !== requestContext.provider
      || previousContext.model !== requestContext.model
      || previousContext.contextWindow !== requestContext.contextWindow
      || previousContext.systemPromptUpdate !== requestContext.systemPromptUpdate) {
      session.append('request/context', requestContext)
    }
    signal.throwIfAborted()

    // canonicalHeader is shallow; append logs a detached snapshot, not these local values.
    deepFreeze(header)
    const boundaryMessages = session.deriveMessages()
    for (const message of boundaryMessages) {
      if (this.frozenMessages.has(message)) continue
      deepFreeze(message)
      this.frozenMessages.add(message)
    }
    Object.freeze(boundaryMessages)
    const request = markAgentLoopRequest(Object.freeze({
      ...header.config,
      messages: boundaryMessages,
      toolHistory: session.toolHistory(),
      ...header.tools !== undefined ? { tools: header.tools } : {},
      sessionId: this.session.id,
      signal,
    }))
    return request
  }
}
