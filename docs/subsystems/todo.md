# Todo

English | [中文](todo.zh.md)

The durable todo vocabulary owned by [`@deepseek-ai/dsh-tool-todo`](../../packages/todo/tool-todo/README.md). The model-facing tool replaces one agent session's whole list; the package also owns the event declaration and replay projection. Tool behavior and configuration are on the [package README](../../packages/todo/tool-todo/README.md).

Source: [`packages/todo/tool-todo/src/types.ts`](../../packages/todo/tool-todo/src/types.ts)

## `TodoItem` — one list entry

```ts type-equiv
/**
 * One entry in an agent's todo list — the unit of the `todo/write`
 * whole-list snapshot declared by this package.
 *
 * Deliberately minimal: a human-readable `content` line and a three-state
 * `status`. No id, priority, or `activeForm` — the list is replaced wholesale
 * on every write (last-write-wins), so entries need no stable identity. The
 * three statuses describe the complete portable lifecycle needed by model and
 * UI consumers.
 */
interface TodoItem {
  /** What this task is — a short imperative line shown in the UI. */
  content: string
  /** Lifecycle state. `in_progress` marks a task being worked now; parallel work may mark several. */
  status: 'pending' | 'in_progress' | 'completed'
}
```

## List purpose and continuation

List purpose separates authorized execution from proposals. The whole-value policy retains suspension and repair accounting independently of the portable todo list; a legacy list requires explicit human confirmation.

```ts type-equiv
/** Whether a newly authored list describes execution or a proposed plan. */
type TodoListPurpose = 'current-task' | 'proposal'
```

```ts type-equiv
/** Durable execution state; historical `limit` records remain automatically recoverable. */
type TodoDisposition = 'active' | 'paused' | 'waiting' | 'limit'
```

```ts type-equiv
/** Durable continuation policy; legacy lists require explicit human confirmation. */
interface TodoPolicyView {
  readonly purpose: TodoListPurpose | 'legacy'
  readonly disposition: TodoDisposition
  readonly completedHighWater: number
  readonly repairAttempts: number
  readonly reason?: string
}
```

```ts type-equiv
/** Attribution for logged current-task recovery and same-turn repair input. */
interface TodoReconcileMessageSource {
  readonly kind: 'todo-reconcile'
}
```

## Durable event

The package declaration-merges `todo/write: { todos: TodoItem[] }` into `SessionEventMap`. The event is log-only and carries the complete replacement list; the generated [persistence catalog](../persistence-catalog.md#todowrite--log-only) records its declaration site.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxtodopolicy--todopolicyservice"></a>

### `ctx.todoPolicy` — `TodoPolicyService`

Owns durable list classification, human continuation, and no-progress accounting.

```ts cordis-catalog
/**
 * Read the current complete list without exposing projection-owned values.
 * @param session - Session owning the list.
 * @returns detached items, or an empty list before creation and after clearing.
 */
listOf(session: Session): TodoItem[]

/**
 * Read a detached current list policy.
 * @param session - Session owning the list.
 * @returns its policy, or undefined for an absent or empty list.
 */
viewOf(session: Session): TodoPolicyView | undefined

/**
 * Write a validated whole list and its model-supplied classification.
 * @param agent - owner of the list.
 * @param todos - canonical complete replacement list.
 * @param purpose - classification for a new list; updates retain the recorded purpose.
 * @param disposition - explicit active, paused, or waiting choice.
 * @param reason - explanation required by the tool for a suspended list.
 */
writeList(agent: Agent, todos: TodoItem[], purpose?: TodoListPurpose, disposition?: Exclude<TodoDisposition, 'limit'>, reason?: string): void

/**
 * Authorize a list after an explicit human Continue action; this does not queue work.
 * @param agent - exact live owner selected by the human.
 * @returns the reset execution policy.
 */
continueTask(agent: Agent): Promise<TodoPolicyView>

/**
 * Recover existing execution authority without granting approval or resetting repair accounting.
 * @param agent - live owner of the authorized unfinished list.
 * @returns whether current-task execution is active after recovery.
 */
recoverAuthorizedTask(agent: Agent): boolean

/**
 * Suspend a list without removing its unfinished items.
 * @param agent - owner selected by the caller.
 * @param disposition - explicit pause or wait choice.
 * @param reason - explanation retained with that choice.
 * @returns the updated policy, or undefined when no list exists.
 */
suspend(agent: Agent, disposition: 'paused' | 'waiting', reason: string): Promise<TodoPolicyView | undefined>

/**
 * Record one persisted repair attempt immediately before steering.
 * @param agent - current execution owner.
 * @returns the updated policy, or undefined when the list has disappeared.
 */
recordRepair(agent: Agent): TodoPolicyView | undefined

/**
 * Record the historical automatic-stop marker without discarding repair accounting.
 * @param agent - current execution owner.
 */
markLimit(agent: Agent): void
```

Types: [Agent](core.md) · [Session](session.md)

Source: [`packages/todo/tool-todo/src/policy.ts`](../../packages/todo/tool-todo/src/policy.ts)
<!-- END GENERATED cordis-surface -->
