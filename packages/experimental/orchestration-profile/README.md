---
description: "Opt-in Orchestration Mode experimental profile bundle: split one task into parallel subagents over a selected multi-model pool with bounded route failover."
kind: "package-bundle"
---

# @deepseek-ai/dsh-orchestration-profile

English | [中文](README.zh.md)

## Summary

`dsh-orchestration-profile` is an opt-in profile layer that enables **Orchestration Mode** in one bundle. Applied after `dsh-base`, it mounts the Orchestration service and its `run_orchestration` tool with a selected multi-model pool, so a session can split a goal into independent parallel sub-tasks across several models and restart any failed sub-task on the next eligible model route instead of failing the whole run. It is experimental and ships only when explicitly opted into; it is never part of the default bundles.

## Table of Contents

- [Use this profile](#use-this-profile)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-profile"></a>
## Use this profile

Install this bundle and apply its patch over `dsh-base` to add Orchestration Mode to the host. The patch inserts the service and tool; the pool is chosen in the `tool-orchestration` config:

```yaml
- id: tool-orchestration
  name: '@deepseek-ai/dsh-tool-orchestration'
  config:
    pool:
      - provider: deepseek-official
        model: deepseek-v4-flash
      - provider: deepseek-official
        model: deepseek-v4
```

Because Experimental isolation forbids shipping experimental packages in default bundles, this profile is opt-in by construction. It does not disable normal subagent delegation; orchestration is an additional capability the model can choose with `run_orchestration`.

### What success and failure look like

A session in Orchestration Mode completes its goal by splitting it into parallel sub-tasks, aggregating each sub-task's output, and integrating the results. A run succeeds when every sub-task completes; a refused sub-task is never re-routed and surfaces as a failed step.

-----

<a id="model-experience"></a>
## Model Experience

### Delegated run_orchestration

#### What the model sees

This bundle mounts the `run_orchestration` tool and its Orchestration service alongside the rest of the profile. The model-facing tool schema, sub-task prompts, and results belong to `@deepseek-ai/dsh-tool-orchestration` and `@deepseek-ai/dsh-orchestration`; the profile layer itself contributes no prompt or tool text.

#### Token effect

No direct token effect from the bundle. Planning and worker calls consume tokens on the routes configured in the mounted `tool-orchestration` pool.

#### KV Cache effect

No direct effect. The composed service and tool own any model-visible context; the profile layer adds none.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Configuration-static pool** — the pool is set in the profile patch; a per-session GUI multi-model pool selector is deferred.
- **No selectable roster entry yet** — this layer adds the capability; a first-class Mode picker entry (like Standard/PTC) is the next step, pending Loader verification in a run-capable environment.
- **No durability** — a run is not resumed across restart; each invocation re-plans.
- **Experimental prototype with no stability promise** — the package is public, but its contracts and placement can change freely while it incubates.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is explicitly non-authoritative.

#### Promotion

Promotion to a product-role group requires reviewing the public contract, limitations, test evidence, release payload, runtime dependents, and a named stable owner, per the [experimental subtree rules](../AGENTS.md). A first-class Mode picker entry and a per-session GUI pool selector are natural next steps.

</details>
