---
description: "Use and debug the experimental Web Orchestration settings panel: pick the multi-model pool from the provider capability catalog for Orchestration Mode."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-orchestration

English | [中文](README.zh.md)

## Summary

Select Default or Orchestration from the conversation composer and choose worker models in the Orchestration Settings section. The composer reads the session's host projection and submits mode changes through the command service; it shows queued changes and reports failed selections without changing the displayed mode optimistically. The settings panel lists the Paderborn AI-Gateway catalog with capability badges and writes the shared host model pool. Enable both controls through the experimental Orchestration profile bundle.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Enable this package through [`@deepseek-ai/dsh-experimental-orchestration-profile`](../orchestration-profile/README.md), which supplies the Orchestration service, tool, and this Web panel together. The Web Client loader mounts the `/client` export; the root Host export is inert, and the package has no user configuration fields.

### Select the session mode

Use the composer's mode menu to choose Default or Orchestration. The selector appears only when the host publishes the orchestration projection and the command service is available. A queued change shows “Applies from the next step”; a refused or failed command leaves the host-projected choice visible for retry. The shared Menu supplies keyboard navigation, Escape dismissal, and a portaled overlay.

### Pick the model pool

The panel shows every model the provider catalog reports for the Paderborn AI-Gateway (`provider: paderborn`), each with capability badges derived from the catalog entry. Checking or unchecking a row is optimistic local state; every toggle persists the new pool to the Host through `setPool`. The pool read at mount time is seeded into the panel, so the current Host selection is the starting state.

The panel shows the selection already saved to the Host, a notice when the pool is empty, and a save failure notice if the Host refuses an update. There is no separate save button; each toggle applies immediately.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Client export mounts the `orchestrations` Remote contribution through `ctx.remote.$mount`, then registers the settings panel and an additive `conversation.input.left` composer control. The composer reads the `orchestration` session projection and submits `/orchestration on|off` through the session-bound command service. Disposing the plugin withdraws the controls before the Remote mount. The panel derives its catalog and capability badges from `PADERBORN_CATALOG`.

| File | Role |
|---|---|
| [`src/client/mount.ts`](src/client/mount.ts) | Locale, slot, and Remote orchestration registrations |
| [`src/client/OrchestrationPanel.tsx`](src/client/OrchestrationPanel.tsx) | Provider catalog rows with capability badges and pool selection |
| [`src/client/locales.ts`](src/client/locales.ts) | English and Chinese panel copy |
| [`src/index.ts`](src/index.ts) | Inert Host entry |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Orchestration profile bundle](../orchestration-profile/README.md) — the published opt-in bundle that mounts this Client plugin.
- [Orchestration service](../dsh-orchestration/README.md) — the Host `orchestrations` service that owns the pool.
- [Orchestration tool](../tool-orchestration/README.md) — the model-facing `run_orchestration` tool the pool drives.
- [Experimental packages](../README.md) — incubation status and publication policy.

-----

<a id="model-experience"></a>
## Model Experience

### Pool selection

#### What the model sees

The panel writes the selected multi-model pool through the Host `orchestrations` Remote namespace. A pool entry is the `provider`/`model` route a later Orchestration run uses; the panel itself registers no tool, prompt section, or model-facing input, and the selection enters the model only when a run consumes its route.

#### Token effect

None from the panel. The selected pool drives later `run_orchestration` calls, whose planning and worker requests consume tokens on the chosen routes through the Orchestration service.

#### KV Cache effect

None. The panel adds no model context and retains no KV prefix; the pool is Host-held state, not prompt content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Single provider today** — the panel lists only the Paderborn AI-Gateway (`provider: paderborn`); a multi-provider pool picker is deferred.
- **Host service required** — the panel needs the `orchestrations` Remote namespace mounted by the Orchestration service; without it, reads and writes are refused and the panel shows the save-failure notice.
- **Model availability** — a model appears only when the provider catalog reports it; catalog changes require the page to reload.
- **No per-session override** — the selected pool is a single Shared Host value, not a per-session or per-run override.
- **Experimental prototype with no stability promise** — the package is public, but its contracts can change freely while it incubates.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is explicitly non-authoritative.

#### Promotion

Promotion to a product-role group requires reviewing the public contract, limitations, test evidence, release payload, runtime dependents, and a named stable owner, per the [experimental subtree rules](../AGENTS.md). A multi-provider pool picker and per-session overrides are natural next steps.

</details>
