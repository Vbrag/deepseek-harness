---
description: "Use the Web Orchestration switch and configure the model pool for subagents."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-orchestration

English | [中文](README.zh.md)

## Summary

Enable Orchestration for the current conversation with the composer switch, and choose subagent models and specialties in the Orchestration settings. The control shows queued changes and reports failed selections without changing the displayed mode optimistically.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

The Web application bundle mounts this package and the base profile supplies the Orchestration service. The Web Client loader mounts the `/client` export; the root Host export is inert, and the package has no user configuration fields.

### Select the session mode

Use the composer's Orchestration switch to change the current conversation. If the pool is empty, select and save models first. Review and authorize additional routes when prompted; existing child grants remain unchanged. A queued change shows “Applies from the next step”; a failed request leaves the host-projected choice visible for retry.

### Pick the model pool

The panel lists provider models and their capability badges. Checking rows, **Select all**, and **Clear** adjust a local draft; selected models can also be assigned task specialties. **Save model pool** persists both against the settings revision. Opening the panel refreshes the effective pool and catalog. An explicitly empty pool remains empty, and new catalog entries do not alter a saved selection.

The panel reports whether the write succeeded, failed, or became stale. A failed write retains the draft and does not claim persistence. For a stale revision, refresh settings and review the retained draft before saving. If the account is corrected after billing exhaustion, **Retry billing-limited models** clears the observed billing failures so a later request can try again.

### Follow model changes

Open the conversation's session panel to see **Orchestration models**. The lead and each observed local child show the model used by the last recorded request, any selected next model or requested preference, the previous model, and the routing reason. The lead keeps the model selected in the composer; if it is blocked, the panel suggests correcting the issue or selecting another model before retrying. Queued changes, **Changing model**, **Waiting for capacity**, and blocked changes have distinct labels. A selected or requested route becomes **Last used** only when the host publishes a request using it; a session with no recorded request says **No request yet**.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Client export mounts the `orchestrations` Remote contribution through `ctx.remote.$mount`, then registers the settings panel, an additive `conversation.input.left` composer control, and a `conversation.session.panel.section` section. The switch reads the `orchestration` projection, reviews activation through the Host, and submits the off command through the session-bound command service. The section reads published lead and child `orchestrationRouting` and `modelSelection` projections; it neither opens Sessions nor scans logs. The panel derives its catalog from the Host `getCatalog` Remote.

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

- [Orchestration profile bundle](../../experimental/orchestration-profile/README.md) — optional Paderborn defaults.
- [Orchestration service](../../subagent/orchestration/README.md) — the Host `orchestrations` service that owns the pool.
- [Subagent tools](../../subagent/tool-subagent/README.md) — normal delegation with task assessments and selected context.
- [Client packages](../README.md) — the user interface packages.

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
- **Pool picker is catalog-scoped** — the panel lists providers the live LLM registry advertises; models appear only when their provider reports them, and catalog changes take effect when the panel reopens.
- **Profile overrides** — a higher-priority home patch or command-line overlay can refuse a pool write; the panel reports the failure.
- **No per-session override** — the selected pool is a single Shared Host value, not a per-session or per-run override.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is explicitly non-authoritative.

The model pool is shared by the active profile; the mode selection and route grants belong to each conversation.

</details>
