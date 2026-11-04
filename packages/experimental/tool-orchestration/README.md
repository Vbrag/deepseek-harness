---
description: "Model-facing run_orchestration tool over the opt-in Orchestration service: split a task into parallel subagents over a selected multi-model pool with bounded route failover."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-tool-orchestration

English | [中文](README.zh.md)

## Summary

`dsh-experimental-tool-orchestration` exposes one `run_orchestration` tool to the model. With `@deepseek-ai/dsh-experimental-orchestration` mounted, the tool splits a goal into independent parallel sub-tasks and runs them across the configured model pool, restarting any failed sub-task on the next eligible model route instead of failing the whole run. The package is experimental.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount both the Orchestration service and this tool plugin:

```yaml
- name: '@deepseek-ai/dsh-experimental-orchestration'
- name: '@deepseek-ai/dsh-experimental-tool-orchestration'
  config:
    pool:
      - provider: deepseek-official
        model: deepseek-v4-flash
      - provider: deepseek-official
        model: deepseek-v4
```

The `pool` is the selected multi-model set, in priority order; the orchestrator plans on the first route and fails over each failed sub-task to the next route. An empty pool fails the tool call loudly rather than silently running nothing.

### The tool

| Tool | Purpose |
|---|---|
| `run_orchestration` | Split a self-contained goal into independent parallel sub-tasks and run them across the pool, returning each sub-task's output, the route used, and run-level failover/success counts |

The model calls `run_orchestration` with a `task`; it returns `succeeded`, `steps` (each with `id`, `description`, `status`, `output`, `route`, `failedOver`), `failovers`, and `failedSteps`.

### What success and failure look like

The tool succeeds when the orchestrator finishes; a run is `succeeded` only when every sub-task completed. A sub-task that refuses is never re-routed, so policy-denied work returns as a failed step rather than silently re-running. The tool refuses (throws) when the calling session is not in Orchestration mode, when the pool is empty, or when the coordinator plan fails — so a Default session keeps normal single-model behavior and only an active Orchestration selection delegates.

-----

<a id="model-experience"></a>
## Model Experience

### run_orchestration

#### What the model sees

The model sees the `run_orchestration` tool schema. Its description and parameter names pin the orchestration policy: prefer the tool when one goal has several independent parallel parts, keep each sub-task prompt self-contained, and integrate each returned sub-task output before the final answer.

#### Token effect

The tool schema and result text are model-visible tokens. Executing a run additionally consumes planning and worker tokens on the configured pool routes through the Orchestration service.

#### KV Cache effect

No direct effect. Each sub-task runs as an independent spawn worker with no shared KV prefix; the run adds no retained model context of its own.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Config-static pool for now** — the pool is a tool config value; a per-session GUI multi-model pool selector is deferred.
- **No durability** — a run is not resumed across restart; each invocation re-plans from scratch.
- **Flat dependency-free split** — the coordinator emits an independent step set with no ordering or merge phase.
- **Experiment prototype with no stability promise** — the package is public, but its contracts can change freely while it incubates.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is explicitly non-authoritative.

#### Promotion

Promotion to a product-role group requires reviewing the public contract, limitations, test evidence, release payload, runtime dependents, and a named stable owner, per the [experimental subtree rules](../AGENTS.md). A per-session GUI pool selector is a natural next step.

</details>
