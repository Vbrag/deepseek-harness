/** One-shot, Session-recorded enhancement of a user-submitted prompt. */
import { createHash } from 'node:crypto'
import { Context, Service, type Volatile } from '@deepseek-ai/cordis'
import { isVolatile } from '@deepseek-ai/cosmokit'
import z from '@deepseek-ai/schemastery'
import { agentCarrier, type Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-instructions/discovery'
import type {} from '@deepseek-ai/dsh-compaction'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-settings'
import { BlockAssembler, createUserMessage, HarnessError, LlmError } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, Message, TokenUsage } from '@deepseek-ai/dsh-llm'
import { estimateRequestInputTokens } from '@deepseek-ai/dsh-llm/input-estimate'
import { KNOWN_SESSION_EVENT_TYPES, type Session } from '@deepseek-ai/dsh-session'
import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import { deadline, MAX_TIMER_DELAY_MS, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { principalOf, Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import { containsCredential, ENHANCEMENT_SYSTEM, enhancementInput, instructionSections, retainsLiterals, selectContext } from './input.ts'
import type { ContextCandidate } from './input.ts'
import { promptEnhancementProjection } from './projection.ts'
import type { PromptEnhancementState } from './projection.ts'
import type {
  PromptEnhancementCatalog, PromptEnhancementConsentRequest, PromptEnhancementPreferenceUpdate, PromptEnhancementPreferences, PromptEnhancementPreflight,
  PromptEnhancementPreflightRequest, PromptEnhancementRemoteRequest, PromptEnhancementRequest,
  PromptEnhancementResult, PromptEnhancementResultEvent, PromptEnhancementSaveResult,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Bounded, durable one-shot prompt rewriting. */
    promptEnhancement: PromptEnhancement
  }
}

/** Limits applied to the complete auxiliary request. */
export interface Config {
  readonly maxInputBytes?: number
  readonly maxContextBytes?: number
  readonly maxOutputTokens?: number
  readonly maxStreamBytes?: number
  readonly timeoutMs?: number
  readonly enabled?: boolean | Volatile<boolean>
  readonly mode?: 'automatic' | 'review' | Volatile<'automatic' | 'review'>
  readonly provider?: string | Volatile<string>
  readonly model?: string | Volatile<string>
  readonly approvedEgress?: readonly string[] | Volatile<readonly string[]>
}

interface ResolvedConfig {
  readonly maxInputBytes: number
  readonly maxContextBytes: number
  readonly maxOutputTokens: number
  readonly maxStreamBytes: number
  readonly timeoutMs: number
}

function current<T>(value: T | Volatile<T> | undefined, fallback: T): T {
  return value === undefined ? fallback : isVolatile(value) ? value.get() : value
}

/** Remove an abort listener when either the iterator or cancellation settles. */
function nextChunk<T>(iterator: AsyncIterator<T>, signal: AbortSignal): Promise<IteratorResult<T>> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = (): void => { const reason: unknown = signal.reason; signal.removeEventListener('abort', abort); reject(reason) }
    signal.addEventListener('abort', abort, { once: true })
    let pending: Promise<IteratorResult<T>>
    try { pending = iterator.next() } catch (error) { signal.removeEventListener('abort', abort); reject(error); return }
    void pending.then(
      value => { signal.removeEventListener('abort', abort); resolve(value) },
      error => { signal.removeEventListener('abort', abort); reject(error) },
    )
    if (signal.aborted) abort()
  })
}

function waitFor<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = (): void => { const reason: unknown = signal.reason; signal.removeEventListener('abort', abort); reject(reason) }
    signal.addEventListener('abort', abort, { once: true })
    void work.then(
      value => { signal.removeEventListener('abort', abort); resolve(value) },
      error => { signal.removeEventListener('abort', abort); reject(error) },
    )
    if (signal.aborted) abort()
  })
}

function identity(request: PromptEnhancementRequest): string {
  return createHash('sha256').update(JSON.stringify([
    request.original, request.displayOriginal, request.attachments, request.provider, request.model, request.expectedEgress,
  ])).digest('hex')
}

