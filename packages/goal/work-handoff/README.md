---
description: "Durable unfinished-work reports and explicit continuation for users and maintainers of long-running tasks."
kind: "package-reference"
---

# @deepseek-ai/dsh-work-handoff

English | [中文](README.zh.md)

## Summary

`dsh-work-handoff` saves unfinished work when execution stops, including goal round exhaustion, output limits, cancellation, and errors. Authorized current-task lists resume automatically after ordinary model stops and compatible historical limit records. It combines a model-authored checkpoint with bounded recorded evidence, current task state, and workspace observations. Users can export the Markdown or explicitly continue in the current or a fresh session. Capturing a handoff makes no model request and never declares the task complete.

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

The shared base mounts this service beside the goal and todo owners. Custom compositions require the Agent, Session persistence, session-projection, and tool services:

The shipped base requires handoff capture, goal-round control, and todo reconciliation to activate; startup fails if any of these protections cannot load.

```yaml
- name: '@deepseek-ai/dsh-work-handoff'
```

### Save and recover work

Before an expected stop, the model calls `work_checkpoint` with a concise summary, reported completed work, remaining tasks and next actions, validation reports, and concrete blockers. Checkpoint claims remain separate from recorded tool evidence. The goal driver requests a host capture when its round allowance is exhausted; explicit pauses and waits, output limits, cancellation, and execution errors also capture unfinished work. No finalization request is added after a hard limit.

The capture records the objective, task list, goal allowance, pending jobs and subagents, bounded tool observations, and available Git facts. Its Markdown remains in the Session even when optional attachment export fails. `saved` becomes true only after Session persistence acknowledges the capture. A persistence failure leaves the report visibly unsaved and rejects the operation; restore storage before relying on continuation.

### Automatic and explicit continuation

Authorized current-task lists in active or historical limit state resume automatically after durable checks. The Web strip reports Continuing automatically and requires no manual Continue at the reminder threshold. Explicit pauses, waits, failures, goal stops, plans, proposals, and legacy lists retain their applicable restrictions. The strip offers Copy, Download, Continue work, and Continue in new session for actual stopped work as applicable. Continue work confirms the current task list, including a legacy list, and queues one ordinary continuation. Continuing in a new session selects the exact saved handoff, checks the source directory, and retains the source model choice, Agent preset, and recorded execution restrictions. The handoff is context to verify against the workspace; it grants no additional permissions or plan approval. Duplicate creation requests for one handoff share one result.

The goal's default allowance remains 256 admitted automatic rounds. A round can contain many model steps; human turns do not spend it. The todo default of three selects stronger recovery guidance after repeated no-progress stops; it never ends authorized execution. Goal round accounting remains independent.

### Capture bounds

Deployment configuration bounds retained evidence, text, pending-operation ids, and copied policy payloads through `maxEvidence`, `maxTextChars`, `maxPending`, and `maxPolicyChars`. `gitTimeoutMs` and `processGraceMs` bound optional read-only Git inspection. Missing or failed observations are identified in the report; they are never replaced with invented results. See the [configuration catalog](../../../docs/config-catalog.md) for defaults.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`ctx.workHandoffs` owns capture, persistence acknowledgement, and explicit continuation. A bounded Session projection retains the latest checkpoint, tool observations, pending-operation ids, objective reference, and policy snapshots. Its client value is the latest `WorkHandoffView` or null. Capture serializes per Session and identifies the stopped turn and goal allowance, so repeated requests do not duplicate the report. Replaying a Session performs no model requests or workspace inspection.

The host observes workspace facts during capture and renders Markdown without treating model claims as verified evidence. Fresh-session continuation validates retained policy data and the current source directory before admitting work. Plugin teardown aborts and joins owned capture and continuation operations before disposing created Agent handles.

Agent-owned services resolve through the retained preset before inherited providers. Capture and explicit continuation therefore read or change the source and target todo policies in their own preset realms.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Goal types and handoffs](../../../docs/subsystems/goal.md) — exact checkpoint, capture, and view fields.
- [Goal round driver](../goal-round-driver/README.md) — automatic-round admission and exhaustion.
- [Todo policy](../../todo/tool-todo/README.md) — list purpose and human-authorized continuation.
- [Web work strip](../../client/ui-goal/README.md) — visible status and export actions.

-----

<a id="model-experience"></a>
## Model Experience

### Progress checkpoint and continuation

#### What the model sees

The `work_checkpoint` tool accepts `summary`, `completed`, `remaining`, `validation`, and `blockers`. Its result confirms that a checkpoint was recorded and explicitly says this does not complete the task. Automatic or human-triggered continuation supplies logged task context through an ordinary retained message, instructing the model to recheck workspace facts and permissions.

#### Token effect

Host capture consumes no model tokens. A checkpoint tool call and result consume their ordinary request tokens. `maxTextChars` bounds the complete checkpoint and each retained evidence preview. The saved Markdown includes the full admitted task list and goal, so it can be larger; an explicit continuation adds it to the ordinary model context and remains subject to that request's context admission.

#### KV Cache effect

Checkpoint tool results append to the current conversation. A fresh continuation starts a new session with the handoff, rather than copying the source conversation. Same-session continuation appends after the retained prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Bounded evidence** — the report retains previews and references, not every historical result. The source Session and workspace remain authoritative.
- **No independent completion evaluation** — model-reported completion and validation remain claims alongside recorded observations.
- **Continuation authority** — authorized current-task work resumes automatically; legacy lists, proposals, and explicit suspension retain the applicable human confirmation. A saved report grants no permissions.
- **Storage and workspace availability** — failed persistence prevents a saved acknowledgement; unavailable policy data, composition, or source directory can prevent fresh-session continuation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The goal and todo owners decide when execution may continue. This service retains recovery facts and admits authorized continuations; it does not own a second autonomous loop.

</details>
