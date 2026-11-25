/** Session-scoped task routing for normal fresh local subagent delegations. */
import { Context, Service, type Volatile } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { isVolatile } from '@deepseek-ai/cosmokit'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { brandString } from '@deepseek-ai/dsh-brand'
import { principalOf, Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-compaction'
import { estimateRequestInputTokens } from '@deepseek-ai/dsh-llm/input-estimate'
import { pluginRecordOf, type Session, type SessionId } from '@deepseek-ai/dsh-session'
import type { CommandDefinitionId, CommandId } from '@deepseek-ai/dsh-commands/types'
import type {} from '@deepseek-ai/dsh-commands'
import type { ProjectionDefinition, ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import type { SubagentModelRouting, SubagentModelRoutingContext, SubagentTaskAssessment } from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-subagent/model-selection-policy'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { capabilityRoute, routeExclusions, selectReadyRoute } from './plan.ts'
import type { CapabilityRoute, ReadyRoute } from './plan.ts'
import { OrchestrationError } from './error.ts'
import { AdaptiveRouting, type AdaptiveAdmission } from './adaptive.ts'
import { capabilityOf, POOL_PROVIDER, TASK_DOMAINS } from './capabilities.ts'
import type { LlmModelInfo, LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type {
  OrchestrationCatalog, OrchestrationCatalogGroup, OrchestrationCatalogModel,
  OrchestrationConfig, OrchestrationProjection, OrchestrationRouteAlternative, OrchestrationUnitState, PoolRoute,
  PoolSettingsState, PoolSaveResult, PoolConfiguration, PoolConfigurationSaveResult, RouteCapabilities,
  OrchestrationActivationPreflight, OrchestrationActivationResult, OrchestrationReviewId,
  OrchestrationPoolActivationResult, PoolMembership, PoolMembershipId,
} from './types.ts'

export type * from './types.ts'
export { OrchestrationError, type OrchestrationErrorCode } from './error.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Session mode, pool settings, and normal-delegation routing policy. */
    orchestrations: OrchestrationService
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Applied orchestration mode; the last selection wins. */
    'orchestration/mode': { active: boolean }
  }
}

const commandIdSchema: ZodType<CommandId> = zod.string().transform(value => brandString<CommandId>(value))
const modeRequestSchema = zod.object({ active: zod.boolean() }).strict()
const membershipSchema: ZodType<PoolMembership> = zod.object({
  provider: zod.string().min(1), model: zod.string().min(1),
  membershipId: zod.string().min(1).transform(value => brandString<PoolMembershipId>(value)),
}).strict()
const poolSnapshotSchema = zod.object({ pending: zod.boolean(), members: zod.array(membershipSchema) }).strict()
const stateSchema: ZodType<OrchestrationUnitState> = zod.object({
  active: zod.boolean(),
  wanted: zod.boolean().nullable(),
  running: zod.object({ commandId: commandIdSchema, wanted: zod.boolean() }).strict().nullable(),
  entered: zod.boolean(),
  activePool: zod.array(membershipSchema).nullable(),
  wantedPool: zod.array(membershipSchema).nullable(),
}).strict()
const viewSchema: ZodType<OrchestrationProjection> = zod.object({
  active: zod.boolean(), pending: zod.boolean(), requiresReactivation: zod.boolean().optional(),
})

/** Restores pending selections without retaining process-local Session state. */
const orchestrationProjectionDefinition = {
  key: 'orchestration',
  stateVersion: 4,
  stateSchema,
  init: (): OrchestrationUnitState => ({ active: false, wanted: null, running: null, entered: false,
    activePool: null, wantedPool: null }),
  apply: (state: OrchestrationUnitState, event) => {
    if (event.type === 'orchestration/mode') {
      return { ...state, active: event.data.active, wanted: null, running: null, entered: true,
        activePool: null, wantedPool: null }
    }
    if (event.type === 'orchestration/pool-snapshot') {
      const value = poolSnapshotSchema.safeParse(event.data)
      if (!value.success || new Set(value.data.members.map(routeKey)).size !== value.data.members.length
        || new Set(value.data.members.map(member => member.membershipId)).size !== value.data.members.length) {
        throw new OrchestrationError('stored orchestration pool snapshot is invalid', 'ORCHESTRATION_INVALID_RECORD')
      }
      if (value.data.pending) return { ...state, wanted: true, wantedPool: value.data.members, running: null }
      return { ...state, active: true, activePool: value.data.members, wanted: null, wantedPool: null,
        running: null, entered: true }
    }
    const record = pluginRecordOf(event)
    if (event.type === 'orchestration/mode-request' || record?.type === 'plugin:orchestration/mode-request') {
      const value = modeRequestSchema.safeParse(event.type === 'orchestration/mode-request' ? event.data : record?.data)
      if (!value.success) {
        throw new OrchestrationError('stored orchestration mode selection is invalid', 'ORCHESTRATION_INVALID_RECORD')
      }
      return { ...state, wanted: value.data.active === state.active ? null : value.data.active,
        wantedPool: null, running: null }
    }
    // Historical logs represent queued mode changes through command settlement.
    if (event.type === 'command/run' && event.data.name === 'orchestration') {
      if (event.data.args === undefined || !['', 'on', 'off'].includes(event.data.args.trim())) return state
      return { ...state, running: { commandId: event.data.commandId, wanted: event.data.args.trim() !== 'off' } }
    }
    if (event.type === 'command/done' && event.data.commandId === state.running?.commandId) {
      const wanted = event.data.kind === 'success' && state.running.wanted !== state.active ? state.running.wanted : state.wanted
      return { ...state, wanted, running: null }
    }
    return state
  },
  wire: {
    viewSchema,
    view: (state: OrchestrationUnitState) => ({
      active: state.active,
      pending: (state.running?.wanted ?? state.wanted) !== null
        && (state.running?.wanted ?? state.wanted) !== state.active,
      ...(state.active && state.activePool === null ? { requiresReactivation: true } : {}),
    }),
  },
} satisfies ProjectionDefinition<'orchestration', OrchestrationUnitState>

const routeSchema = z.object({ provider: z.string(), model: z.string() })
const specialtySchema = z.union([...TASK_DOMAINS])

/** Generic delegation labels are interpreted by the selected policy, which rejects unsupported requirements. */
function validateAssessment(assessment: SubagentTaskAssessment): void {
  const specialties: readonly string[] = TASK_DOMAINS
  const unknown = [...assessment.requiredCapabilities, ...assessment.preferredCapabilities ?? []]
    .filter(item => !specialties.includes(item))
  if (unknown.length > 0) {
    throw new OrchestrationError('task_assessment contains unsupported capabilities: ' + unknown.join(', ')
      + '. Use ' + specialties.join(', '), 'ORCHESTRATION_INVALID_ASSESSMENT')
  }
  const modalities = (assessment.requiredModalities ?? []).filter(item => item !== 'text' && item !== 'image')
  if (modalities.length > 0) {
    throw new OrchestrationError('task_assessment.requiredModalities supports only text and image; received '
      + modalities.join(', '), 'ORCHESTRATION_INVALID_ASSESSMENT')
  }
}

/** Collision-free exact route identity for process-owned load counters. */
function routeKey(route: PoolRoute): string {
  return JSON.stringify([route.provider, route.model])
}

/** Profile entry id whose volatile `pool` config persists the orchestration pool.
 * The shipped orchestration profile mounts the plugin under this id, so the stable
 * constant avoids depending on `ctx.fiber` inside Remote handlers where no fiber is active.
 */
const POOL_SETTINGS_NS = 'orchestration'

/** Cancel a queue-availability wait without leaving a timer or listener behind. */
function waitForAvailability(waitMs: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const finish = (): void => { signal.removeEventListener('abort', abort); resolve() }
    const timer = setTimeout(finish, waitMs)
    const abort = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      const reason: unknown = signal.reason
      reject(reason instanceof Error ? reason : new Error('orchestration admission cancelled', { cause: reason }))
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

/** Mode and pool owner; one registered selector serves every normal local delegation. */
export class OrchestrationService extends TypertRemoteService {
  static inject = ['llm', 'subagents', 'sessionProjections', 'agents', 'systemPrompt', 'sessions']

  static Config = z.object({
    pool: z.array(routeSchema).default([]).volatile(),
    // User-selected pool persisted through Settings; takes precedence over the
    // configured `pool` default (which a shipped profile layer may own).
    userPool: z.array(routeSchema).default([]).volatile(),
    userPoolConfigured: z.boolean().default(false).volatile(),
    userPoolMemberships: z.array(z.object({
      provider: z.string(), model: z.string(), membershipId: z.string().min(1),
    })).default([]).volatile(),
    routeCapabilities: z.array(z.object({
      provider: z.string(), model: z.string(), capabilities: z.array(specialtySchema),
    })).default([]),
    userRouteCapabilities: z.array(z.object({
      provider: z.string(), model: z.string(), capabilities: z.array(specialtySchema),
    })).default([]).volatile(),
    contextOverheadTokens: z.number().step(1).min(0).default(8192),
    outputReserveTokens: z.number().step(1).min(1).default(4096),
    availabilityPollMs: z.number().step(1).min(1).default(1000),
    defaultToOrchestrator: z.boolean().default(false),
    recordDisabledDefault: z.boolean().default(true),
    seedPoolAsRootPolicy: z.boolean().default(true),
    maxAutomaticReassignments: z.number().step(1).min(0).default(2),
    maxEmptyOutputLimits: z.number().step(1).min(1).default(2),
  })

  private readonly config: Required<Omit<OrchestrationConfig, 'pool' | 'userPool' | 'userPoolConfigured' | 'userPoolMemberships' | 'userRouteCapabilities'>>
  private readonly poolConfig: Volatile<readonly PoolRoute[]> | readonly PoolRoute[] | undefined
  private readonly userPoolConfig: Volatile<readonly PoolRoute[]> | readonly PoolRoute[] | undefined
  private readonly userPoolConfigured: Volatile<boolean> | boolean | undefined
  private readonly membershipConfig: Volatile<readonly (PoolRoute & { readonly membershipId: string })[]>
    | readonly (PoolRoute & { readonly membershipId: string })[] | undefined
  private readonly userCapabilitiesConfig: Volatile<readonly RouteCapabilities[]> | readonly RouteCapabilities[] | undefined
  private poolValue: readonly PoolRoute[]
  private poolMemberships: readonly PoolMembership[]
  private projection: ProjectionHandle<OrchestrationUnitState> | undefined
  private readonly pendingAssignments = new Map<SessionId, PoolRoute>()
  private readonly lastAssigned = new Map<string, number>()
  private readonly modeGenerations = new WeakMap<Session, number>()
  private readonly activationReviews = new WeakMap<Session, {
    id: OrchestrationReviewId
    pool: readonly PoolRoute[]
    poolRevision: number
    members: readonly PoolMembership[]
    policy: readonly PoolRoute[] | null
    parent: PoolRoute | null
    modeGeneration: number
    additionalRoutes: readonly PoolRoute[]
  }>()
  private sequence = 0
  private adaptive: AdaptiveRouting | undefined

  /** @param ctx - Required policy, LLM, projection, and prompt services.
   * @param config - Pool, verified specialties, and token allowances.
   */
  constructor(ctx: Context, config: OrchestrationConfig = {}) {
    super(ctx, 'orchestrations', { namespace: 'orchestrations' })
    this.poolConfig = config.pool
    this.userPoolConfig = config.userPool
    this.userPoolConfigured = config.userPoolConfigured
    this.membershipConfig = config.userPoolMemberships
    this.userCapabilitiesConfig = config.userRouteCapabilities
    this.poolValue = [...this.effectivePool()]
    const savedMemberships = this.configuredMemberships()
    this.poolMemberships = this.makeMemberships(this.poolValue, this.validMemberships(savedMemberships) ? savedMemberships : [])
    this.config = {
      routeCapabilities: config.routeCapabilities ?? [],
      contextOverheadTokens: config.contextOverheadTokens ?? 8192,
      outputReserveTokens: config.outputReserveTokens ?? 4096,
      availabilityPollMs: config.availabilityPollMs ?? 1000,
      defaultToOrchestrator: config.defaultToOrchestrator ?? false,
      recordDisabledDefault: config.recordDisabledDefault ?? true,
      seedPoolAsRootPolicy: config.seedPoolAsRootPolicy ?? true,
      maxAutomaticReassignments: config.maxAutomaticReassignments ?? 2,
      maxEmptyOutputLimits: config.maxEmptyOutputLimits ?? 2,
    }
    for (const [name, value, minimum] of [
      ['contextOverheadTokens', this.config.contextOverheadTokens, 0],
      ['outputReserveTokens', this.config.outputReserveTokens, 1],
      ['availabilityPollMs', this.config.availabilityPollMs, 1],
      ['maxAutomaticReassignments', this.config.maxAutomaticReassignments, 0],
      ['maxEmptyOutputLimits', this.config.maxEmptyOutputLimits, 1],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < minimum) {
        throw new OrchestrationError(name + ' must be a safe integer at least ' + String(minimum), 'ORCHESTRATION_INVALID_CONFIG')
      }
    }
    const keys = this.config.routeCapabilities.map(routeKey)
    if (new Set(keys).size !== keys.length) {
      throw new OrchestrationError('routeCapabilities must not repeat an exact provider/model', 'ORCHESTRATION_INVALID_CONFIG')
    }
  }

  private configuredMemberships(): readonly PoolMembership[] {
    const source = this.membershipConfig
    const members = source === undefined ? [] : isVolatile(source) ? source.get() : source
    return members.map(member => ({ ...member, membershipId: brandString<PoolMembershipId>(member.membershipId) }))
  }

  private validMemberships(members: readonly PoolMembership[]): boolean {
    return new Set(members.map(routeKey)).size === members.length
      && new Set(members.map(member => member.membershipId)).size === members.length
      && members.every(member => member.provider.length > 0 && member.model.length > 0 && member.membershipId.length > 0)
  }

  private membershipsMatch(pool: readonly PoolRoute[], members: readonly PoolMembership[]): boolean {
    return members.length === pool.length && this.validMemberships(members)
      && members.every(member => pool.some(route => routeKey(route) === routeKey(member)))
  }

  private makeMemberships(pool: readonly PoolRoute[], previous: readonly PoolMembership[]): readonly PoolMembership[] {
    return pool.map(route => ({ ...route, membershipId: previous.find(member => routeKey(member) === routeKey(route))?.membershipId
      ?? brandString<PoolMembershipId>(randomUUID()) }))
  }

  private poolOf(): readonly PoolRoute[] {
    const source = this.poolConfig
    return source === undefined ? [] : isVolatile(source) ? source.get() : source
  }

  private userPoolOf(): readonly PoolRoute[] {
    const source = this.userPoolConfig
    return source === undefined ? [] : isVolatile(source) ? source.get() : source
  }

  /** Effective pool: the user-selected pool persisted through Settings when set, else the configured default. */
  private effectivePool(): readonly PoolRoute[] {
    const userPool = this.userPoolOf()
    const configured = isVolatile(this.userPoolConfigured) ? this.userPoolConfigured.get() : this.userPoolConfigured
    return configured === true || userPool.length > 0 ? userPool : this.poolOf()
  }

  protected async [Service.init](): Promise<void> {
    this.projection = await this.ctx.sessionProjections.register(orchestrationProjectionDefinition)
    this.adaptive = await AdaptiveRouting.create(this.ctx, {
      modeOf: agent => this.modeOf(agent),
      preparingEnabled: (agent) => {
        const state = this.stateOf(agent.session)
        return state.active && state.wanted !== false
      },
      modeOfSession: session => this.stateOf(session).active,
      config: this.config,
      validate: validateAssessment,
      resolve: (request, options) => this.resolveRoute(request, true, request.signal, options),
    })
    const lifetime = new AbortController()
    const pending = new Set<Promise<SubagentModelRouting>>()
    this.ctx.effect(() => async () => {
      lifetime.abort(new DOMException('orchestration unloaded', 'AbortError'))
      await Promise.allSettled([...pending])
    }, 'orchestration: settle pending route admission')
    this.ctx.subagents.registerModelRouter({
      newRootPolicyDefaults: () => this.config.seedPoolAsRootPolicy ? this.getPool() : undefined,
      requestChange: request => this.adaptiveRouting().requestChange(request),
      requestColdChange: request => this.adaptiveRouting().requestColdChange(request),
      resolve: (request) => {
        const active = this.modeOf(request.parent)
        const operation = this.resolveRoute(request, active, AbortSignal.any([request.signal, lifetime.signal]))
        pending.add(operation)
        void operation.then(() => { pending.delete(operation) }, () => { pending.delete(operation) })
        return operation
      },
    })
    this.ctx.on('agent/created', ({ agent }) => {
      this.seedMode(agent)
      return undefined
    })
    this.ctx.on('subagent/end', (run) => { this.pendingAssignments.delete(run.id) })
    this.ctx.on('session/event', (session, event) => {
      if (event.type === 'orchestration/mode' || event.type === 'orchestration/mode-request'
        || event.type === 'orchestration/pool-snapshot'
        || pluginRecordOf(event)?.type === 'plugin:orchestration/mode-request') {
        this.modeGenerations.set(session, (this.modeGenerations.get(session) ?? 0) + 1)
      }
      if (event.type === 'request/header' && this.pendingAssignments.has(session.id)) {
        this.pendingAssignments.set(session.id, { provider: event.data.header.config.provider, model: event.data.header.config.model })
      }
    })
    for (const agent of this.ctx.agents.list()) this.seedMode(agent)
    this.ctx.on('agent/pre-step', async ({ agent, messages, step, signal }, next) => {
      const decision = await next()
      if (decision.kind === 'reject' || signal.aborted) return decision
      if (decision.messages.length === 0 && (step === 1 || messages.length > 0)) return decision
      const state = this.stateOf(agent.session)
      if (state.wanted !== null) this.commit(agent, state.wanted, state.wantedPool)
      return decision
    }, { prepend: true })
    this.ctx.on('loader/volatile-update', (paths) => {
      if (paths.some(path => path.length === 1 && (path[0] === 'pool' || path[0] === 'userPool'
        || path[0] === 'userPoolConfigured' || path[0] === 'userPoolMemberships'))) {
        const pool = this.effectivePool()
        const memberships = this.configuredMemberships()
        if (paths.some(path => path.length === 1 && path[0] === 'userPoolMemberships')
          && this.membershipsMatch(pool, memberships)) this.poolMemberships = memberships.map(member => ({ ...member }))
        this.setPool(pool)
      }
    })
    this.ctx.systemPrompt.context({
      name: 'orchestration',
      order: 600,
      required: true,
      text: ({ agent }) => agent !== undefined && this.modeOf(agent)
        ? 'Orchestration mode is active. Proactively identify independent work that can make useful progress in parallel. When the available subagent tools and delegation limits allow it, prefer delegating bounded tasks with clear goals and expected results without waiting for the user to request delegation. Start independent delegations early and continue useful work yourself when possible. Respect the user\'s instructions, delegation depth, and active-child limits. Handle work directly when it is small, sequential, or delegation would add overhead without useful parallel progress. For every fresh local child, supply task_assessment with requiredCapabilities (coding, reasoning, vision, allrounder, european), contextTokens for expected input including files the child will read, and requiredModalities for inputs needed throughout the task. Require coding for ordinary implementation tasks. Prefer reasoning when it would help; require it only when the task specifically needs that capability. Include image for screenshots the child may capture later. Use preferredCapabilities for optional strengths and outputTokens for the expected response allowance. Every required capability must be supported; reasoning alone does not establish coding ability. Model selection automatically considers the allowed pool, capabilities, live load, and request/token queue availability.'
        : '',
    })
    this.ctx.inject(['commands'], (commandCtx) => {
      commandCtx.commands.register({
        definitionId: brandString<CommandDefinitionId>('@deepseek-ai/dsh-orchestration'),
        name: 'orchestration',
        description: 'Turn orchestration mode on or off for this session',
        input: { hint: 'on|off' },
        handler: ({ agent, rawInput }) => {
          const arg = rawInput.trim()
          if (!['', 'on', 'off'].includes(arg)) return { kind: 'error', text: 'Usage: /orchestration on|off' }
          const active = arg !== 'off'
          const outcome = this.select(agent, active)
          return { kind: 'success', text: outcome === 'queued'
            ? 'Orchestration mode selection applies from the next step.'
            : active ? 'Orchestration mode on.' : 'Orchestration mode off.' }
        },
      })
    })
  }

  private stateOf(session: Session): OrchestrationUnitState {
    if (this.projection === undefined) {
      throw new OrchestrationError('orchestration mode is not ready; await plugin activation', 'ORCHESTRATION_NOT_READY')
    }
    return this.projection.stateOf(session)
  }

  private adaptiveRouting(): AdaptiveRouting {
    if (this.adaptive === undefined) throw new OrchestrationError('Adaptive routing is not ready.', 'ORCHESTRATION_NOT_READY')
    return this.adaptive
  }

  private seedMode(agent: Agent): void {
    const state = this.stateOf(agent.session)
    if (!state.entered && state.wanted === null && state.running === null
      && (this.config.defaultToOrchestrator || this.config.recordDisabledDefault)) {
      this.commit(agent, this.config.defaultToOrchestrator)
    }
  }

  private commit(agent: Agent, active: boolean, members: readonly PoolMembership[] | null = this.poolMemberships): void {
    if (active && members !== null) agent.session.append('orchestration/pool-snapshot', { pending: false, members })
    else agent.session.append('orchestration/mode', { active })
  }

  /** Count each assigned child once across its reservation and any published live work. */
  private activeLoads(): ReadonlyMap<string, number> {
    const counts = new Map<string, number>()
    const assignments = new Map(this.pendingAssignments)
    for (const agent of this.ctx.agents.list()) {
      const open = this.ctx.agents.turnBoundaryOf(agent.session).openTurnStartSeq !== null
      if (!open && agent.inbox.nextStep.length === 0 && agent.inbox.nextTurn.length === 0) continue
      const route = agent.session.requestHeader()?.config
      if (route !== undefined && !assignments.has(agent.id)) assignments.set(agent.id, route)
    }
    for (const route of assignments.values()) {
      const key = routeKey(route)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }

  /** Read the applied logged mode; pending selections affect only the next accepted step.
   * @param agent - Session owner.
   * @returns Applied mode for new delegations.
   */
  modeOf(agent: Agent): boolean {
    return this.stateOf(agent.session).active
  }

  /** Record a selection immediately between turns, or queue it durably within a turn.
   * @param agent - Session owner.
   * @param active - Desired mode.
   */
  setMode(agent: Agent, active: boolean): void {
    this.select(agent, active)
  }

  /** Select mode without losing pending intent on restart or plugin replacement.
   * @param agent - Session owner.
   * @param active - Desired mode.
   * @returns Whether the selection committed, queued, cancelled a pending choice, or already matched.
   */
  select(agent: Agent, active: boolean): 'committed' | 'queued' | 'cancelled' | 'noop' {
    this.modeGenerations.set(agent.session, (this.modeGenerations.get(agent.session) ?? 0) + 1)
    const state = this.stateOf(agent.session)
    if (active === (state.wanted ?? state.active)) return 'noop'
    if (this.ctx.agents.turnBoundaryOf(agent.session).openTurnStartSeq !== null) {
      if (active && active !== state.active) {
        agent.session.append('orchestration/pool-snapshot', { pending: true, members: this.poolMemberships })
      } else agent.session.append('orchestration/mode-request', { active })
      return active === state.active ? 'cancelled' : 'queued'
    }
    this.commit(agent, active)
    return 'committed'
  }

  /** Read the default pool; recorded Session policies independently constrain every delegation.
   * @returns Detached exact routes in configured order.
   */
  @Remote('getPool')
  getPool(): readonly PoolRoute[] {
    return this.poolValue.map(route => ({ ...route }))
  }

  /** Read the effective pool and its current settings revision.
   * @returns The current pool and null when settings are unavailable.
   */
  @Remote('getPoolSettingsState')
  getPoolSettingsState(): PoolSettingsState {
    const settings = this.ctx.get('settings')
    const descriptor = settings?.describe().find(item => item.ns === POOL_SETTINGS_NS)
    return { pool: this.getPool(), revision: descriptor?.revision ?? null }
  }

  private userCapabilities(): readonly RouteCapabilities[] {
    const source = this.userCapabilitiesConfig
    const values = source === undefined ? [] : isVolatile(source) ? source.get() : source
    return values.map(route => ({ ...route, capabilities: [...route.capabilities] }))
  }

  private routeCapabilities(): readonly RouteCapabilities[] {
    const overrides = this.userCapabilities()
    const keys = new Set(overrides.map(routeKey))
    return [...this.config.routeCapabilities.filter(route => !keys.has(routeKey(route))), ...overrides]
  }

  /** Read the active pool and user-assigned specialties at one revision.
   * @returns Detached settings for the pool editor.
   */
  @Remote('getPoolConfiguration')
  getPoolConfiguration(): PoolConfiguration {
    this.requireOwner()
    return { ...this.getPoolSettingsState(), capabilityOverrides: this.userCapabilities() }
  }

  private requireOwner(): void {
    if (principalOf(this.ctx.invocation) !== undefined) {
      throw new RemoteError('orchestration/owner-required', 'Only the owner can authorize orchestration routes.', {})
    }
  }

  private async activationAgent(sessionId: SessionId): Promise<Agent | undefined> {
    const existing = this.ctx.agents.get(sessionId)
    if (existing !== undefined) return existing
    const controller = this.ctx.get('sessionController')
    if (controller === undefined) return undefined
    const result = await controller.resolveAgent(sessionId)
    return 'error' in result ? undefined : result.agent
  }

  /** Review the current pool and the Session's existing child-model permissions.
   * @param sessionId - Conversation to activate.
   * @returns A setup requirement or a one-use review of the exact routes.
   */
  @Remote({ name: 'prepareActivation', resources: { session: sessionId => sessionId } })
  async prepareActivation(sessionId: SessionId): Promise<OrchestrationActivationPreflight> {
    this.requireOwner()
    const agent = await this.activationAgent(sessionId)
    if (agent === undefined) return { status: 'unavailable' }
    const session = agent.session
    this.activationReviews.delete(session)
    if (this.ctx.sessions.durableAppendPending(session)) return { status: 'durability' }
    const { pool, revision } = this.getPoolSettingsState()
    if (revision === null) return { status: 'unavailable' }
    if (pool.length === 0) return { status: 'needs-pool' }
    const parent = agent.model.current()
    const parentRoute = parent === undefined ? null : { provider: parent.provider, model: parent.model }
    const isChild = session.header.origin === 'subagent'
    const policy = isChild ? this.ctx.subagents.runningModelPolicyOf(session) : this.ctx.subagents.modelSelectionPolicyOf(session)
    const allowed = policy ?? (parentRoute === null ? [] : [parentRoute])
    const additionalRoutes = pool.filter(route => !allowed.some(item => routeKey(item) === routeKey(route)))
    if (isChild && additionalRoutes.length === pool.length) return { status: 'child-restricted' }
    const id = brandString<OrchestrationReviewId>(randomUUID())
    this.activationReviews.set(session, { id, pool, poolRevision: revision,
      members: this.poolMemberships.map(member => ({ ...member })), policy: policy ?? null,
      parent: parentRoute, modeGeneration: this.modeGenerations.get(session) ?? 0,
      additionalRoutes: isChild ? [] : additionalRoutes })
    return { status: !isChild && additionalRoutes.length > 0 ? 'authorize' : 'ready', reviewId: id,
      pool, additionalRoutes: isChild ? [] : additionalRoutes }
  }

  /** Apply one reviewed activation without widening permissions without consent.
   * @param sessionId - Conversation from the review.
   * @param reviewId - One-use review identifier.
   * @param authorize - Whether the user approved the displayed additional routes.
   * @returns Applied, queued, stale, or failed admission.
   */
  @Remote({ name: 'activateReviewed', resources: { session: sessionId => sessionId } })
  async activateReviewed(sessionId: SessionId, reviewId: OrchestrationReviewId,
    authorize: boolean): Promise<OrchestrationActivationResult> {
    this.requireOwner()
    const agent = await this.activationAgent(sessionId)
    if (agent === undefined) return { status: 'failed' }
    const session = agent.session
    const review = this.activationReviews.get(session)
    if (review === undefined || review.id !== reviewId) return { status: 'stale' }
    this.activationReviews.delete(session)
    const current = (): boolean => {
      const state = this.getPoolSettingsState()
      const parent = agent.model.current()
      const route = parent === undefined ? null : { provider: parent.provider, model: parent.model }
      const policy = session.header.origin === 'subagent'
        ? this.ctx.subagents.runningModelPolicyOf(session) : this.ctx.subagents.modelSelectionPolicyOf(session)
      return state.revision === review.poolRevision && isDeepStrictEqual(state.pool, review.pool)
        && isDeepStrictEqual(this.poolMemberships, review.members)
        && isDeepStrictEqual(policy ?? null, review.policy) && isDeepStrictEqual(route, review.parent)
        && (this.modeGenerations.get(session) ?? 0) === review.modeGeneration
    }
    if (!current()) return { status: 'stale' }
    if (review.additionalRoutes.length > 0 && !authorize) return { status: 'authorization-required' }
    if (review.additionalRoutes.length > 0) {
      const additions = [...review.additionalRoutes]
      const parent = review.parent
      if (review.policy === null && parent !== null
        && !additions.some(route => routeKey(route) === routeKey(parent))) additions.unshift(parent)
      try {
        await this.ctx.sessions.appendDurably(session, [['subagent/model-selection-policy-authorized', { allowedModels: additions }]])
      } catch (error: unknown) {
        this.ctx.logger.warn('orchestration: authorization could not be persisted', error)
        return { status: 'failed' }
      }
      const after = this.getPoolSettingsState()
      const parentAfter = agent.model.current()
      const routeAfter = parentAfter === undefined ? null : { provider: parentAfter.provider, model: parentAfter.model }
      const expectedPolicy = [...review.policy ?? [], ...additions]
      const actualPolicy = this.ctx.subagents.modelSelectionPolicyOf(session)
      if (after.revision !== review.poolRevision || !isDeepStrictEqual(after.pool, review.pool)
        || !isDeepStrictEqual(this.poolMemberships, review.members)
        || (this.modeGenerations.get(session) ?? 0) !== review.modeGeneration
        || this.ctx.agents.get(sessionId) !== agent || !isDeepStrictEqual(routeAfter, review.parent)
        || !isDeepStrictEqual(actualPolicy, expectedPolicy)) return { status: 'stale' }
    }
    const state = this.stateOf(session)
    const requested = state.wanted === null ? state.active : state.wanted
    if (requested) return { status: 'applied' }
    const pending = this.ctx.agents.turnBoundaryOf(session).openTurnStartSeq !== null
    try {
      if (pending && state.active) {
        await this.ctx.sessions.appendDurably(session, [['orchestration/mode-request', { active: true }]])
      } else {
        await this.ctx.sessions.appendDurably(session, [['orchestration/pool-snapshot', { pending, members: review.members }]])
      }
    } catch (error: unknown) {
      this.ctx.logger.warn('orchestration: activation could not be persisted', error)
      return { status: 'failed' }
    }
    return { status: pending && !state.active ? 'queued' : 'applied' }
  }

  /** Enable a root conversation using the current pool as the owner's selection.
   * @param sessionId - Conversation to activate.
   * @returns Applied or queued selection, or an actionable setup failure.
   */
  @Remote({ name: 'activatePool', resources: { session: sessionId => sessionId } })
  async activatePool(sessionId: SessionId): Promise<OrchestrationPoolActivationResult> {
    this.requireOwner()
    const agent = await this.activationAgent(sessionId)
    if (agent === undefined || agent.session.header.origin === 'subagent') return { status: 'unavailable' }
    if (this.ctx.sessions.durableAppendPending(agent.session)) return { status: 'durability' }
    const initial = this.getPoolSettingsState()
    if (initial.pool.length === 0) return { status: 'needs-pool' }
    if (initial.revision === null) return { status: 'unavailable' }
    if (!isDeepStrictEqual(this.configuredMemberships(), this.poolMemberships)) {
      const settings = this.ctx.get('settings')
      if (settings === undefined) return { status: 'unavailable' }
      const members = this.poolMemberships.map(member => ({ ...member }))
      try {
        await settings.update(POOL_SETTINGS_NS, { userPoolMemberships: members }, initial.revision)
      } catch (error: unknown) {
        this.ctx.logger.warn('orchestration: pool membership could not be persisted', error)
        return { status: error instanceof Error && 'code' in error && error.code === 'SETTINGS_CONFLICT' ? 'stale' : 'failed' }
      }
      const after = this.getPoolSettingsState()
      if (!isDeepStrictEqual(after.pool, initial.pool) || !isDeepStrictEqual(this.configuredMemberships(), members)
        || !isDeepStrictEqual(this.poolMemberships, members)) return { status: 'stale' }
    }
    const preflight = await this.prepareActivation(sessionId)
    if (!('reviewId' in preflight)) return { status: preflight.status === 'child-restricted' ? 'unavailable' : preflight.status }
    const result = await this.activateReviewed(sessionId, preflight.reviewId, true)
    if (result.status === 'failed' && this.ctx.sessions.durableAppendPending(agent.session)) return { status: 'durability' }
    return { status: result.status === 'authorization-required' ? 'failed' : result.status }
  }

  /** Retry a failed authorization checkpoint without writing another approval.
   * @param sessionId - Conversation whose checkpoint failed.
   * @returns Whether the Session's checkpoint is now durable.
   */
  @Remote({ name: 'retryActivationStorage', resources: { session: sessionId => sessionId } })
  async retryActivationStorage(sessionId: SessionId): Promise<boolean> {
    this.requireOwner()
    const agent = await this.activationAgent(sessionId)
    if (agent === undefined) return false
    try { return await this.ctx.sessions.retryDurableAppend(agent.session) }
    catch (error: unknown) { this.ctx.logger.warn('orchestration: checkpoint retry failed', error); return false }
  }

  /** Permit a user to retry models after correcting an exhausted billing account. */
  @Remote('resetBillingHealth')
  resetBillingHealth(): void {
    this.adaptiveRouting().resetBillingHealth()
  }

  /** Project the pool picker catalog from the live LLM registry, not a static list.
   * Providers and models are taken from `ctx.llm.listProviders()`/`listModels()`,
   * so the picker matches the models the composer can actually select. Curated
   * specialties/capacity from the Paderborn catalogue apply only to known
   * `uni-paderborn` routes; everything else carries live adapter metadata.
   * @returns Detached per-provider model facts used by the pool picker.
   */
  @Remote('getCatalog')
  async getCatalog(): Promise<OrchestrationCatalog> {
    const providers = this.ctx.llm.listProviders()
    const groups = await Promise.all(providers.map(async (provider) => {
      let models: readonly LlmModelInfo[]
      try {
        models = await this.ctx.llm.listModels(provider.id)
      } catch {
        return null
      }
      const entries = await Promise.all(models.map(model => this.catalogModel(provider.id, provider.name, model)))
      return { provider: provider.id, name: provider.name, models: entries }
    }))
    return { groups: groups.flatMap((group): OrchestrationCatalogGroup[] => group && group.models.length > 0 ? [group] : []) }
  }

  /** Render one live model as a pool-picker row, decorated with curated facts when catalogued.
   * @param provider - Registered provider route.
   * @param providerName - Human provider display name.
   * @param model - Live LLM registry model entry.
   * @returns Detached model facts for the picker, resolved against the adapter for capacity and reasoning.
   */
  private async catalogModel(provider: string, providerName: string, model: LlmModelInfo): Promise<OrchestrationCatalogModel> {
    let resolved: LlmResolvedModelInfo | undefined
    try {
      resolved = await this.ctx.llm.resolveModelInfo(provider, model.id)
    } catch {
      resolved = undefined
    }
    const curated = provider === POOL_PROVIDER ? capabilityOf(model.id) : undefined
    const modalities = (resolved?.inputModalities ?? model.inputModalities ?? curated?.modalities)
      ?.filter((item): item is 'text' | 'image' => item === 'text' || item === 'image')
    return {
      id: model.id,
      name: model.name,
      provider,
      providerName,
      offlineCurated: curated !== undefined,
      imageInput: modalities?.includes('image') ?? curated?.imageInput ?? false,
      reasoning: resolved?.reasoning !== undefined ? resolved.reasoning.efforts.length > 0 : curated?.reasoning ?? false,
      domains: [...(this.routeCapabilities().find(route => route.provider === provider && route.model === model.id)?.capabilities
        ?? curated?.domains ?? [])],
      modalities: [...(modalities ?? (model.inputModalities ?? ['text']))],
      contextWindow: resolved?.context?.contextWindow ?? curated?.contextWindow ?? 0,
      ...(resolved?.rateLimit !== undefined
        ? {
          rateLimits: {
            ...(resolved.rateLimit.rpm === undefined ? {} : { rpm: resolved.rateLimit.rpm }),
            ...(resolved.rateLimit.tpm === undefined ? {} : { tpm: resolved.rateLimit.tpm }),
          },
        }
        : curated?.rateLimits !== undefined ? { rateLimits: { ...curated.rateLimits } } : {}),
      health: curated?.health ?? 'routeable',
      suggested: curated?.suggested ?? '',
    }
  }

  /** Replace the pool in memory; existing Session authorization is never widened.
   * @param pool - Exact routes, possibly empty to disable automatic selection.
   */
  @Remote('setPool')
  setPool(pool: readonly PoolRoute[]): void {
    this.poolMemberships = this.makeMemberships(pool, this.poolMemberships)
    this.poolValue = pool.map(route => ({ ...route }))
    const keys = new Set(pool.map(routeKey))
    for (const key of this.lastAssigned.keys()) if (!keys.has(key)) this.lastAssigned.delete(key)
  }

  /** Persist a pool against the revision read by the caller.
   * @param pool - New default routes; existing Session authorization remains fixed.
   * @param revision - Settings revision from the most recent read.
   * @returns The applied pool or an actionable failure.
   */
  @Remote('persistPool')
  async persistPool(pool: readonly PoolRoute[], revision: number): Promise<PoolSaveResult> {
    const settings = this.ctx.get('settings')
    if (settings === undefined) {
      return { status: 'failed', message: 'Settings are unavailable.' }
    }
    try {
      const keys = pool.map(routeKey)
      if (pool.some(route => route.provider.length === 0 || route.model.length === 0) || new Set(keys).size !== keys.length) {
        return { status: 'failed', message: 'The model pool contains an invalid or repeated route.' }
      }
      const members = this.makeMemberships(pool, this.poolMemberships)
      await settings.update(POOL_SETTINGS_NS, { userPool: pool, userPoolConfigured: true, userPoolMemberships: members }, revision)
      const current = this.getPoolSettingsState()
      if (current.revision === null || !isDeepStrictEqual(current.pool, pool)
        || !isDeepStrictEqual(this.configuredMemberships(), members) || !isDeepStrictEqual(this.poolMemberships, members)) {
        return { status: 'failed', message: 'The saved pool is not the active configuration. Reload settings.' }
      }
      return { status: 'saved', pool: current.pool, revision: current.revision }
    } catch (error) {
      this.ctx.logger.warn('orchestration: the pool could not be persisted to settings', error)
      const stale = error instanceof Error && 'code' in error && error.code === 'SETTINGS_CONFLICT'
      return { status: stale ? 'stale' : 'failed', message: stale
        ? 'The settings changed. Reload them before saving.' : 'The model pool could not be saved.' }
    }
  }

  /** Persist a pool and exact-route specialty overrides against the settings revision.
   * @param pool - Selected exact provider/model routes.
   * @param capabilityOverrides - User-assigned specialties for exact routes.
   * @param revision - Revision returned by {@link getPoolConfiguration}.
   * @returns Confirmed configuration or an actionable stale/failed result.
   */
  @Remote('persistPoolConfiguration')
  async persistPoolConfiguration(pool: readonly PoolRoute[], capabilityOverrides: readonly RouteCapabilities[],
    revision: number): Promise<PoolConfigurationSaveResult> {
    this.requireOwner()
    const settings = this.ctx.get('settings')
    if (settings === undefined) return { status: 'failed', message: 'Settings are unavailable.' }
    const validRoutes = (routes: readonly PoolRoute[]): boolean => routes.every(route =>
      route.provider.length > 0 && route.model.length > 0)
      && new Set(routes.map(routeKey)).size === routes.length
    if (!validRoutes(pool) || !validRoutes(capabilityOverrides) || capabilityOverrides.some(route =>
      new Set(route.capabilities).size !== route.capabilities.length
      || route.capabilities.some(capability => !TASK_DOMAINS.includes(capability)))) {
      return { status: 'failed', message: 'The model pool or specialties contain invalid or repeated entries.' }
    }
    try {
      const members = this.makeMemberships(pool, this.poolMemberships)
      await settings.update(POOL_SETTINGS_NS, { userPool: pool, userPoolConfigured: true,
        userPoolMemberships: members, userRouteCapabilities: capabilityOverrides }, revision)
      const configuration = this.getPoolConfiguration()
      if (configuration.revision === null || !isDeepStrictEqual(configuration.pool, pool)
        || !isDeepStrictEqual(this.configuredMemberships(), members) || !isDeepStrictEqual(this.poolMemberships, members)
        || !isDeepStrictEqual(configuration.capabilityOverrides, capabilityOverrides)) {
        return { status: 'failed', message: 'The saved configuration is not active. Reload settings.' }
      }
      return { status: 'saved', configuration }
    } catch (error: unknown) {
      this.ctx.logger.warn('orchestration: the pool configuration could not be persisted', error)
      const stale = error instanceof Error && 'code' in error && error.code === 'SETTINGS_CONFLICT'
      return { status: stale ? 'stale' : 'failed', message: stale
        ? 'The settings changed. Reload them before saving.' : 'The model pool could not be saved.' }
    }
  }

  private async resolveRoute(
    request: SubagentModelRoutingContext,
    active: boolean,
    signal: AbortSignal,
    admission?: AdaptiveAdmission,
  ): Promise<SubagentModelRouting> {
    signal.throwIfAborted()
    const capturedPool = this.stateOf(request.parent.session).activePool
    let admitted: PoolRoute | undefined
    const belongs = (route: PoolRoute): boolean => {
      const captured = capturedPool?.find(member => routeKey(member) === routeKey(route))
      return captured !== undefined && this.poolMemberships.some(member => routeKey(member) === routeKey(route)
        && member.membershipId === captured.membershipId)
    }
    const setup = (child: Agent): void => {
      if (active && admitted !== undefined && !belongs(admitted)) {
        throw new OrchestrationError('The selected model was removed before the child started.', 'ORCHESTRATION_NO_CAPABLE_ROUTE')
      }
      this.commit(child, active, capturedPool)
      if (active && request.taskAssessment !== undefined) this.adaptiveRouting().initialize(child, request.taskAssessment)
    }
    if (!active) return this.config.recordDisabledDefault ? { setup } : {}
    if (capturedPool === null) {
      throw new OrchestrationError('Turn orchestration off and on to capture the selected model pool.', 'ORCHESTRATION_NO_CAPABLE_ROUTE')
    }
    const declared = request.taskAssessment
    if (declared === undefined) {
      throw new OrchestrationError('orchestration mode requires task_assessment for each fresh local delegation', 'ORCHESTRATION_ASSESSMENT_REQUIRED')
    }
    validateAssessment(declared)
    const hasImage = request.prompt.some(block => block.type === 'image' && block.offloaded !== true)
    const assessment = {
      ...declared,
      requiredCapabilities: [...new Set([...declared.requiredCapabilities, ...hasImage ? ['vision'] : []])],
      requiredModalities: [...new Set(['text', ...declared.requiredModalities ?? [], ...hasImage ? ['image'] : []])],
    }
    const inputTokens = admission?.inputTokens ?? (Math.max(assessment.contextTokens,
      estimateRequestInputTokens([{ content: request.prompt }])) + this.config.contextOverheadTokens)
    const policy = this.ctx.subagents.modelSelectionPolicyOf(request.parent.session)
    const parent = request.parent.model.current()
    const allowed = admission?.allowedModels ?? policy ?? (parent === undefined ? [] : [{ provider: parent.provider, model: parent.model }])
    const configuredPool = this.getPool()
    const pool = configuredPool.filter(route => belongs(route)
      && allowed.some(item => item.provider === route.provider && item.model === route.model))
    const unavailable = new Set<string>()
    const inspected = await Promise.allSettled(pool.map(async (route): Promise<CapabilityRoute | undefined> => {
      try {
        const info = await this.ctx.llm.resolveModelInfo(route.provider, route.model, signal)
        return capabilityRoute(route, info, this.routeCapabilities())
      } catch (cause) {
        signal.throwIfAborted()
        if (cause instanceof HarnessError && ['UNKNOWN_MODEL', 'MODEL_UNSUPPORTED', 'NO_ADAPTER', 'MISSING_CREDENTIAL',
          'INVALID_CREDENTIAL', 'AUTH'].includes(cause.code)) {
          unavailable.add(routeKey(route))
          return undefined
        }
        throw new OrchestrationError('cannot inspect orchestration route ' + route.provider + '/' + route.model,
          'ORCHESTRATION_ROUTE_METADATA_FAILED', { cause })
      }
    }))
    signal.throwIfAborted()
    const candidates: CapabilityRoute[] = []
    for (const result of inspected) {
      if (result.status === 'rejected') throw result.reason
      if (result.value !== undefined) candidates.push(result.value)
    }
    const caps = new Map<string, number>()
    const exclusions = new Map<string, OrchestrationRouteAlternative['exclusions']>()
    for (const route of candidates) {
      const same = route.provider === request.agentOptions.provider && route.model === request.agentOptions.model
      const effective = await this.ctx.llm.resolveCallConfig({ provider: route.provider, model: route.model,
        ...request.agentOptions.maxTokens === undefined ? {} : { maxTokens: request.agentOptions.maxTokens },
        ...(!same && admission === undefined) || request.agentOptions.reasoningEffort === undefined
          ? {} : { reasoningEffort: request.agentOptions.reasoningEffort },
      }, signal).catch((cause: unknown) => {
        signal.throwIfAborted()
        if (cause instanceof HarnessError && ['UNKNOWN_MODEL', 'MODEL_UNSUPPORTED', 'NO_ADAPTER',
          'MISSING_CREDENTIAL', 'INVALID_CREDENTIAL', 'AUTH', 'INVALID_MODEL_MAX_TOKENS',
          'UNSUPPORTED_REASONING_EFFORT'].includes(cause.code)) return undefined
        throw cause
      })
      if (effective === undefined) {
        exclusions.set(routeKey(route), ['route-unavailable'])
        continue
      }
      const cap = effective.maxTokens ?? assessment.outputTokens ?? this.config.outputReserveTokens
      caps.set(routeKey(route), cap)
      const reasons = routeExclusions(route, assessment, inputTokens,
        Math.max(cap, assessment.outputTokens ?? this.config.outputReserveTokens))
      if (!this.adaptiveRouting().billingAvailable(route.billing)) reasons.push('billing-exhausted')
      if (admission !== undefined && request.agentOptions.reasoningEffort !== undefined
        && route.reasoningEfforts?.includes(request.agentOptions.reasoningEffort) !== true) reasons.push('unsupported-reasoning')
      if (admission?.excludeRoutes?.some(item => routeKey(item) === routeKey(route))) reasons.push('recovery-attempted')
      if (admission?.minimumContextWindow !== undefined && (route.contextWindow ?? 0) < admission.minimumContextWindow) reasons.push('context-capacity')
      if (reasons.length === 0) {
        try {
          await request.parent.ctx.get('compaction')?.pressureBudget(request.parent,
            { config: effective }, signal)
        } catch (error: unknown) {
          if (!(error instanceof Error) || !('code' in error) || error.code !== 'COMPACTION_INVALID_BUDGET') throw error
          reasons.push('compaction-budget')
        }
      }
      exclusions.set(routeKey(route), reasons)
    }
    const capable = candidates.filter(route => exclusions.get(routeKey(route))?.length === 0)
    if (capable.length === 0) {
      throw new OrchestrationError('no allowed pool model satisfies every required capability, modality, and context allowance',
        'ORCHESTRATION_NO_CAPABLE_ROUTE')
    }
    while (true) {
      signal.throwIfAborted()
      if (admission?.isCurrent?.() === false) throw new OrchestrationError('A newer phase replaced this admission.', 'ORCHESTRATION_REASSIGNMENT_STALE')
      if (!capable.some(belongs)) throw new OrchestrationError('No selected model remains in the current pool.', 'ORCHESTRATION_NO_CAPABLE_ROUTE')
      const availability = await Promise.all(capable.map(async (route) => {
        const cap = caps.get(routeKey(route))
        if (cap === undefined) throw new Error('A capable route has no resolved generation cap')
        const queue = await this.ctx.llm.queueAvailability({ ...route, inputTokens, maxTokens: cap })
        const providerWaitMs = this.adaptiveRouting().providerWaitMs(route)
        if (providerWaitMs > 0 && queue.kind !== 'impossible') {
          return { route, queue: { kind: 'wait' as const, waitMs: Math.max(providerWaitMs, queue.kind === 'wait' ? queue.waitMs : 0) } }
        }
        return { route, queue }
      }))
      signal.throwIfAborted()
      if (admission?.isCurrent?.() === false) throw new OrchestrationError('A newer phase replaced this admission.', 'ORCHESTRATION_REASSIGNMENT_STALE')
      const load = new Map(this.activeLoads())
      const previous = this.pendingAssignments.get(request.childId)
      if (admission !== undefined && previous !== undefined) {
        const oldKey = routeKey(previous)
        load.set(oldKey, Math.max(0, (load.get(oldKey) ?? 0) - 1))
      }
      const ready: ReadyRoute[] = availability.flatMap(({ route, queue }) =>
        !belongs(route) || !this.adaptiveRouting().billingAvailable(route.billing) ? [] :
          queue.kind === 'ready' || queue.kind === 'unknown' ? [{ route, readiness: queue.kind,
            active: load.get(routeKey(route)) ?? 0, lastAssigned: this.lastAssigned.get(routeKey(route)) ?? 0 }] : [])
      const preferred = admission?.preferredRoute
      const available = preferred === undefined ? ready : ready.filter(item => routeKey(item.route) === routeKey(preferred))
      const selected = selectReadyRoute(available, assessment)
      if (selected !== undefined) {
        const key = routeKey(selected.route)
        const cap = caps.get(key)
        if (cap === undefined) throw new Error('The selected route has no resolved generation cap')
        const alternatives: OrchestrationRouteAlternative[] = configuredPool.filter(route => routeKey(route) !== key).map((route) => {
          const id = routeKey(route)
          const metadata = candidates.find(item => routeKey(item) === id)
          const queue = availability.find(item => routeKey(item.route) === id)?.queue
          return {
            ...route,
            activeAssignments: load.get(id) ?? 0,
            exclusions: metadata === undefined ? [unavailable.has(id) ? 'route-unavailable' : 'unauthorized'] : [...exclusions.get(id) ?? [],
              ...queue?.kind === 'wait' ? ['rate-limit' as const]
                : queue?.kind === 'impossible' ? ['request-token-capacity' as const] : []],
            ...queue === undefined ? {} : { availability: queue },
            ...metadata === undefined ? {} : { capabilities: metadata.capabilities },
            ...metadata?.modalities === undefined ? {} : { modalities: metadata.modalities },
            ...metadata?.contextWindow === undefined ? {} : { contextWindow: metadata.contextWindow },
            ...metadata?.maxOutputTokens === undefined ? {} : { maxOutputTokens: metadata.maxOutputTokens },
          }
        })
        request.parent.session.append('orchestration/route', {
          childId: request.childId,
          assessment,
          selected: { provider: selected.route.provider, model: selected.route.model },
          reason: selected.reason,
          eligibleCount: ready.length,
          selectedLoad: load.get(key) ?? 0,
          selectedReadiness: selected.readiness,
          alternatives,
          inputTokens,
          outputTokens: Math.max(cap, assessment.outputTokens ?? this.config.outputReserveTokens),
        })
        const assignment = { provider: selected.route.provider, model: selected.route.model }
        admitted = assignment
        this.pendingAssignments.set(request.childId, assignment)
        this.lastAssigned.set(key, ++this.sequence)
        return {
          agentOptions: {
            ...request.agentOptions,
            provider: selected.route.provider,
            model: selected.route.model,
            reasoningEffort: admission !== undefined || (selected.route.provider === request.agentOptions.provider
              && selected.route.model === request.agentOptions.model
            ) ? request.agentOptions.reasoningEffort : undefined,
          },
          setup,
          release: () => {
            if (this.pendingAssignments.get(request.childId) === assignment) this.pendingAssignments.delete(request.childId)
          },
        }
      }
      const waits = availability.flatMap(item => item.queue.kind === 'wait' ? [item.queue.waitMs] : [])
      if (waits.length === 0) {
        throw new OrchestrationError('every capable pool model exceeds its token-per-minute request capacity',
          'ORCHESTRATION_NO_CAPABLE_ROUTE')
      }
      if (admission?.readyOnly === true) throw new OrchestrationError('compatible models are temporarily busy', 'ORCHESTRATION_CAPACITY_BUSY')
      await admission?.onWaiting?.()
      await waitForAvailability(Math.min(...waits, this.config.availabilityPollMs), signal)
    }
  }
}

export default OrchestrationService
