---
description: "Add task-aware model selection for normal subagents to an opted-in Harness profile."
kind: "package-bundle"
---

# @deepseek-ai/dsh-orchestration-profile

English | [中文](README.zh.md)

## Summary

Enable Orchestration mode to encourage useful parallel delegation and assign normal subagents to models suited to their tasks and available capacity. This optional experimental layer adds the mode control and shared model pool to a profile built on `dsh-base`. The lead agent stays on the session's selected model. Default mode retains normal delegation. The bundle requires a compatible host runtime and is absent from default profiles.

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

Apply this bundle after `dsh-base` in an opted-in profile. Its [patch](cordis.patch.yml) mounts the orchestration service with a seed model pool and the optional Web controls. Replace the service's `pool` through profile configuration or the Orchestration settings panel.

The profile supplies exact `uni-paderborn` compaction defaults for `gwdg.glm-5.3-flash` and `hs-de.qwen3.8-27b`: `headroomTokens: 8192` and summary `maxTokens: 8192`. The global patch covers the base provider; its effect-owned runtime plugin fills absent fields in later scoped Web providers. Explicit top-level or exact-route Loader configuration takes priority. These summary limits do not set worker generation caps or task-assessment estimates.

Select Orchestration from the conversation composer or use `/orchestration on`; use Default or `/orchestration off` to return to normal delegation. The normal subagent tools carry the task assessment and selected context. Required capabilities are enforced together: a coding task with visual verification needs both coding and image understanding. The [service reference](../dsh-orchestration/README.md) owns assessment fields and routing rules.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The bundle inserts the orchestration service and Web panel alongside the existing subagent runtime and tools. The service supplies a model-routing policy through the runtime's registered extension. The normal activation manager owns child startup, cancellation, results, and teardown. The bundle does not add another task executor.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Orchestration service](../dsh-orchestration/README.md) — mode, pool, task matching, and configuration.
- [Normal subagent tools](../../subagent/tool-subagent/README.md) — delegation and context handoff.
- [Web controls](../client-ui-orchestration/README.md) — mode selection and pool settings.

-----

<a id="model-experience"></a>
## Model Experience

### Delegation routing

#### What the model sees

The service encourages useful parallel delegation within existing limits and contributes routing guidance to normal `subagent` calls; the subagent tool owns the task assessment and selected image context. The [service reference](../dsh-orchestration/README.md#model-experience) describes the exact guidance.

#### Token effect

Normal lead and subagent requests consume tokens on their selected routes. The bundle adds no separate planning request.

#### KV Cache effect

Fresh subagents start their own request history. Selecting a route does not transfer the lead's KV prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Existing recorded model permissions restrict routing; pool edits only supply permission defaults for future sessions.
- Live quota accounting covers the running Harness instance, not other clients sharing the same credentials.
- The Web picker lists the Paderborn gateway catalog; other routes require explicit service configuration.
- The package is experimental and has no stability promise.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
