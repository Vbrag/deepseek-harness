---
description: "The model-facing todo_write tool over the DeepSeek Harness session log: whole-list replacement, per-session ownership, and the todos projection, for users and maintainers choosing, configuring, or debugging the tool."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-todo

English | [中文](README.zh.md)

## Summary

`dsh-tool-todo` gives the agent a structured task list to plan with: break multi-step work into concrete tasks, mark the task you are working on, and check tasks off as they finish. The list survives across turns and reopened sessions, so the agent and the UI always see the latest plan. One configuration flag decides whether several tasks may be in progress at once, for agents that run work in parallel. Use it wherever an agent should keep a visible task list; each update replaces the whole list, and only the owning agent session can change it.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Use this package when you want the agent to maintain a visible task list while it works: plan multi-step work, show what is active, and record completion. Configure the parallelism flag and mount the tool in its owning profile or Agent preset; the agent updates the complete list whenever the plan changes.

### When to choose it

Choose it when one agent session should own the task list and whole-list updates are fine — the common shape for planning tools. Avoid it when several agents must share one list or when you need per-item edits: the list belongs to one agent and every update replaces the whole list. It needs an agent session to exist at all; automation-only surfaces that never run an agent cannot use it.

### Minimal configuration

`allowParallelInProgress` is required with no default: a composition that omits it fails at load, and a non-boolean value is rejected. Set `true` for agents that may run work concurrently (subagents, background commands, workflow fan-out) and `false` for the single-active discipline.

```yaml
- name: '@deepseek-ai/dsh-tool-todo'
  config:
    allowParallelInProgress: true
```

An isolated Agent preset adds `isolate: { todoPolicy: true }` to this row. The policy service belongs to that retained preset revision; host consumers resolve it through `agentPresets.serviceFor(agent, 'todoPolicy')`. A global profile row does not need isolation.

| Field | Default | Meaning |
|---|---|---|
| `allowParallelInProgress` | required | Whether several todos may be `in_progress` at once; also selects the active-status clause of the model description |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-todo) is the exhaustive source for the accepted field.

### What each call does

The agent sends the ENTIRE list on every update; the new list replaces the previous one, so there are no partial updates or per-item edits. Each item is a short task description plus a status of `pending`, `in_progress`, or `completed`. A successful update returns the new counts — `Updated todo list: <pending> pending, <inProgress> in progress, <completed> completed.` — and the UI shows the new plan. Updates fail visibly when a task description is empty or duplicated, when an item carries fields beyond the description and status, or — when parallel work is disabled — when more than one task is marked in progress.

### Execution and proposals

A new nonempty list must declare `purpose: current-task` for authorized execution or `purpose: proposal` for planning only. Updates preserve that purpose. Older persisted lists remain unclassified until a human chooses Continue; a model cannot activate them by assigning a purpose. `disposition: paused` or `waiting` requires a concrete `reason` and retains unfinished items. The [continuation driver](../todo-reconcile-driver/README.md) uses this policy to repair premature model stops; recording a proposal does not authorize execution.

A fork keeps the portable parent list in its history, while execution authority and repair accounting start with the child's first own purpose-bearing list. The exact inherited event count determines that separation and remains effective after resume.

### Single owner

The task list belongs to the one agent session that created it — subagents and other agents each keep their own list, and there is no way to share a list between agents. A call from outside an agent session is rejected, so the agent learns the update failed instead of silently writing nowhere. If you need a list shared across agents, this package does not provide it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the tool and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The tool is built on four commitments:

- **Whole-list replace, log-backed state.** The model resends the entire list; the `todo/write` snapshot lives on the event-sourced session log, so durability, replay, and resume reconstruction come from the log rather than a service.
- **Single owner.** The list belongs to the calling agent session; there is no shared or swarm scope, and non-agent callers are rejected.
- **Deployment policy, not a coded rule.** `allowParallelInProgress` is a required composition choice because the tool cannot observe runtime concurrency.
- **Validation keeps the logged snapshot honest.** Schema-level rejection of unknown keys and `execute`-level rejection of empty or duplicate content keep the durable snapshot equal to what the model believes it wrote.

The [todo_write tool Agent Note](../../../.agents/notes/archived/feature/2026-06-29-todo-write-tool.md) records the original design and alternatives; the [parallel in-progress Agent Note](../../../.agents/notes/archived/feature/2026-07-26-todo-parallel-in-progress.md) records the policy decision.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: configuration and tool registration |
| [`src/types.ts`](src/types.ts) | The one home of the `todos` projection-key declaration and its payload types |
| [`src/policy.ts`](src/policy.ts) | Durable purpose, suspension, and no-progress allowance; explicit human Continue API |
| [`src/client.ts`](src/client.ts) | Client-namespace re-export of the types outlet |