function priorResult(entry: PromptEnhancementState['entries'][string]): PromptEnhancementResult {
  switch (entry.status) {
    case 'pending': return { status: 'interrupted' }
    case 'enhanced': return entry.enhanced === undefined
      ? { status: 'failed', code: 'PROMPT_ENHANCEMENT_INVALID_RECORD' }
      : { status: 'enhanced', text: entry.enhanced }
    case 'failed': return { status: 'failed', code: entry.code ?? 'PROMPT_ENHANCEMENT_FAILED' }
    case 'cancelled': return { status: 'cancelled' }
  }
}

function historyCandidates(messages: readonly Message[]): ContextCandidate[] {
  return messages.flatMap((message) => {
    if (message.role !== 'user' && message.role !== 'assistant') return []
    if (message.role === 'user' && message.source.kind !== 'user') return []
    const text = message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
    if (text.trim() === '') return []
    return [{ source: message.role, text: text.slice(0, 4096) }]
  }).slice(-12).reverse()
}

/** Session-owned enhancement service; it does not create or wake an Agent. */
export class PromptEnhancement extends Service {
  static inject = ['llm', 'sessions', 'sessionProjections']
  static Config = z.object({
    maxInputBytes: z.number().step(1).min(1).default(65_536),
    maxContextBytes: z.number().step(1).min(0).default(32_768),
    maxOutputTokens: z.number().step(1).min(1).default(4096),
    maxStreamBytes: z.number().step(1).min(1).default(262_144),
    timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(30_000),
    enabled: z.boolean().default(false).volatile(),
    mode: z.union(['automatic', 'review']).default('automatic').volatile(),
    provider: z.string().default('').volatile(),
    model: z.string().default('').volatile(),
    approvedEgress: z.array(z.string()).default([]).volatile(),
  })

  private readonly config: ResolvedConfig
  private readonly preferences: Config
  private readonly settingsNs: string
  private projection!: ProjectionHandle<PromptEnhancementState>
  private readonly active = new WeakMap<Session, Map<string, { key: string; operation: Promise<PromptEnhancementResult> }>>()
  private readonly pending = new Set<Promise<PromptEnhancementResult>>()
  private readonly lifetime = new AbortController()

