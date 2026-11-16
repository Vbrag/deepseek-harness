---
description: "Continue authorized unfinished todo work in the same turn and retain an explicit handoff when execution must stop."
kind: "package-reference"
---

# @deepseek-ai/dsh-todo-reconcile-driver

English | [中文](README.zh.md)

## Summary

`dsh-todo-reconcile-driver` helps an agent finish an authorized task when its final response only promises further work. If a current-task list still has unfinished items, the driver asks the model to continue within the same turn. Proposals remain plans. Explicit pauses, waits, cancellation, output limits, and existing goal control are respected. Repeated stops without net completion receive stronger recovery guidance while authorized work continues.

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

Mount the driver with the todo tool, goal service, and work-handoff service. A current goal is optional; its service is required so the driver can defer to goal continuation and suspension.

Todo and plan-mode services may belong to the Agent's isolated preset. The driver reads the exact retained preset owner; it does not require those services in the host's global context.

```yaml
- name: '@deepseek-ai/dsh-todo-reconcile-driver'
  config:
    maxNoProgressRepairs: 3
```

`maxNoProgressRepairs` is a positive integer, defaulting to three. It selects when stronger logged recovery guidance begins. Every premature ordinary stop continues authorized unfinished work; reaching this threshold requires no human Continue action. A strictly greater completed-item count resets the repair counter. Goal rounds, output limits, explicit suspension, and failures retain their own stopping rules.

New execution lists declare `purpose: current-task`; proposed plans declare `purpose: proposal`. Older unclassified lists require the human Continue action. A model cannot activate a proposal, legacy list, or suspended list by silently changing its purpose or disposition. Opening proposals, legacy lists, and explicitly suspended work does not authorize execution.

Opening an authorized current-task list with active or historical limit disposition resumes it automatically after the work-handoff owner checks durable state and competing work. Existing repair counters are retained. Paused, waiting, proposal, legacy, goal-controlled, plan-controlled, and failed work retain their applicable restrictions. A missing or failed persistence provider stops continuation visibly before another request.

An active goal owns its continuation. Paused or blocked goals remain suspended. A model response ended by an output limit or a tool that concludes the turn receives no todo repair. The work-handoff service owns recovery reports for those execution outcomes.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The driver reads the todo tool's projections and current goal. At the awaited `agent/turn-stopping` extension point, only a normal model finish may trigger repair. The driver flushes durable state, joins active descendants, flushes again, and rechecks the current list, goal, disposition, and cancellation before incrementing the persisted repair count and steering. Repair messages enter the existing model-visible session history.

The todo policy owner retains purpose, suspension, completed-item high-water mark, and repair count. Terminal cancellation, error, or output-limit events pause active execution lists during projection replay. Human Continue resets the policy; its host caller queues the next turn. Driver teardown stops its waits and joins its callbacks before releasing listeners.

See [`src/index.ts`](src/index.ts) for the stopping listener and [`../tool-todo/src/policy.ts`](../tool-todo/src/policy.ts) for durable policy ownership.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Todo tool](../tool-todo/README.md) — list purpose and explicit human continuation.
- [Goal service](../../goal/goal/README.md) — goal continuation and suspension.
- [Work handoff](../../goal/work-handoff/README.md) — unfinished-work reports and user continuation choices.

-----

<a id="model-experience"></a>
## Model Experience

### Same-turn repair

#### What the model sees

A retained user-role `<todo_continue>` message lists unfinished items and asks the model to execute the next item, verify completed work, and update the whole list. It also tells the model to record a concrete pause or wait reason when execution is suspended. A statement of intent does not count as completion.

#### Token effect

Each admitted repair adds one instruction block plus the unfinished list. After the configured no-progress threshold, stronger recovery instructions are included; authorized work continues until completion or an actual stop condition.

#### KV Cache effect

Repairs append to the current conversation after its reusable prefix. No new agent or copied conversation is created.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Task completion relies on the model's recorded statuses; the driver does not independently verify workspace results. A proposal authorizes no execution. Legacy or suspended work needs explicit human continuation. The repair counter selects guidance strength; existing goal and execution limits retain their own ownership.

<a id="dev-note"></a>
### Dev Note

The todo policy owns list classification and the repair counter; this driver only requests continuation through the normal stopping extension point.
