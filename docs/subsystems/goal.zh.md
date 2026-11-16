# 同会话目标与工作交接

[English](goal.md) | 中文

事件溯源目标服务、未完成工作交接及其策略消费方共享的类型。[目标领域参考](../../packages/goal/goal/README.zh.md)负责目标持久化与激活；[工作交接参考](../../packages/goal/work-handoff/README.zh.md)负责恢复报告与明确续行。本页记录它们的公开字段和变体。

## 标识与生命周期

`GoalId` 是[品牌化 id](core.zh.md#branded-ids)。调用方通过 `GoalRef` 修改一个确切修订版本；每次获准的持久变更都会递增修订号。

```ts type-equiv
/** Compare-and-set identity for one exact goal revision. */
interface GoalRef {
  /** Stable goal identity. */
  readonly id: GoalId
  /** Positive revision; every durable mutation increments it. */
  readonly revision: number
}
```

持久阶段回答目标发生了什么。进程本地激活状态则另行回答续跑消费方能否开始另一个 Round。

```ts type-equiv
/** Durable continuation phase. Activation is process-local and separate. */
type GoalPhase =
  | 'active'
  | 'paused'
  | 'blocked'
  | 'complete'
```

阻塞是唯一表示「因问题而停止」的持久状态。由策略负责的阻塞原因会携带一个用于路由、稳定且采用 lower-kebab-case 的代码，以及一段供人和模型阅读的自由文本说明。

```ts type-equiv
/** Machine-routable and human-readable explanation for a blocked goal. */
interface GoalBlockReason {
  /** Stable lower-kebab-case classification chosen by the blocking policy. */
  readonly code: string
  /** Non-empty explanation shown to humans and models. */
  readonly message: string
}
```

```ts type-equiv
/** Full durable state written by every non-clear goal mutation. */
interface GoalSnapshot extends GoalRef {
  /** Human-requested completion objective. */
  readonly objective: string
  /** Durable lifecycle phase. */
  readonly phase: GoalPhase
  /** Present exactly while `phase` is `blocked`. */
  readonly blockedReason?: GoalBlockReason
  /** Total admitted goal-round cap. */
  readonly maxGoalRounds: number
}
```

```ts type-equiv
/** Current goal projection, including values derived from the session log. */
interface GoalView extends GoalSnapshot {
  /** Highest admitted round number for this goal. */
  readonly roundsStarted: number
  /** Epoch milliseconds of the create mutation. */
  readonly createdAt: number
  /** Epoch milliseconds of the latest mutation. */
  readonly updatedAt: number
  /** Process-local continuation eligibility; never persisted. */
  readonly activation: GoalActivation
}
```

服务还会在不改变持久状态的情况下发布进程本地 activation 边沿；客户端消费该事件获得实时状态。

```ts type-equiv
/** Live process-local activation update forwarded to UI clients. */
interface GoalActivationChanged {
  /** Session whose live goal activation changed. */
  readonly sessionId: SessionId
  /** Current exact activation, absent when no goal is current. */
  readonly goal?: {
    /** Exact current goal identity. */
    readonly id: GoalId
    /** Exact current goal revision. */
    readonly revision: number
    /** Current process-local continuation state. */
    readonly activation: GoalActivation
  }
}
```

## 持久变更

每次变更都是持久的 `goal/change` 会话事件，其载荷要么是变更后的完整快照，要么是清除墓碑。严格折叠与持久投影只从这些事件派生生命周期状态；inbox 变更不会影响 goal 状态。

```ts type-equiv
/** Full-snapshot goal mutation committed by a durable `goal/change` event. */
interface GoalSnapshotChangeMeta {
  readonly kind: 'goal/change'
  readonly version: 1
  readonly operation: Exclude<GoalOperation, 'clear'>
  readonly goal: GoalSnapshot
  readonly roundsStarted: number
  readonly createdAt: number
  readonly updatedAt: number
}
```

```ts type-equiv
/** Tombstone retained when the current goal is cleared. */
interface GoalClearChangeMeta {
  readonly kind: 'goal/change'
  readonly version: 1
  readonly operation: 'clear'
  readonly cleared: GoalRef
  readonly clearedAt: number
}
```

续跑消费方会为每个获准的用户消息轮次标注正数且连续的 Round 编号和当前修订号；只有这些获准的 `user/message` 事件会推进 `roundsStarted`。回放会拒绝非正数 Round、编号缺口、陈旧修订号、已停止阶段和超出上限。

```ts type-equiv
/** Message attribution for admitted continuation rounds. */
interface GoalMessageSource {
  readonly kind: 'goal'
  readonly goalId: GoalId
  readonly revision: number
  /** Positive admitted continuation round. */
  readonly round: number
}
```

## 请求与通知

创建操作会区分调用方省略字段与采用部署配置值这两种情况，`create()` 会在内部解析后者。编辑是局部替换，其运行时校验器要求至少提供一个字段。每条变更通知都会携带获准的操作和确切修订号；清除操作不带 `goal`。

```ts type-equiv
/** Input whose omitted round cap is resolved by the service configuration. */
interface CreateGoalRequest {
  readonly objective: string
  readonly maxGoalRounds?: number
}
```

```ts type-equiv
/** Fields changed by an edit; at least one must be present. */
interface EditGoalRequest {
  readonly objective?: string
  readonly maxGoalRounds?: number
}
```

```ts type-equiv
/** Live notification after one durable goal mutation commits. */
interface GoalChanged {
  readonly operation: GoalOperation
  readonly ref: GoalRef
  /** Absent for a clear tombstone. */
  readonly goal?: GoalView
}
```

## 服务行为

[`GoalService`](../../packages/goal/goal/src/index.ts) 解析创建默认值、从可选注册的 `goal` 投影读取严格回放结果、校验传入的 agent（智能体）是注册表中的确切活跃实例、以比较并设置方式执行变更，并发出 `goal/changed` 通知；监听器故障会被隔离。注册表或 key 缺失时，第一次依赖它们的访问会失败。包 [README](../../packages/goal/goal/README.zh.md) 定义可调用 API 和面向模型的约定。

## 工作检查点与交接

工作交接独立于 goal 完成状态，保留未完成执行。[工作交接服务](../../packages/goal/work-handoff/README.zh.md)负责保存、持久化确认与明确续行；其 `workHandoff` 投影提供最新 `WorkHandoffView` 或 null。检查点报告区分模型撰写的声明与有界的已记录证据。

```ts type-equiv
/** Identity of one immutable unfinished-work capture. */
type WorkHandoffId = Branded<'WorkHandoffId'>
```

```ts type-equiv
/** Why unfinished work needs an explicit continuation decision. */
type WorkStopReason =
  | 'todo-limit' | 'goal-budget' | 'output-limit' | 'error' | 'cancelled'
  | 'paused' | 'waiting' | 'legacy-confirmation'
```

```ts type-equiv
/** Model-authored progress facts; validation evidence remains separate from completion claims. */
interface WorkCheckpoint {
  readonly summary: string
  readonly completed: string[]
  readonly remaining: { task: string; nextActions: string[]; references: string[] }[]
  readonly validation: { command: string; result: 'passed' | 'failed' | 'unknown'; evidence: string[] }[]
  readonly blockers: string[]
}
```

```ts type-equiv
/** Exact goal revision and allowance captured with a handoff. */
interface WorkHandoffGoal {
  readonly id: GoalId
  readonly revision: number
  readonly objective: string
  readonly roundsStarted: number
  readonly maxGoalRounds: number
}
```

```ts type-equiv
/** Latest captured handoff served directly to clients; saving acknowledges this exact id. */
interface WorkHandoffView {
  readonly id: WorkHandoffId
  readonly sourceSessionId: SessionId
  readonly turn: number
  readonly reason: WorkStopReason
  readonly status: 'work-remains' | 'waiting' | 'paused' | 'budget-exhausted'
  readonly objective: string
  /** Source event containing the full human objective when its host preview is bounded. */
  readonly objectiveSeq?: SessionSeq | undefined
  readonly markdown: string
  readonly saved: boolean
  readonly goal?: WorkHandoffGoal | undefined
  readonly todos: TodoItem[]
  readonly attachment?: FileAttachmentRef | undefined
  readonly exportError?: string | undefined
}
```

```ts type-equiv
/** Capture inputs resolved by the owning service; omitted snapshots use its current domain readers. */
interface WorkCaptureRequest {
  readonly reason: WorkStopReason
  readonly goal?: WorkHandoffGoal
  readonly todos?: TodoItem[]
  readonly signal?: AbortSignal
  /** Consecutive repairs and stronger-guidance threshold; `limit` does not cap task continuation. */
  readonly todoRepairs?: { readonly attempts: number; readonly limit: number }
  /** Recorded host policy explanation for stopping, separate from model-authored blockers. */
  readonly stopDetail?: string
}
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxgoals--goalservice"></a>

### `ctx.goals` — `GoalService`

Goal service (`ctx.goals`) backed exclusively by the owning session log.

```ts cordis-catalog
/**
 * Read the current goal for one exact live agent.
 * @param agent - owning live agent.
 * @returns a fresh view or `undefined` when no goal is current.
 * @throws {@link GoalError} when the agent is not the registry's live instance.
 */
@Remote('get') get(agent: Agent): GoalView | undefined

/**
 * Remove process-local continuation authority without changing durable goal
 * phase or revision. Lifecycle owners use this before unloading a driver;
 * a later human-authorized {@link resume} records the new activation edge.
 * @param agent - owning live agent.
 * @returns a fresh disarmed view, or `undefined` when no goal is current.
 */
disarm(agent: Agent): GoalView | undefined

/**
 * Create and arm a goal. A completed goal may be replaced; every other
 * current phase must be cleared or resumed instead.
 * @param agent - owning live agent.
 * @param request - objective and optional round cap.
 * @returns the created live view.
 */
create(agent: Agent, request: CreateGoalRequest): GoalView

/**
 * Edit objective and/or round cap without changing phase.
 * @param agent - owning live agent.
 * @param ref - expected current revision.
 * @param request - at least one replacement field.
 * @returns the edited view.
 */
@Remote('edit') edit(agent: Agent, ref: GoalRef, request: EditGoalRequest): GoalView

/**
 * Pause an active goal and disarm automatic continuation.
 * @param agent - owning live agent.
 * @param ref - expected current revision.
 * @returns the paused view.
 */
@Remote('pause') pause(agent: Agent, ref: GoalRef): GoalView

/**
 * Resume and arm a stopped goal, or rearm an active goal after a
 * session-start edge, while its round budget still has capacity.
 * @param agent - owning live agent.
 * @param ref - expected current revision.
 * @returns the active view.
 */
@Remote('resume') resume(agent: Agent, ref: GoalRef): GoalView

/**
 * Mark a current non-complete goal complete and disarm it.
 * @param agent - owning live agent.
 * @param ref - expected current revision.
 * @returns the completed view.
 */
@Remote('complete') complete(agent: Agent, ref: GoalRef): GoalView

/**
 * Mark an active goal blocked and disarm it.
 * @param agent - owning live agent.
 * @param ref - expected current revision.
 * @param reason - policy-owned stable code and human-readable explanation.
 * @returns the blocked view with its durable reason.
 */
block(agent: Agent, ref: GoalRef, reason: GoalBlockReason): GoalView

/**
 * Clear the current goal while retaining a durable tombstone and history.
 * @param agent - owning live agent.
 * @param ref - expected current revision.
 * @returns the tombstone ref whose revision is one past the cleared snapshot.
 */
@Remote('clear') clear(agent: Agent, ref: GoalRef): GoalRef

/**
 * Create one Goal through the remote boundary.
 * @param agent - exact live Agent resolved from the wire identity.
 * @param request - objective and optional round cap.
 * @returns the created Goal identity.
 */
@Remote('create') remoteExportCreate(agent: Agent, request: CreateGoalRequest): CreateGoalResult
```

Types: [Agent](core.zh.md)

Source: [`packages/goal/goal/src/index.ts`](../../packages/goal/goal/src/index.ts)

<a id="ctxworkhandoffs--workhandoffservice"></a>

### `ctx.workHandoffs` — `WorkHandoffService`

Owns handoff persistence; model requests remain with the ordinary Agent runtime.

```ts cordis-catalog
/** Read the latest detached handoff without storage I/O.
 * @param session - Prepared source Session.
 * @returns Latest handoff or null after explicit continuation.
 */
viewOf(session: Session): WorkHandoffView | null

/** Read a prepared Agent's latest handoff.
 * @param agent - Source Agent resolved from its Session identity.
 * @returns Latest projected handoff.
 */
@Remote('get') get(agent: Agent): WorkHandoffView | null

/** Save a model-authored checkpoint with explicit unverified claims and evidence.
 * @param agent - Calling live Agent.
 * @param checkpoint - Complete structured progress report.
 */
checkpoint(agent: Agent, checkpoint: WorkCheckpoint): void

/** Capture unfinished work exactly once for the same stopped turn and allowance.
 * @param agent - Source Agent whose current work is captured.
 * @param request - Stop cause and optional authoritative domain snapshots.
 * @returns Saved handoff; storage failures reject without a saved acknowledgement.
 */
capture(agent: Agent, request: WorkCaptureRequest): Promise<WorkHandoffView>

/** Recover already authorized unfinished work through one shared idle maintenance operation.
 * @param agent - Live owner whose idle inbox may receive automatic recovery input.
 * @param signal - Caller lifetime; unloading leaves existing authorization unchanged.
 * @returns Whether one durable-checkpointed recovery input was queued.
 */
recoverTodos(agent: Agent, signal?: AbortSignal): Promise<boolean>

/** Explicitly authorize this Session's current task list and queue one continuation.
 * @param agent - Agent selected by the user action.
 * @returns Completion after authorization and durable input admission.
 */
@Remote('resumeTodos') async resumeTodos(agent: Agent): Promise<void>

/** Start one fresh Session from an explicitly selected saved handoff.
 * @param agent - Source Agent whose restrictions and composition are retained.
 * @param id - Exact saved handoff selected by the user.
 * @returns The new Session identity; duplicate clicks share one creation.
 */
@Remote('continueInNewSession') continueInNewSession(agent: Agent, id: WorkHandoffId): Promise<{ sessionId: SessionId }>
```

Types: [Agent](core.zh.md) · [Session](session.zh.md) · [SessionId](core.zh.md)

Source: [`packages/goal/work-handoff/src/index.ts`](../../packages/goal/work-handoff/src/index.ts)

<a id="goal-events"></a>

### `goal/*` events

<a id="goalactivation-changed--emit"></a>

#### `goal/activation-changed` — emit

Process-local goal activation changed for one session.

```ts cordis-catalog
/**
 * Process-local goal activation changed for one session.
 * @mode emit
 * @param payload - session id and the exact current goal activation, or no goal after a clear.
 */
'goal/activation-changed'(payload: GoalActivationChanged): void
```

Source: [`packages/goal/goal/src/types.ts`](../../packages/goal/goal/src/types.ts)

<a id="goalchanged--emit"></a>

#### `goal/changed` — emit

Goal mutation accepted by one live agent. The matching `goal/change` session event has already committed. Listener failures are contained. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.

```ts cordis-catalog
/**
 * Goal mutation accepted by one live agent. The matching `goal/change`
 * session event has already committed. Listener failures are contained.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @param payload.agent - agent whose session owns the goal.
 * @param payload.change - fresh current projection or clear tombstone.
 * @mode emit
 */
'goal/changed'(this: import('@deepseek-ai/dsh-scope').Scoped<Agent>, payload: { agent: Agent; change: GoalChanged }): void
```

Types: [Agent](core.zh.md) · [Scoped](scope.zh.md)

Source: [`packages/goal/goal/src/domain.ts`](../../packages/goal/goal/src/domain.ts)
<!-- END GENERATED cordis-surface -->