  /** @param ctx - Services for model calls and durable Sessions. @param config - Request limits. */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'promptEnhancement')
    this.preferences = config
    this.settingsNs = ctx.fiber.entry?.options.id ?? 'prompt-enhancement'
    ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
    this.config = {
      maxInputBytes: config.maxInputBytes ?? 65_536,
      maxContextBytes: config.maxContextBytes ?? 32_768,
      maxOutputTokens: config.maxOutputTokens ?? 4096,
      maxStreamBytes: config.maxStreamBytes ?? 262_144,
      timeoutMs: config.timeoutMs ?? 30_000,
    }
    for (const [name, value, minimum] of [
      ['maxInputBytes', this.config.maxInputBytes, 1], ['maxContextBytes', this.config.maxContextBytes, 0],
      ['maxOutputTokens', this.config.maxOutputTokens, 1], ['timeoutMs', this.config.timeoutMs, 1],
      ['maxStreamBytes', this.config.maxStreamBytes, 1],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < minimum || (name === 'timeoutMs' && value > MAX_TIMER_DELAY_MS)) {
        throw new HarnessError(`${name} is invalid.`, 'PROMPT_ENHANCEMENT_INVALID_CONFIG')
      }
    }
  }

  protected async [Service.init](): Promise<void> {
    this.projection = await this.ctx.sessionProjections.register(promptEnhancementProjection)
    this.ctx.fiber.assertActive()
    this.ctx.effect(() => async () => {
      this.lifetime.abort(new DOMException('Prompt enhancement unloaded', 'AbortError'))
      await Promise.allSettled([...this.pending])
    }, 'prompt-enhancement: cancel and join requests')
    this.ctx.on('agent/inbox/inserted', ({ agent, message }) => {
      const source = message.source
      if (source.kind !== 'user' || !('rpcId' in source)) return
      const entry = this.projection.stateOf(agent.session).entries[source.rpcId]
      if (entry?.status !== 'enhanced' || entry.submitted === true) return
      const text = message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
      agent.session.append('prompt-enhancement/accepted', { id: source.rpcId, text })
    })
    this.ctx.plugin(PromptEnhancementRemote)
  }

  /** Read effective user preferences. @returns Current settings and their revision. */
  readPreferences(): PromptEnhancementPreferences {
    return {
      enabled: current(this.preferences.enabled, false),
      mode: current(this.preferences.mode, 'automatic'),
      provider: current(this.preferences.provider, ''), model: current(this.preferences.model, ''),
      revision: this.ctx.get('settings')?.describe().find(item => item.ns === this.settingsNs)?.revision ?? null,
    }
  }

  /** Read the active profile entry identity. @returns Settings namespace. */
  settingsNamespace(): string { return this.settingsNs }

  /** Read the current provider approvals. @returns Detached endpoint identities. */
  approvedEgress(): readonly string[] {
    return [...current(this.preferences.approvedEgress, [])]
  }

  /** Read the operation deadline. @returns Timeout in milliseconds. */
  requestTimeout(): number { return this.config.timeoutMs }

  /** Check whether this build can reopen Sessions containing the new records. @returns Catalog readiness. */
  catalogReady(): boolean {
    return ['prompt-enhancement/request', 'prompt-enhancement/result', 'prompt-enhancement/accepted']
      .every(type => KNOWN_SESSION_EVENT_TYPES.has(type))
  }

  /** Prepare one submission once, reusing durable outcomes on replay.
   * @param agent - Main Agent whose Session and scope own the request.
   * @param request - Immutable prompt, attachment references, and selected route.
   * @param signal - Caller cancellation.
   * @returns The enhancement, an actionable failure code, cancellation, or an interrupted attempt.
   */
  async enhance(agent: Agent, request: PromptEnhancementRequest, signal: AbortSignal): Promise<PromptEnhancementResult> {
    if (agent.id !== request.sessionId || agent.session.header.origin === 'subagent'
      || (agent.session.header.delegationDepth ?? 0) > 0) {
      return { status: 'failed', code: 'PROMPT_ENHANCEMENT_INVALID_SESSION' }
    }
    if (!this.catalogReady()) {
      return { status: 'failed', code: 'PROMPT_ENHANCEMENT_CATALOG_STALE' }
    }
    const key = identity(request)
    const session = agent.session
    const existing = this.projection.stateOf(session).entries[request.id]
    if (existing !== undefined) {
      if (existing.requestKey !== key) return { status: 'failed', code: 'PROMPT_ENHANCEMENT_ID_CONFLICT' }
      return this.active.get(session)?.get(request.id)?.operation ?? priorResult(existing)
    }
    let operations = this.active.get(session)
    if (operations === undefined) { operations = new Map(); this.active.set(session, operations) }
    const running = operations.get(request.id)
    if (running !== undefined) return running.key === key
      ? running.operation : { status: 'failed', code: 'PROMPT_ENHANCEMENT_ID_CONFLICT' }
    const operation = this.execute(agent, request, key, AbortSignal.any([signal, this.lifetime.signal]))
    operations.set(request.id, { key, operation })
    this.pending.add(operation)
    try { return await operation } finally { operations.delete(request.id); this.pending.delete(operation) }
  }

  private async execute(agent: Agent, request: PromptEnhancementRequest, key: string,
    signal: AbortSignal): Promise<PromptEnhancementResult> {
    const started = Date.now()
    let usage: TokenUsage | undefined
    let dispatched = false
    let billing: LlmResolvedModelInfo['billing']
    using timer = deadline(signal, this.config.timeoutMs, 'PROMPT_ENHANCEMENT_TIMEOUT')
    try {
      timer.signal.throwIfAborted()
      if (Buffer.byteLength(request.original, 'utf8') > this.config.maxInputBytes
        || Buffer.byteLength(request.displayOriginal, 'utf8') > this.config.maxInputBytes
        || Buffer.byteLength(JSON.stringify(request.attachments), 'utf8') > this.config.maxInputBytes) {
        return { status: 'failed', code: 'PROMPT_ENHANCEMENT_TOO_LARGE' }
      }
      if (request.original.trim() === '' || containsCredential(request.original) || containsCredential(request.displayOriginal)
        || request.attachments.some(containsCredential)) {
        return { status: 'failed', code: 'PROMPT_ENHANCEMENT_SENSITIVE_OR_EMPTY' }
      }
      const preview = await waitFor(Promise.resolve(this.ctx.bail(agentCarrier(agent), 'agent-instructions/preview',
        { agent, signal: timer.signal })), timer.signal)
      const candidates = [...instructionSections(preview ?? ''), ...historyCandidates(agent.session.deriveMessages())]
      const selected = selectContext(request.original, candidates, this.config.maxContextBytes)
      const prepared = await waitFor(this.ctx.llm.prepareCall({ provider: request.provider, model: request.model }, timer.signal,
        (controls, model) => {
          const reasoningOff = model.reasoning?.efforts.find(effort => effort.id === 'off')
          return {
            ...controls,
            maxTokens: Math.min(this.config.maxOutputTokens, model.maxOutputTokens ?? this.config.maxOutputTokens),
            ...reasoningOff === undefined ? {} : { reasoningEffort: reasoningOff.id },
          }
        }), timer.signal)
      billing = prepared.billing
      if (request.expectedEgress !== (prepared.egressId ?? null)) {
        throw new HarnessError('The selected provider changed before dispatch.', 'PROMPT_ENHANCEMENT_PROVIDER_CHANGED')
      }
      if (!this.ctx.llm.billingHealth.available(prepared.billing)) {
        throw new HarnessError('The selected model billing budget is unavailable.', 'PROMPT_ENHANCEMENT_BILLING_UNAVAILABLE')
      }
      if (prepared.inputModalities !== undefined && !prepared.inputModalities.includes('text')) {
        throw new HarnessError('The selected model does not accept text.', 'PROMPT_ENHANCEMENT_UNSUPPORTED_MODEL')
      }
      const maxTokens = prepared.config.maxTokens
      if (maxTokens === undefined) throw new HarnessError('The output limit is unavailable.', 'PROMPT_ENHANCEMENT_INVALID_BUDGET')
      let options: GenerateOptions
      let messages: Message[]
      const streamAbort = new AbortController()
      while (true) {
        const input = enhancementInput(request.original, selected, request.attachments)
        messages = [createUserMessage({ content: [{ type: 'text', text: input }], source: { kind: 'user' } })]
        options = { ...prepared.config, system: ENHANCEMENT_SYSTEM, messages, sessionId: agent.session.id,
          purpose: 'prompt-enhancement', signal: AbortSignal.any([timer.signal, streamAbort.signal]) }
        const bytes = Buffer.byteLength(JSON.stringify({ system: options.system, messages }), 'utf8')
        const estimated = estimateRequestInputTokens(messages, options.system) + maxTokens
        const budget = prepared.requestTokenBudget(options)
        const threshold = budget === undefined ? undefined : this.ctx.get('compaction')?.tpmThreshold(prepared.config, budget.tokenLimit)
        const fits = bytes <= this.config.maxInputBytes
          && (prepared.context === undefined || estimated <= prepared.context.contextWindow)
          && (budget === undefined || budget.estimatedTokens <= budget.tokenLimit)
          && (threshold === undefined || budget === undefined || budget.estimatedTokens < threshold)
        if (fits) break
        if (selected.pop() === undefined) throw new HarnessError('The prompt exceeds the enhancement model budget.', 'PROMPT_ENHANCEMENT_TOO_LARGE')
      }
      timer.signal.throwIfAborted()
      deepFreeze(options)
      agent.session.append('prompt-enhancement/request', {
        id: request.id, requestKey: key, original: request.original, displayOriginal: request.displayOriginal,
        provider: request.provider, model: request.model, system: ENHANCEMENT_SYSTEM,
        messages, maxTokens, purpose: 'prompt-enhancement',
        ...prepared.egressId === undefined ? {} : { egressId: prepared.egressId },
        ...prepared.config.reasoningEffort === undefined ? {} : { reasoningEffort: prepared.config.reasoningEffort },
        ...prepared.config.temperature === undefined ? {} : { temperature: prepared.config.temperature },
        ...prepared.config.stop === undefined ? {} : { stop: prepared.config.stop },
      })
      if (!await this.ctx.sessions.flush(agent.session)) {
        throw new HarnessError('The enhancement request could not be saved.', 'PROMPT_ENHANCEMENT_DURABILITY_REQUIRED')
      }
      timer.signal.throwIfAborted()
      if (!this.ctx.llm.billingHealth.available(prepared.billing)) {
        throw new HarnessError('The selected model billing budget is unavailable.', 'PROMPT_ENHANCEMENT_BILLING_UNAVAILABLE')
      }
      const assembler = new BlockAssembler()
      const iterator = prepared.stream(options)[Symbol.asyncIterator]()
      dispatched = true
      let complete = false
      let sawFinish = false
      let streamBytes = 0
      try {
        while (true) {
          const next = await nextChunk(iterator, timer.signal)
          if (next.done) { complete = true; break }
          streamBytes += Buffer.byteLength(JSON.stringify(next.value), 'utf8')
          if (streamBytes > this.config.maxStreamBytes) {
            throw new HarnessError('The enhancement response exceeded its stream limit.', 'PROMPT_ENHANCEMENT_INVALID_OUTPUT')
          }
          if (next.value.type === 'finish') sawFinish = true
          assembler.push(next.value)
        }
      } finally {
        if (!complete) {
          streamAbort.abort()
          void iterator.return?.().catch((error: unknown) => {
            void error
            this.ctx.logger.warn('prompt-enhancement: the provider stream did not close cleanly')
          })
        }
      }
      usage = assembler.usage
      const finish = assembler.finish
      if (finish.kind === 'error' || finish.kind === 'aborted') throw LlmError.fromFailure(finish.failure)
      const blocks = assembler.blocks()
      if (!sawFinish || finish.kind !== 'stop' || blocks.some(block => block.type !== 'text')) {
        throw new HarnessError('The model did not return a complete text prompt.', 'PROMPT_ENHANCEMENT_INVALID_OUTPUT')
      }
      const enhanced = blocks.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
      if (!retainsLiterals(request.original, enhanced) || Buffer.byteLength(enhanced, 'utf8') > this.config.maxInputBytes) {
        throw new HarnessError('The rewritten prompt failed validation.', 'PROMPT_ENHANCEMENT_INVALID_OUTPUT')
      }
      await this.record(agent.session, { id: request.id, requestKey: key, original: request.original,
        displayOriginal: request.displayOriginal,
        status: 'enhanced', enhanced, elapsedMs: Date.now() - started, ...usage === undefined ? {} : { usage } })
      timer.signal.throwIfAborted()
      return { status: 'enhanced', text: enhanced }
    } catch (error: unknown) {
      const cancelled = signal.aborted
      const code = timeoutOf(timer.signal, 'PROMPT_ENHANCEMENT_TIMEOUT') !== undefined
        ? 'PROMPT_ENHANCEMENT_TIMEOUT' : error instanceof HarnessError ? error.code : 'PROMPT_ENHANCEMENT_FAILED'
      if (dispatched && ['QUOTA', 'ACCOUNT_QUOTA', 'BILLING_EXHAUSTED'].includes(code)) {
        const observation = this.ctx.llm.billingHealth.begin()
        try { observation.record(billing) } finally { observation.dispose() }
      }
      try {
        await this.record(agent.session, { id: request.id, requestKey: key, original: request.original,
          displayOriginal: request.displayOriginal,
          status: cancelled ? 'cancelled' : 'failed', ...(cancelled ? {} : { code }),
          elapsedMs: Date.now() - started, ...usage === undefined ? {} : { usage } })
      } catch (recordError: unknown) {
        void recordError
        this.ctx.logger.warn('prompt-enhancement: the result could not be saved')
      }
      return cancelled ? { status: 'cancelled' } : { status: 'failed', code }
    }
  }

  private async record(session: Session, event: PromptEnhancementResultEvent): Promise<void> {
    session.append('prompt-enhancement/result', event)
    if (!await this.ctx.sessions.flush(session)) {
      throw new HarnessError('The enhancement result could not be saved.', 'PROMPT_ENHANCEMENT_DURABILITY_REQUIRED')
    }
  }
}

