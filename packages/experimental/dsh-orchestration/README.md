---
description: "Select capable, available models for normal subagent delegations in experimental Orchestration mode."
kind: "package-reference"
---

# @deepseek-ai/dsh-orchestration

English | [中文](README.zh.md)

## Summary

Orchestration mode encourages useful parallel delegation and selects models for fresh local subagents and their later assessed phases. The parent assesses the task through the normal subagent tool; this service checks every required capability, expected input modality, and context allowance, then balances assignments among eligible routes from the permitted pool. The normal subagent runtime owns execution, cancellation, delivery, and cleanup. This experimental package has no stability promise.

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

Child selections must fit the recorded child-model authorization. The configured pool also bounds lead recovery. Saving another pool changes candidates without widening an existing child grant; a historical Session without recorded authorization permits only its parent route.

### Task assessment

In Orchestration mode, every fresh local delegation requires task_assessment. requiredCapabilities lists every necessary specialty: coding, reasoning, vision, allrounder, or european. preferredCapabilities lists optional strengths. Unsupported required or preferred labels and modalities other than text/image raise ORCHESTRATION_INVALID_ASSESSMENT before route inspection, so callers can correct typos. A model must satisfy every required specialty; reasoning does not substitute for coding.

Ordinary implementation tasks require coding. Add reasoning to preferredCapabilities when it would help; require reasoning only when the task specifically needs that capability. Optional preferences never exclude an otherwise capable idle route.

contextTokens estimates the complete input the worker will need, including files it will read later. requiredModalities lists inputs needed throughout the task; include image for browser or computer screenshots even when the initial prompt contains only text. outputTokens optionally estimates response tokens independently of the generation cap.

### Configuration

The pool field lists exact provider/model routes. routeCapabilities supplies verified specialties for an exact route and replaces its curated specialty list; an empty list clears those specialties. Duplicate exact-route declarations are rejected. The settings client reads the pool picker catalog through getCatalog, which projects the live LLM registry grouped by provider so the picker mirrors the models the composer can select; known uni-paderborn routes carry curated specialties as annotations.

For uni-paderborn, curated specialties include coding for gwdg.deepseek-v4-flash-0731 and reasoning for gwdg.glm-5.3-flash, verified on 2026-11-17 against the [DeepSeek model card](https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash-0731) and [GLM model card](https://huggingface.co/zai-org/GLM-5.3-Flash). Task specialties describe suitability independently of the gateway's reasoning flag for advertised API support. Recorded permissions, exact routeCapabilities overrides, transport settings, and capacity limits still apply. Selection affects fresh delegations, including fresh Ralph rounds; running workers change routes only through authorized phase or recovery admission.

contextOverheadTokens defaults to 8192 tokens for child instructions, tools, and request wrappers. The input estimate uses the larger of contextTokens and the initial prompt's text/image estimate, then adds this overhead. Actual inline images require image capability even when the assessment omits it. outputReserveTokens defaults to 4096 when the assessment omits outputTokens; the effective explicit or adapter-default generation cap also participates in context and compaction admission. Both allowances are validated deployment settings. The input estimate plus output allowance must fit the model's combined context capacity. Routing preserves the child's actual output cap; normal request preparation and provider limits still apply.

defaultToOrchestrator defaults to false and seeds the logged mode only for Sessions without a recorded selection. The profile settings store persists `userPool` and `userPoolConfigured`; an explicit empty pool disables routing, while an unset override inherits `pool`. `getPoolSettingsState` supplies a revision and `persistPool` rejects stale or failed writes before reporting the effective selection.

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-orchestration) documents every accepted setting.

### Selection and failures

The service intersects the pool with recorded authorization, then checks strict task capabilities, anticipated modalities, and context capacity. A known maximum output capacity must also cover the response allowance; an unknown output capacity imposes no additional limit. The current transport admits text and images. Exact adapter metadata takes precedence over curated gateway facts: an explicitly text-only route cannot serve an image task. Curated facts apply only to the known gateway provider; another provider using the same model id requires its own verified specialty declarations and capacity metadata.