### Export shape

The plugin is a function/namespace plugin: it exports `name` / `inject` / `apply` and no default export. A stray `export default` would make the Loader's `unwrapExports` collapse the module and drop `inject` (see [postmortem 0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)).

### Session projection

The package requires [`@deepseek-ai/dsh-session-projection`](../../session/session-projection/README.md). Its policy service owns the `todos` and `todoPolicy` projections. The list is the latest whole `todo/write`, `null` before its first write, and persists until an explicit empty write or `/todo clear`. Carriers serve the values on the history tail and projection updates; host consumers read through `ctx.todoPolicy`.

### Call mechanics

Each call validates the submitted list against the schema, rejects incoherent input, and on success appends the full snapshot as a `todo/write` session event and returns the new counts; the current list is always the most recent `todo/write` in the log (last-write-wins on replay). See [src/index.ts](src/index.ts) for the exact validation and append steps.

Purpose and accounting use a separate `todo/policy` event and projection. `ctx.todoPolicy.continueTask(agent)` records human authorization and resets the repair counter; its caller queues continuation. The completed-item high-water mark only advances when the completed count strictly increases, so toggling statuses or adding unfinished items cannot reset the repair counter. Cancellation, errors, and output limits durably pause an active execution list through its terminal turn event. The host service is available from the `./policy` leaf; browser consumers use types from `./client`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the session subsystem to the generated catalogs and the decision records behind the tool.

- [Todo subsystem](../../../docs/subsystems/todo.md) — the `todo/write` event payload, ownership rules, and `TodoItem`.
- [todo group map](../README.md) — the sibling group page and its package table.
- [Generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-todo) — the `todo_write` schema the model receives.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-todo) — every accepted config field and its source declaration.
- [todo_write tool Agent Note](../../../.agents/notes/archived/feature/2026-06-29-todo-write-tool.md) — the original design, alternatives, and dropped fields.
- [parallel in-progress Agent Note](../../../.agents/notes/archived/feature/2026-07-26-todo-parallel-in-progress.md) — why the active-count cap is a deployment policy.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`todo_write` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-todo), including the complete `todos` list and the purpose and suspension fields. The description distinguishes authorized execution from proposed plans and instructs the model to record a concrete reason for a pause or wait. The active-status clause follows `allowParallelInProgress`.

#### Token effect

Fixed schema cost on every request where the tool is visible; the description and schema are stable for a given configuration.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse from this schema.

### Tool-call history and result

#### What the model sees

Each assistant tool call retains the entire replacement list in its arguments. Success returns exactly `Updated todo list: <pending> pending, <inProgress> in progress, <completed> completed.` An explicit empty list (`todo_write(todos: [])`) is the model-facing clear: it empties the list and returns `0 pending, 0 in progress, 0 completed`. Stable failures are `Error: invalid arguments: todos[<i>].content must be a non-empty string`, `Error: invalid arguments: todos[<i>].content duplicates "<content>"`, and — only where the deployment set `allowParallelInProgress: false` — `Error: invalid arguments: at most one task may be in_progress (got <n>)`, all `ToolArgsError` `INVALID_ARGS`, plus `Error: todo_write requires an owning agent session` as `ToolContextUnavailableError` `TOOL_CONTEXT_UNAVAILABLE`. The full `todo/write` session event is UI and replay state, not a second model message.

#### Token effect

Token growth scales with every full list the model submits, and those call arguments remain until compaction. The result itself is small and fixed-shape.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the tool is a poor fit. They are current package constraints, not a task backlog.

- **Single-owner scope only** — the list belongs to the one calling agent session; subagent, shared, and swarm scopes are a deliberate cut, and a non-agent caller is rejected.
- **The item shape is deliberately minimal** — `content` plus three-state `status`; whole-list replacement needs no stable id, priority, or active-form fields.
- **Whole-list replacement is the only operation** — no partial updates, no read-back tool, and no per-item edits; the model must resend the entire list each call.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

#### Future: cross-agent and shared lists

The single-owner scope is a deliberate cut, and cross-agent or shared lists remain a separate future design: they would need per-item log deltas and explicit scope selection, and would change the model-visible contract. No design exists yet.

</details>