/** Session-authorized transport for enhancement settings and requests. */
export class PromptEnhancementRemote extends TypertRemoteService {
  static inject = ['promptEnhancement', 'sessionController', 'llm', 'settings']
  private readonly oneTime = new WeakMap<Session, { id: string; provider: string; model: string }>()

  /** @param ctx - Active settings, Session, and enhancement services. */
  constructor(ctx: Context) {
    super(ctx, 'promptEnhancementRemote', { namespace: 'promptEnhancement' })
  }

  private requireOwner(): void {
    if (principalOf(this.ctx.invocation) !== undefined) {
      throw new RemoteError('prompt-enhancement/owner-required', 'Prompt enhancement is available to the owner only.', {})
    }
  }

  /** Read the effective settings. @returns Current preferences. */
  @Remote('preferences')
  preferences(): PromptEnhancementPreferences {
    this.requireOwner()
    return this.ctx.promptEnhancement.readPreferences()
  }

  /** List currently registered provider models. @returns Available routes. */
  @Remote('catalog')
  async catalog(): Promise<PromptEnhancementCatalog> {
    this.requireOwner()
    const groups = await Promise.all(this.ctx.llm.listProviders().map(async (provider) => {
      try {
        const models = await this.ctx.llm.listModels(provider.id)
        return { provider: provider.id, name: provider.name,
          models: models.map(model => ({ id: model.id, name: model.name })) }
      } catch {
        return { provider: provider.id, name: provider.name, models: [] }
      }
    }))
    return groups.filter(group => group.models.length > 0)
  }

