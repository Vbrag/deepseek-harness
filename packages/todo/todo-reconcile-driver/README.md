---
description: "The one-shot resume todo reconciliation for users and maintainers choosing, composing, or debugging automated reconcile on a persisted task list."
kind: "package-reference"
---

# @deepseek-ai/dsh-todo-reconcile-driver

English | [中文](README.zh.md)

## Summary

`dsh-todo-reconcile-driver` reconciles a persisted to-do list when a session is resumed or restarted with work still outstanding. The `dsh-tool-todo` list survives across turns and restarts; when the harness re-opens a session that carries a non-empty list and a current goal, this driver issues **one** model prompt presenting the persisted list plus the goal state and asks the model to reconcile the statuses via `todo_write` — instead of asking the human to re-derive the plan. It takes no configuration. Mount it beside `dsh-tool-todo` and `dsh-goal` so a recovered plan keeps its statuses honest and the model can pick up the next step.

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

Mount `dsh-todo-reconcile-driver` when a resumed session should reconcile its persisted plan against completed work without a human prompt. It composes with the todo tool and the goal service: `dsh-tool-todo` owns the list, `dsh-goal` owns the durable goal, and this package reads both to schedule one reconcile.

### Compose it

Mount the driver beside the todo tool and the goal service; the driver itself takes no configuration.

```yaml
- id: tool-todo
  name: '@deepseek-ai/dsh-tool-todo'
  config:
    allowParallelInProgress: true

- id: todo-reconcile-driver
  name: '@deepseek-ai/dsh-todo-reconcile-driver'
```

The goal service is required so the driver can read the current goal; a composition with the driver but no goal simply never reconciles (there is nothing to anchor the plan to).

### When a reconcile occurs

On `agent/created` with source `resume` (a persisted reload) or `startup` (a fresh session), when both conditions hold — the persisted `todos` projection is a non-empty list, and a current goal exists — the driver queues exactly one `<todo_reconcile>` prompt. It names the JSON-quoted objective, goal phase, and round budget, lists each persisted item with its status, summarizes done vs remaining, and instructs the model to inspect the workspace and durable session state, then call `todo_write` once with the reconciled whole list. A subsequent `todo_write` from the model lands in the `todos` projection as the new durable plan.

### When reconcile does not happen

The driver stays silent when the list is empty, when there is no current goal, when the source is `clear` or `compact`, and on any later turn in the same lifecycle — it never re-arms after the single admission. A human message already queued when the driver reaches idle withdraws the reconcile reservation so the human's input runs first; a reconcile prompt still queued at idle is removed from the inbox. The driver is best-effort one-shot: if the model call or the write fails, it logs and disarms rather than retrying in a loop.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the driver schedules reconcile without races; the observable behavior is covered in [Use this package](#use-this-package).

### Design

- **Reading, not re-owning.** The driver does not register its own `todos` projection unit — `dsh-tool-todo` already owns that key, and a second registration would be refused. Instead it reads the projected value with `ctx.sessionProjections.snapshot(session).values['todos']` and the current goal with `ctx.goals.get(agent)`.
- **One-shot admission.** The `agent/created` listener marks a session reconcile-pending; the serialized driver loop admits at most one reservation per session lifecycle and never re-arms on later turns.
- **Race fences.** The `agent/pre-step` listener verifies the complete claimed record is still the driver's own before and after downstream listeners, so a stale, cancelled, or competing prompt is rejected before its step enters. Human work arriving first makes the driver yield.
- **Durability checkpoint.** Before queuing, the driver awaits `ctx.sessions.flush()` and rechecks the goal and competing input after the await, so the reconcile runs against a stable log.
- **Fail-closed teardown.** Teardown closes admission, cancels active work with the `parent` cause, and awaits the driver plus agent quiescence while its event fence remains installed.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: driver state machine, race fences, teardown |
| [`src/prompt.ts`](src/prompt.ts) | The retained `<todo_reconcile>` prompt |

### The reconcile prompt

The retained prompt is one text block: the JSON-quoted objective, phase, and `roundsStarted/maxGoalRounds` lines, then the persisted task list with statuses, a done-vs-remaining summary, and the explicit reconcile instruction.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

The driver reads two projected domains and defers list policy to `dsh-tool-todo`; read these pages for the surrounding contract.

- [Todo tool](../tool-todo/README.md) — the persisted list this driver reconciles.
- [Goal service](../../goal/goal/README.md) — the durable goal state this driver anchors the plan to.

-----

<a id="model-experience"></a>
## Model Experience

### Reconcile prompt

#### What the model sees

Each admitted reconcile is one retained user-role `<todo_reconcile>` block naming the full objective, goal phase, round budget, the persisted list with statuses, and the done-vs-remaining summary, ending with the instruction to call `todo_write` once with the reconciled whole list. Earlier human messages, goal-state snapshots, assistant output, and tool records remain in the same session history.

#### Token effect

One fixed instruction block plus the objective and the persisted list is added per admitted reconcile. Later requests resend the retained prompt until compaction shadows it; no fresh agent or copied conversation prefix is created.

#### KV Cache effect

Append-only within an epoch: an admitted reconcile extends the existing conversation after its reusable prefix. Compaction may replace the derived-history suffix and move the reusable boundary.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the driver is a poor fit. They are current package constraints, not a task backlog.

- **Requires a goal** — reconciliation is anchored to a current goal; a persisted list without a goal never triggers a prompt. The goal itself is not created or resumed by this package.
- **Best-effort one-shot** — a failed reconcile is logged and disarmed, not retried; a transient model or persistence failure needs a later human-authorized resume.
- **No goal re-arm** — after restart an active goal stays disarmed until explicit resume; this driver only reads it, it never revives continuation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers; it is explicitly non-authoritative. Open, undecided directions: an abnormal-failure retry policy for the single reconcile and a cross-goal reconcile that does not require a current goal; both stay outside this package by design.

</details>
