---
description: "Goal surface for the Web GUI: the composer-context strip that shows the current goal and edits, pauses, resumes, or clears it; for users and maintainers of the goal experience."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-goal

English | [中文](README.zh.md)

## Summary

The Web GUI goal surface shows both the durable goal state and its current process-local activation, and lets users edit, pause, resume, or clear the goal; rejected changes appear inline. A separate work strip retains unfinished-work status and handoff actions even without a goal. Project-note maintenance has an independent queued, updating, updated, unchanged, deferred, or failed status. It displays durable `/goal` runs as `Command input` bubbles so commands from users or the model remain visible after reload. Goal creation remains outside this package. Shipped Web presets other than `minimal` make `/goal` available to agents.

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

Mount this plugin alongside `ui-conversation` and the goal domain package; the strip then appears as the second card in the composer-context stack (after Todo, before Queue) whenever the session has a goal. Todo and Goal use the same panel elevation above the composer. The strip orders its actions edit, clear, then pause or resume, matching the Queue rows' edit and remove positions. An armed active goal offers pause, shown disabled until its activation is known; an active-but-disarmed, paused, or blocked goal offers resume; edit rewrites the objective in the ui-primitives `InlineEditor`, so multi-line objectives survive editing; clear removes the goal and suppresses the strip until the projection catches up.

Authorized current-task lists with active or historical limit disposition show `Continuing automatically` while queued or running, with no manual Continue requirement after three reminders. Actual stopped work shows `Work remains`, `Waiting`, `Paused`, or `Paused: round budget exhausted`. Users can copy or download the saved Markdown and explicitly continue in a new session. Proposals show `Proposed work` with an explicit `Approve and continue` action; legacy todos show `Confirmation required` with `Confirm and continue`. Paused and waiting policies retain their labels even without a handoff. Goal-owned handoffs leave same-session resume to the goal controls. Active or pending planning restrictions suppress automatic status and todo continuation actions. Automatic work keeps its status visible; stopped-work actions hide while work is running; an unsaved checkpoint remains exportable and shows a warning, while continuation into a new session is disabled. A turn ending does not establish task completion.

Project notes use a separate status row even without a goal. Queued and updating describe maintenance in progress; updated and unchanged record its assessment; deferred and failed retain the concrete reason. These labels do not assert task completion or offer another continuation action.

### The command-input bubble

Each durable `/goal` run projects as a right-aligned user-style bubble labeled `Command input` (or `指令输入`), rendered before the generic command result row; the leading `/goal` token renders as a command reference chip in the code face through the shared `conversation.user.text` Factory and the Goal-owned `command` renderer, using the executed token range in `facts.commands`, and the objective stays plain body text. It carries no timestamp, copy, or branch actions, and reloading reconstructs it from the run.

### Failures

A rejected mutation surfaces the Remote error inline on the strip; loading, absent, completed, and successfully cleared goals render no goal row. An unfinished-work row remains independent of that goal state, and failed actions retain its checkpoint.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The durable goal arrives through `useProjection('goal')` (seeded by the history tail page and updated by `session/projection` frames). The inject face carries a registrant-private activation hook source plus the four mutation verbs. That source starts only while the framework hook observes it, reads `ctx.remote.goals.get`, subscribes to `goal/activation-changed`, and refreshes on running-state or connection resets. Live-event epochs invalidate in-flight reads, so a stale HTTP result cannot overwrite a newer activation edge; running refreshes retain the last known activation until the read resolves. The strip owns no domain store or cross-plugin cache. Each mutation reads the CAS ref from the session's current projected value at call time, and the RPC's compare-and-set is the staleness guard. The strip single-flights mutations synchronously because a pending render cannot fence same-frame clicks. The command-input projection is a separate Conversation Definition that builds a `command-input` Chat Node before the generic command result Node; it never creates `user/message` or a model turn.

Activation reads hold a temporary `goalActivation` Client reference and send `goals.get` only after that Session's initial history open succeeds. A stale binding or failed open sends no RPC. Rejected reads are logged without changing the projected goal or last known activation; the temporary reference is released when the read settles.

Work state arrives through `useProjection('workHandoff')`, with `todos` providing the legacy unfinished-work signal and the Session snapshot providing running state. Explicit continuation calls the work-handoff Remote; new-session navigation occurs only after that call succeeds. Markdown export uses the shared clipboard and file-action owners.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the goal surface is not enough. They move from the browser strip to the goal domain and the slots it fills.

- [dsh-goal](../../goal/goal/README.md) — the goal domain, projection, and `/goal` command this surface reads and mutates.
- [ui-conversation](../ui-conversation/README.md) — declares the `conversation.input.dock` slot and owns the composer.
- [Client package map](../README.md) — adjacent browser UI packages.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the `goals/edit`, `goals/pause`, `goals/resume`, and `goals/clear` mutations the strip routes; the host GoalService owns the model-visible goal context message those mutations queue.

#### KV Cache effect

None unless the queued goal context is admitted. An admitted context extends the history tail like any other message; an insertion discarded before admission does not affect the cache.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current goal surface. They are current package constraints, not a goal-domain comparison or a task backlog.

- **Preset-independent host state** — switching an active session to `minimal` leaves its host-owned goal intact. `/goal` and goal tools disappear, while this strip can still edit, pause, resume, or clear the goal.
- **No round-budget control** — the strip cannot raise `maxGoalRounds`. Resuming a goal that used every round, such as one paused by its round limit, fails with an inline error; ask the agent to raise the goal's round limit first.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