  /** Save user preferences against the active profile revision.
   * @param preferences - New settings; an empty route uses the Session model.
   * @param revision - Revision returned by preferences.
   * @returns Saved, stale, or failed.
   */
  @Remote('savePreferences')
  async savePreferences(preferences: PromptEnhancementPreferenceUpdate, revision: number): Promise<PromptEnhancementSaveResult> {
    this.requireOwner()
    if ((preferences.provider === '') !== (preferences.model === '')) return { status: 'failed' }
    if (preferences.provider !== '') {
      try {
        const models = await this.ctx.llm.listModels(preferences.provider)
        if (!models.some(model => model.id === preferences.model)) return { status: 'failed' }
      } catch { return { status: 'failed' } }
    }
    try {
      await this.ctx.settings.update(this.ctx.promptEnhancement.settingsNamespace(), preferences, revision)
      const next = this.preferences()
      if (next.enabled !== preferences.enabled || next.mode !== preferences.mode
        || next.provider !== preferences.provider || next.model !== preferences.model) return { status: 'failed' }
      return { status: 'saved', preferences: next }
    } catch (error: unknown) {
      return { status: error instanceof Error && 'code' in error && error.code === 'SETTINGS_CONFLICT' ? 'stale' : 'failed' }
    }
  }

  /** Inspect the selected route and whether it requires consent.
   * @param request - Session and submission identity.
   * @param signal - Request cancellation.
   * @returns The route, consent requirement, or a failure.
   */
  @Remote({ name: 'preflight', resources: { session: request => request.sessionId } })
  async preflight(request: PromptEnhancementPreflightRequest, signal: AbortSignal): Promise<PromptEnhancementPreflight> {
    this.requireOwner()
    signal.throwIfAborted()
    if (request.id.length === 0) return { status: 'failed', code: 'PROMPT_ENHANCEMENT_INVALID_REQUEST' }
    const preferences = this.preferences()
    if (!preferences.enabled) return { status: 'disabled' }
    if (!this.ctx.promptEnhancement.catalogReady()) return { status: 'failed', code: 'PROMPT_ENHANCEMENT_CATALOG_STALE' }
    using timer = deadline(signal, this.ctx.promptEnhancement.requestTimeout(), 'PROMPT_ENHANCEMENT_TIMEOUT')
    try {
      const resolved = await waitFor(this.ctx.sessionController.resolveAgent(request.sessionId), timer.signal)
      if ('error' in resolved) return { status: 'failed', code: 'PROMPT_ENHANCEMENT_SESSION_UNAVAILABLE' }
      const agent = resolved.agent
      if (agent.session.header.origin === 'subagent' || (agent.session.header.delegationDepth ?? 0) > 0) {
        return { status: 'failed', code: 'PROMPT_ENHANCEMENT_INVALID_SESSION' }
      }
      const selected = agent.model.current()
      if (selected === undefined) return { status: 'failed', code: 'PROMPT_ENHANCEMENT_MODEL_UNAVAILABLE' }
      const provider = preferences.provider || selected.provider
      const model = preferences.model || selected.model
      if (!this.ctx.llm.listProviders().some(item => item.id === provider)
        || !(await waitFor(this.ctx.llm.listModels(provider), timer.signal)).some(item => item.id === model)) {
        return { status: 'failed', code: 'PROMPT_ENHANCEMENT_MODEL_UNAVAILABLE' }
      }
      const info = await waitFor(this.ctx.llm.resolveModelInfo(provider, model, timer.signal), timer.signal)
      const sameModel = provider === selected.provider && model === selected.model
      const main = sameModel ? info : await waitFor(this.ctx.llm.resolveModelInfo(selected.provider, selected.model, timer.signal), timer.signal)
      const sameEndpoint = provider === selected.provider && info.egressId !== undefined && info.egressId === main.egressId
      const consentNeeded = !sameModel && !sameEndpoint
      const once = this.oneTime.get(agent.session)
      const approvedOnce = once?.id === request.id && once.provider === provider && once.model === model
      const approved = info.egressId !== undefined && this.ctx.promptEnhancement.approvedEgress().includes(info.egressId)
      return { status: consentNeeded && !approved && !approvedOnce ? 'consent-required' : 'ready',
        provider, model, mode: preferences.mode, ...info.egressId === undefined ? {} : { egressId: info.egressId },
        ...info.egressLabel === undefined ? {} : { egressLabel: info.egressLabel } }
    } catch (_error: unknown) {
      signal.throwIfAborted()
      if (timeoutOf(timer.signal, 'PROMPT_ENHANCEMENT_TIMEOUT') !== undefined) {
        return { status: 'failed', code: 'PROMPT_ENHANCEMENT_TIMEOUT' }
      }
      this.ctx.logger.warn('prompt-enhancement: model preflight failed')
      return { status: 'failed', code: 'PROMPT_ENHANCEMENT_MODEL_UNAVAILABLE' }
    }
  }

