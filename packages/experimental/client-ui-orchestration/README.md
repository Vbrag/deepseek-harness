---
description: "Use and debug the experimental Web Orchestration settings panel: pick the multi-model pool from the provider capability catalog for Orchestration Mode."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-orchestration

English | [中文](README.zh.md)

## Summary

Select Default or Orchestration from the conversation composer and choose subagent models in the Orchestration Settings section. The composer reads the session's host projection and submits mode changes through the command service; it shows queued changes and reports failed selections without changing the displayed mode optimistically. The settings panel lists the live provider catalog grouped by provider, with capability badges, and writes the shared host model pool. Enable both controls through the experimental Orchestration profile bundle.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Enable this package through [`@deepseek-ai/dsh-orchestration-profile`](../orchestration-profile/README.md), which supplies the Orchestration service and this Web panel together. The Web Client loader mounts the `/client` export; the root Host export is inert, and the package has no user configuration fields.

### Select the session mode

Use the composer's mode menu to choose Default or Orchestration. The selector appears only when the host publishes the orchestration projection and the command service is available. A queued change shows “Applies from the next step”; a refused or failed command leaves the host-projected choice visible for retry. The shared Menu supplies keyboard navigation, Escape dismissal, and a portaled overlay.

### Pick the model pool

The panel lists eligible provider models and their capability badges. Checking rows, **Select all**, and **Clear** adjust a local draft; **Save model pool** persists it against the settings revision. Opening the panel refreshes the effective pool and catalog. An explicitly empty pool remains empty, and new catalog entries do not alter a saved selection.

The panel reports whether the write succeeded, failed, or became stale. A failed write retains the draft and does not claim persistence. For a stale revision, refresh settings and review the retained draft before saving. If the account is corrected after billing exhaustion, **Retry billing-limited models** clears the observed billing failures so a later request can try again.

### Follow model changes

Open the conversation's session panel to see **Orchestration models**. The lead and each observed local child show the model used by the last recorded request, any selected next model or requested preference, the previous model, and the routing reason. The lead keeps the model selected in the composer; if it is blocked, the panel suggests correcting the issue or selecting another model before retrying. Queued changes, **Changing model**, **Waiting for capacity**, and blocked changes have distinct labels. A selected or requested route becomes **Last used** only when the host publishes a request using it; a session with no recorded request says **No request yet**.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Client export mounts the `orchestrations` Remote contribution through `ctx.remote.$mount`, then registers the settings panel, an additive `conversation.input.left` composer control, and a `conversation.session.panel.section` section. The composer reads the `orchestration` session projection and submits `/orchestration on|off` through the session-bound command service. The section reads published lead and child `orchestrationRouting` and `modelSelection` projections; it neither opens Sessions nor scans logs. Disposing the plugin withdraws the controls before the Remote mount. The panel derives its catalog from the Host `getCatalog` Remote, which projects the live LLM registry grouped by provider; curated Paderborn facts are annotations on known routes.

| File | Role |
|---|---|
| [`src/client/mount.ts`](src/client/mount.ts) | Locale, slot, and Remote orchestration registrations |
| [`src/client/OrchestrationPanel.tsx`](src/client/OrchestrationPanel.tsx) | Provider catalog rows with capability badges and pool selection |
| [`src/client/OrchestrationRouting.tsx`](src/client/OrchestrationRouting.tsx) | Last-used and future child models with routing progress |
| [`src/client/locales.ts`](src/client/locales.ts) | Localized controls and model-progress labels |
| [`src/index.ts`](src/index.ts) | Inert Host entry |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Orchestration profile bundle](../orchestration-profile/README.md) — the published opt-in bundle that mounts this Client plugin.
- [Orchestration service](../dsh-orchestration/README.md) — the Host `orchestrations` service that owns the pool.
- [Subagent tools](../../subagent/tool-subagent/README.md) — normal delegation with task assessments and selected context.
- [Experimental packages](../README.md) — incubation status and publication policy.

-----

<a id="model-experience"></a>
## Model Experience

### Pool selection

#### What the model sees

The panel writes the selected multi-model pool through the Host `orchestrations` Remote namespace. A pool entry is a `provider`/`model` route eligible for normal subagent selection in Orchestration mode; the panel itself registers no tool, prompt section, or model-facing input, and the selected route is recorded when a subagent starts.

#### Token effect

None from the panel. Normal subagent requests consume tokens on their selected routes; model assignment adds no separate planning request.

#### KV Cache effect

None. The panel adds no model context and retains no KV prefix; the pool is Host-held state, not prompt content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Host service required** — the panel needs the `orchestrations` Remote namespace mounted by the Orchestration service; without it, reads and writes are refused and the panel shows the save-failure notice.
- **Pool picker is catalog-scoped** — the panel lists providers the live LLM registry advertises; models appear only when their provider reports them, and catalog changes take effect on the next page load.
- **Profile overrides** — a higher-priority home patch or command-line overlay can refuse a pool write; the panel reports the failure.
- **No per-session override** — the selected pool is a single Shared Host value, not a per-session or per-run override.
- **Experimental prototype with no stability promise** — the package is public, but its contracts can change freely while it incubates.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is explicitly non-authoritative.

#### Promotion

Promotion to a product-role group requires reviewing the public contract, limitations, test evidence, release payload, runtime dependents, and a named stable owner, per the [experimental subtree rules](../AGENTS.md). Per-session overrides are a natural next step.

</details>
