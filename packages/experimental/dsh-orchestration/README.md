---
description: "Select capable, available models for normal subagent delegations in experimental Orchestration mode."
kind: "package-reference"
---

# @deepseek-ai/dsh-orchestration

English | [中文](README.zh.md)

## Summary

Orchestration mode selects a model for each normal fresh local subagent delegation. The parent assesses the task through the normal subagent tool; this service checks every required capability, expected input modality, and context allowance, then chooses a ready route from the permitted pool. The normal subagent runtime owns execution, cancellation, delivery, and cleanup. This experimental package has no stability promise.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount this service beside the LLM, subagent, agent, session projection, and system-prompt services. It registers a normal subagent model router and a pool settings Remote namespace; it adds no task-planning call or separate orchestration tool.

### Session mode and authorization

Select Orchestration in the conversation composer or run /orchestration on. Run /orchestration off to retain normal parent-route inheritance and authorized explicit or configured child model choices. A selection made between turns applies immediately. A selection made within a turn is recorded durably and applies at the next accepted, nonempty, nonaborted step. Restart and plugin replacement retain pending selections.

The selected mode is logged in each Session. Fresh local children inherit the parent's mode captured when their delegation was admitted, including through deeper delegation chains; changing the parent while a child is starting does not change that captured mode. Forks and external providers retain their existing routing behavior.

Every selection must fit the parent's recorded child-model authorization. The configured pool supplies defaults for new root Sessions. Saving another pool changes defaults and routing candidates without widening existing Sessions; a historical Session without recorded authorization permits only its parent route.

### Task assessment

In Orchestration mode, every fresh local delegation requires task_assessment. requiredCapabilities lists every necessary specialty: coding, reasoning, vision, allrounder, or european. preferredCapabilities lists optional strengths. Unsupported required or preferred labels and modalities other than text/image raise ORCHESTRATION_INVALID_ASSESSMENT before route inspection, so callers can correct typos. A model must satisfy every required specialty; reasoning does not substitute for coding.

contextTokens estimates the complete input the worker will need, including files it will read later. requiredModalities lists inputs needed throughout the task; include image for browser or computer screenshots even when the initial prompt contains only text. outputTokens optionally supplies the expected response allowance.

### Configuration

The pool field lists exact provider/model routes. routeCapabilities supplies verified specialties for an exact route and replaces its curated specialty list; an empty list clears those specialties. Duplicate exact-route declarations are rejected. The settings client reads curated gateway choices through getCatalog rather than importing Host data.

contextOverheadTokens defaults to 8192 tokens for child instructions, tools, and request wrappers. The input estimate uses the larger of contextTokens and the initial prompt's text/image estimate, then adds this overhead. Actual inline images require image capability even when the assessment omits it. outputReserveTokens defaults to 4096 when the assessment omits outputTokens; a larger explicit child output cap increases the context allowance. Both allowances are validated deployment settings. The input estimate plus output allowance must fit the model's combined context capacity. Routing preserves the child's actual output cap; normal request preparation and provider limits still apply.

defaultToOrchestrator defaults to false and seeds the logged mode only for Sessions without a recorded selection. Pool selection is exposed through getPool, setPool, and persistPool. persistPool applies the selection in memory and attempts to save it to the profile; a refused settings write produces a warning and retains the in-memory selection for the process.

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-orchestration) documents every accepted setting.

### Selection and failures

The service intersects the pool with recorded authorization, then checks strict task capabilities, anticipated modalities, and context capacity. A known maximum output capacity must also cover the response allowance; an unknown output capacity imposes no additional limit. The current transport admits text and images. Exact adapter metadata takes precedence over curated gateway facts: an explicitly text-only route cannot serve an image task. Curated facts apply only to the known gateway provider; another provider using the same model id requires its own verified specialty declarations and capacity metadata.

Ready capable routes rank by preferred task strengths, live child work across Sessions, least recent assignment, and pool order. Live load is read from active or queued child turns, including after plugin replacement; idle continuable children add no load. Unpublished assignments count until publication or rollback. A rate-limited route does not block another ready capable route. When every capable route is busy, admission waits cancellably and rechecks the shared queue at most every availabilityPollMs milliseconds (default 1000), so early capacity refunds can resume work before a rolling-window estimate expires. Missing assessment, unavailable route metadata, or no capable permitted route raises a structured OrchestrationError before a child starts. Routes whose single-request estimate exceeds the token-per-minute capacity are excluded.

The service inspects the LLM adapter's shared queue availability; the adapter remains responsible for actual dispatch admission and request/token accounting. An adapter without availability reporting returns unknown and is eligible only when no capable route reports ready capacity. Unknown capacity is considered before waiting for known throttled routes. A failed or refused worker is never automatically replayed on another model.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The service registers its selector with SubagentRuntime. It returns the selected child options, a setup callback recording the captured mode, and an idempotent assignment release callback. The runtime validates final authorization and owns startup rollback and assignment release after child teardown. Orchestration retains no worker promises or child execution loop.

The orchestration projection folds applied mode, durable pending requests, and historical command settlements. Its state version changes when recovery semantics change. Routing decisions record the task assessment, selected exact route, token allowances, and selection reason in informational plugin records. These records do not enter model history.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Subagent runtime](../../../docs/subsystems/subagent.md) owns normal delegation and model-selection authorization.
- [LLM runtime](../../../docs/subsystems/llm-streaming.md) owns exact model metadata and request dispatch.
- [Experimental packages](../AGENTS.md) defines isolation and promotion requirements.

-----

<a id="model-experience"></a>
## Model Experience

### Task-aware delegation

#### What the model sees

Active mode adds the following logged runtime guidance about `task_assessment`. The parent decomposes work through ordinary reasoning and normal subagent tools; no extra planning request is sent.

##### Orchestration runtime guidance

```markdown
Orchestration mode is active. Delegate independent tasks through the normal subagent tools. For every fresh local child, supply task_assessment with requiredCapabilities (coding, reasoning, vision, allrounder, european), contextTokens for expected input including files the child will read, and requiredModalities for inputs needed throughout the task. Include image for screenshots the child may capture later. Use preferredCapabilities for optional strengths and outputTokens for the expected response allowance. Every required capability must be supported; reasoning alone does not establish coding ability. Model selection automatically considers the allowed pool, capabilities, live load, and request/token queue availability.
```

#### Token effect

Routing performs metadata and queue inspection without a model call. Each selected child consumes tokens through the ordinary subagent execution. The configured context and output allowances reserve routing headroom; actual requests retain the normal adapter accounting.

#### KV Cache effect

Each fresh child has its normal independent history. Routing does not rewrite parent history or replay completed child work. Runtime mode guidance follows normal logged context updates.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Task requirements and future context are estimates supplied by the parent; the service cannot infer files or tool-produced images the parent omits.
- Availability inspection is advisory and does not reserve provider capacity. Another request may consume capacity before dispatch, where the shared limiter remains authoritative.
- Curated specialties cover one gateway. Other providers need verified route declarations, and unknown modality or context facts cannot establish eligibility.
- Model selection happens before a fresh local child starts. It does not migrate an active worker, rerun failed side effects, or resume abandoned work on another model.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is explicitly non-authoritative.

#### Promotion

Promotion requires reviewing the public behavior, limitations, real-composition evidence, release payload, runtime consumers, and stable ownership under the [experimental subtree rules](../AGENTS.md).

</details>
