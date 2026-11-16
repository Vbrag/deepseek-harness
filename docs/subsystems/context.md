# Project context

English | [中文](context.zh.md)

The [project-context package](../../packages/context/project-context/README.md) owns turn-end documentation assessment and guarded updates; [agent-instructions](../../packages/context/agent-instructions/README.md) owns instruction discovery and refresh. Task completion and documentation status remain separate.

## Assessment and document updates

The status records identify the root turn and the last normal-work event assessed. Original observed files retain their versions and contents before replacement. These records support recovery without granting another session permission to write.

```ts type-equiv
/** State of one root turn's project-document assessment. */
type ProjectContextStatus = 'pending' | 'updating' | 'updated' | 'unchanged' | 'deferred' | 'failed'
```

```ts type-equiv
/** Latest project-document assessment, independent of task or goal completion. */
interface ProjectContextView {
  readonly sourceTurn: number
  /** Last normal-work record assessed; maintenance activity does not advance it. */
  readonly knowledgeWatermark: SessionSeq
  readonly status: ProjectContextStatus
  readonly root?: string | undefined
  readonly contextPath?: string | undefined
  readonly summary?: string | undefined
  readonly reason?: string | undefined
}
```

```ts type-equiv
/** Exact file content and freshness token admitted to one maintenance phase. */
interface ProjectContextDocument {
  readonly path: string
  readonly version: FsVersion | null
  readonly content: string
}
```

```ts type-equiv
/** Durable original document retained before a guarded edit or forwarding replacement. */
interface ProjectContextDocumentObserved {
  readonly sourceTurn: number
  readonly root: string
  readonly document: ProjectContextDocument
}
```

```ts type-equiv
/** One exact replacement in an observed primary project guide. */
interface ProjectContextGuideUpdate {
  readonly path: string
  readonly oldText: string
  readonly newText: string
}
```

```ts type-equiv
/** An observed duplicate guide whose complete original content may become a forwarding stub. */
interface ProjectContextForwardingStub {
  readonly path: string
  readonly oldText: string
}
```

```ts type-equiv
/** Validated model assessment and requested project-document changes. */
interface ProjectContextUpdateRequest {
  readonly outcome: 'updated' | 'unchanged' | 'deferred'
  readonly summary: string
  readonly context?: string | undefined
  readonly guideUpdates?: ProjectContextGuideUpdate[] | undefined
  readonly forwardingStubs?: ProjectContextForwardingStub[] | undefined
}
```

```ts type-equiv
/** Actual outcome and changed files returned by the guarded writer. */
interface ProjectContextUpdateResult {
  readonly outcome: 'updated' | 'unchanged' | 'deferred'
  readonly summary: string
  readonly contextPath: string
  readonly changedPaths: string[]
}
```

```ts type-equiv
/** Attribution for logged assessment requests and correction reminders. */
interface ProjectContextMessageSource {
  readonly kind: 'project-context'
  readonly sourceTurn: number
}
```

```ts type-equiv
/** Bounded replay state; inherited history never transfers maintenance authority. */
interface ProjectContextState {
  readonly view: ProjectContextView | null
  readonly root: boolean
  readonly inheritedEventCount: number
}
```

```ts type-equiv
/** Deployment limit for each persisted maintenance label and diagnostic. */
interface ProjectContextProjectionConfig {
  readonly maxTextChars: number
  readonly maxSourceBytes: number
}
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxprojectcontext--projectcontextservice"></a>

### `ctx.projectContext` — `ProjectContextService`

Owns discovery, logged original documents, and one write queue per project filesystem.

```ts cordis-catalog
/** Read detached projected maintenance status without filesystem I/O.
 * @param session - Prepared Session whose latest root turn is displayed.
 * @returns Latest assessment or null before the first root turn.
 */
viewOf(session: Session): ProjectContextView | null

/** Whether this live lead Agent is in its current turn's document phase.
 * @param agent - Model-tool owner being admitted.
 * @returns True only for the active root turn and retained filesystem preparation.
 */
activeOf(agent: Agent): boolean

/** Prepare or remind the current root turn's ordinary project-document step.
 * @param agent - Lead Agent already at its normal stopping boundary.
 * @param turn - Current source turn; newer work invalidates preparation.
 * @param signal - Current turn and caller cancellation.
 * @returns Whether one logged maintenance input was queued.
 */
prepare(agent: Agent, turn: number, signal: AbortSignal): Promise<boolean>

/** Read exact complete project documents for a guarded maintenance request.
 * @param agent - Active lead Agent whose phase owns the observations.
 * @param paths - Explicit project-relative Markdown files; no recursive discovery.
 * @param signal - Ordinary tool cancellation.
 * @returns Complete logged original contents and freshness tokens.
 */
readDocuments(agent: Agent, paths: readonly string[], signal: AbortSignal): Promise<ProjectContextDocument[]>

/** Publish a model's explicit assessment through the project's shared write queue.
 * @param agent - Active lead Agent admitted by the ordinary tool pipeline.
 * @param request - Bounded assessment and exact observed guide replacements.
 * @param signal - Ordinary tool cancellation.
 * @returns Actual terminal assessment and the paths successfully changed.
 */
executeUpdate(agent: Agent, request: ProjectContextUpdateRequest, signal: AbortSignal): Promise<ProjectContextUpdateResult>
```

Types: [Agent](core.md) · [Session](session.md)

Source: [`packages/context/project-context/src/index.ts`](../../packages/context/project-context/src/index.ts)

<a id="agent-instructions-events"></a>

### `agent-instructions/*` events

<a id="agent-instructionsdiscovery--bail"></a>

#### `agent-instructions/discovery` — bail

Read the instruction loader selected by the requesting Agent's scope.

```ts cordis-catalog
/**
 * Read the instruction loader selected by the requesting Agent's scope.
 * @param payload.agent - Agent whose loader must admit the written project file.
 * @returns active discovery settings, or undefined when no loader is mounted.
 * @mode bail
 */
'agent-instructions/discovery'(this: Scoped<Agent>, payload: { agent: Agent }): AgentInstructionDiscovery | undefined
```

Types: [Agent](core.md) · [Scoped](scope.md)

Source: [`packages/context/agent-instructions/src/discovery.ts`](../../packages/context/agent-instructions/src/discovery.ts)
<!-- END GENERATED cordis-surface -->