Local children can accept an explicit assessed phase and durable checkpoint through `requestModelChange()`. Recoverable request failures can also select another eligible route for a lead or child without repeating completed tools. Billing exhaustion suppresses routes sharing the reported budget; unknown billing independence is treated conservatively, while known-free routes remain eligible. The settings panel can clear observed billing failures after account correction. `maxAutomaticReassignments` defaults to 2 per recovery episode; exhausted recovery records a blocked state and captures a handoff when available.

Capable routes with ready or unknown queue capacity rank by active assignments, confirmed readiness, preferred capabilities, recency, and stable pool order. Reservations and active turns contribute load across Sessions. Rate-limited routes do not block another eligible route. When all capable routes are busy, admission waits cancellably and rechecks the shared queue at most every `availabilityPollMs` milliseconds (default 1000). A route with a known unavailable model or credential is excluded; unexpected metadata failures remain visible.

The service inspects the LLM adapter's shared queue availability; the adapter remains responsible for actual dispatch admission and request/token accounting. An adapter without availability reporting returns unknown and participates alongside ready routes. An idle unknown-capacity route wins over a loaded ready route; confirmed readiness wins when assignment loads match. Reassignment continues the same child Session; it does not restart the task or replay completed tools.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The service registers its selector with SubagentRuntime. It returns the selected child options, a setup callback recording the captured mode, and an idempotent assignment release callback. The runtime validates final authorization and owns startup rollback and assignment release after child teardown. Orchestration retains no worker promises or child execution loop.

The orchestration projection folds applied mode, durable pending requests, and historical command settlements. Its state version changes when recovery semantics change. Informational routing records contain the assessment, selected route, token allowances, selection reason, eligible count, selected load and readiness, and other pool routes' exclusions and capacity facts. Retained records may omit diagnostic fields. These records do not enter model history.

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

The logged `orchestration-phase` context explains `reassign_subagent`, phase assessments, checkpoints, explicit generation caps, and request-only interruption. Automatic recovery can change the lead or a local child model within the configured pool and applicable permissions. Active mode adds logged guidance to prefer useful parallel delegation within the user’s instructions and existing delegation limits. The parent handles small or sequential work directly; routing adds no planning request.

##### Orchestration runtime guidance

```markdown
Orchestration mode is active. Proactively identify independent work that can make useful progress in parallel. When the available subagent tools and delegation limits allow it, prefer delegating bounded tasks with clear goals and expected results without waiting for the user to request delegation. Start independent delegations early and continue useful work yourself when possible. Respect the user's instructions, delegation depth, and active-child limits. Handle work directly when it is small, sequential, or delegation would add overhead without useful parallel progress. For every fresh local child, supply task_assessment with requiredCapabilities (coding, reasoning, vision, allrounder, european), contextTokens for expected input including files the child will read, and requiredModalities for inputs needed throughout the task. Require coding for ordinary implementation tasks. Prefer reasoning when it would help; require it only when the task specifically needs that capability. Include image for screenshots the child may capture later. Use preferredCapabilities for optional strengths and outputTokens for the expected response allowance. Every required capability must be supported; reasoning alone does not establish coding ability. Model selection automatically considers the allowed pool, capabilities, live load, and request/token queue availability.
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
- Reassignment requires an existing local child, a saved grant, and durable admission. A stopped target only queues a phase; a separate authorized message resumes it. Requirements and completed tool effects remain intact.
- Delegation guidance expresses a preference; it does not guarantee the model discovers every parallel opportunity.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is explicitly non-authoritative.

#### Promotion

Promotion requires reviewing the public behavior, limitations, real-composition evidence, release payload, runtime consumers, and stable ownership under the [experimental subtree rules](../AGENTS.md).

</details>