  /** Record the user's consent to the route returned by preflight.
   * @param request - Session, submission, and the exact route shown to the user.
   * @param signal - Request cancellation.
   * @returns Whether the consent remains effective.
   */
  @Remote({ name: 'confirmProvider', resources: { session: request => request.sessionId } })
  async confirmProvider(request: PromptEnhancementConsentRequest, signal: AbortSignal): Promise<boolean> {
    this.requireOwner()
    const plan = await this.preflight(request, signal)
    if ((plan.status !== 'ready' && plan.status !== 'consent-required') || plan.provider !== request.provider
      || plan.model !== request.model || plan.egressId !== request.egressId) return false
    if (plan.status === 'ready') return true
    using timer = deadline(signal, this.ctx.promptEnhancement.requestTimeout(), 'PROMPT_ENHANCEMENT_TIMEOUT')
    try {
      const resolved = await waitFor(this.ctx.sessionController.resolveAgent(request.sessionId), timer.signal)
      if ('error' in resolved) return false
      if (plan.egressId === undefined) {
        this.oneTime.set(resolved.agent.session, { id: request.id, provider: plan.provider, model: plan.model })
        return true
      }
      const preferences = this.preferences()
      if (preferences.revision === null) return false
      const approvedEgress = [...new Set([...this.ctx.promptEnhancement.approvedEgress(), plan.egressId])]
      await waitFor(this.ctx.settings.update(this.ctx.promptEnhancement.settingsNamespace(), { approvedEgress }, preferences.revision), timer.signal)
      return this.ctx.promptEnhancement.approvedEgress().includes(plan.egressId)
    } catch {
      signal.throwIfAborted()
      return false
    }
  }

