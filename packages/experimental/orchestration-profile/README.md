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

Install this bundle and apply its patch over `dsh-base` to add Orchestration Mode to the host. The patch inserts the service and tool and seeds a provider-aligned default pool; the pool is replaced with the GUI panel or a `tool-orchestration` config:

```yaml
- id: tool-orchestration
  name: '@deepseek-ai/dsh-tool-orchestration'
  config:
    pool:
      - provider: uni-paderborn
        model: gwdg.deepseek-v4-flash-0731
      - provider: uni-paderborn
        model: gwdg.glm-5.3-flash
```

Because Experimental isolation forbids shipping experimental packages in default bundles, this profile is opt-in by construction. It does not disable normal subagent delegation; orchestration is an additional capability the model can choose with `run_orchestration`.

### Enable Orchestration mode for a session

`run_orchestration` only delegates while the session is in Orchestration mode; a Default session refuses the tool so the normal single-model loop is never silently replaced. Turn the mode on per session from the conversation composer's Default/Orchestration menu, or with `/orchestration on`, and leave it with `/orchestration off`. The selection is logged and restored across restarts.

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

- **Pool is seeded provider-aligned, then GUI-editable** — the layer ships a default pool naming the base profile's mounted provider route; the GUI panel replaces it through `persistPool`, which applies it in memory and writes the profile best-effort. A refused profile write leaves the session pool live.
- **Mode is selected per session, not a dedicated roster entry** — the session is switched with the composer's Default/Orchestration menu or `/orchestration on|off`, not a first-class picker row yet.
- **No durability** — a run is not resumed across restart; each invocation re-plans.
- **No keyless recorded-session snapshot yet** — the Loader boot test covers the composed model-visible surface deterministically, but a recorded `run_orchestration` session snapshot still requires a keyed maintainer run (`test:snapshot:record`).
- **Experimental prototype with no stability promise** — the package is public, but its contracts and placement can change freely while it incubates.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is explicitly non-authoritative.

#### Promotion

Promotion to a product-role group requires reviewing the public contract, limitations, test evidence, release payload, runtime dependents, and a named stable owner, per the [experimental subtree rules](../AGENTS.md). A first-class Mode picker row and a recorded-session snapshot are natural next steps.

</details>