  /** Remove all saved provider approvals. @returns Whether the active settings were updated. */
  @Remote('clearProviderApprovals')
  async clearProviderApprovals(): Promise<boolean> {
    this.requireOwner()
    const preferences = this.preferences()
    if (preferences.revision === null) return false
    try {
      await this.ctx.settings.update(this.ctx.promptEnhancement.settingsNamespace(), { approvedEgress: [] }, preferences.revision)
      return this.ctx.promptEnhancement.approvedEgress().length === 0
    } catch { return false }
  }

  /** Permit retries after the owner has corrected an exhausted account. */
  @Remote('resetBillingHealth')
  resetBillingHealth(): void {
    this.requireOwner()
    this.ctx.llm.billingHealth.reset()
  }

  /** Enhance one prompt after checking Session access and provider consent.
   * @param request - Session, submission, prompt, and attachment references.
   * @param signal - Caller cancellation.
   * @returns Enhancement settlement.
   */
  @Remote({ name: 'prepare', resources: { session: request => request.sessionId } })
  async prepare(request: PromptEnhancementRemoteRequest, signal: AbortSignal): Promise<PromptEnhancementResult> {
    this.requireOwner()
    const plan = await this.preflight(request, signal)
    if (plan.status !== 'ready') return { status: 'failed', code: plan.status === 'consent-required'
      ? 'PROMPT_ENHANCEMENT_CONSENT_REQUIRED' : 'PROMPT_ENHANCEMENT_UNAVAILABLE' }
    if (plan.provider !== request.provider || plan.model !== request.model || plan.mode !== request.mode
      || (plan.egressId ?? null) !== request.expectedEgress) {
      return { status: 'failed', code: 'PROMPT_ENHANCEMENT_PROVIDER_CHANGED' }
    }
    let agent: Agent
    {
      using timer = deadline(signal, this.ctx.promptEnhancement.requestTimeout(), 'PROMPT_ENHANCEMENT_TIMEOUT')
      try {
        const resolved = await waitFor(this.ctx.sessionController.resolveAgent(request.sessionId), timer.signal)
        if ('error' in resolved) return { status: 'failed', code: 'PROMPT_ENHANCEMENT_SESSION_UNAVAILABLE' }
        agent = resolved.agent
      } catch (error) {
        signal.throwIfAborted()
        if (timeoutOf(timer.signal, 'PROMPT_ENHANCEMENT_TIMEOUT') !== undefined) {
          return { status: 'failed', code: 'PROMPT_ENHANCEMENT_TIMEOUT' }
        }
        throw error
      }
    }
    this.oneTime.delete(agent.session)
    return this.ctx.promptEnhancement.enhance(agent, request, signal)
  }
}

export default PromptEnhancement
