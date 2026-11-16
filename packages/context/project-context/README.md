---
description: "Project knowledge maintained at root-turn completion, with guarded Markdown consolidation and fresh-chat context loading."
kind: "package-reference"
---

# @deepseek-ai/dsh-project-context

English | [中文](README.zh.md)

## Summary

`dsh-project-context` maintains durable project knowledge across chats. Before a lead Agent finishes ordinary work, it assesses the root `PROJECT_CONTEXT.md`, records useful changes, and reports updated, unchanged, or deferred. Goals, work state, decisions, verification, and next steps belong in this knowledge file; standing instructions remain in `AGENTS.md` and `CLAUDE.md`. Explicitly observed duplicate guides can be consolidated into forwarding stubs while their original contents remain in the Session. The Web status distinguishes document maintenance from task completion.

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

The shared base enables this service with the instruction loader. Custom compositions mount both and retain an acknowledged Session persistence provider. Set the same `projectContextFileName` on both rows when changing the default. The writer checks the active Agent-scoped loader rather than assuming that another preset's configuration applies. When disabling instruction loading, also disable the `project-context` row.

### Maintain project knowledge

Keep goals, current and completed work, significant decisions, validation evidence, and next actions concise. Update obsolete facts rather than appending a transcript of every turn. `PROJECT_CONTEXT.md` loads before the project's standing instructions in fresh chats, within the loader's existing byte budget. Its managed section preserves unrelated authored text outside the ownership markers. A marked link in the first available root instruction candidate points to the canonical knowledge file without replacing its rules.

A lead Agent can call `project_context_read` for complete original Markdown documents before requesting exact guide edits or forwarding stubs through `project_context_update`. Consolidation preserves unique current facts in the canonical file; the original guide text and version are logged before replacement. Generated, archived, vendor, scoped-instruction, and standing-rule documents are protected from automatic consolidation. No recursive document crawl or automatic deletion occurs.

### Continuation and failures

Assessment uses ordinary model steps in the same root turn, after outstanding descendant work and a durable checkpoint. It has no separate fixed round cap and follows the existing cancellation, permissions, plan restrictions, goal budgets, and work-continuation policies. Children do not inherit maintenance authority. Interrupted or failed assessment remains deferred or failed; updating notes never declares the task complete or consumes a new goal round by itself.

Writes use the Agent's filesystem provider, normal sandbox policy, complete-file bounds, and observed freshness tokens. Concurrent updates to one filesystem project serialize; a queued request can be cancelled before admission, and an unexpected external edit rejects the stale write. Permission, storage, or cancellation failures retain visible status and unfinished-work evidence. Restore the failed dependency and reassess current files before retrying.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`ctx.projectContext` owns root discovery, complete original observations, a per-project write queue, and guarded publication. A Session projection retains the latest source turn, knowledge watermark, and maintenance status; the watermark freezes during maintenance so document activity cannot trigger recursive finalization. Replay performs no filesystem writes or model requests. The driver attaches to turn-stopping events and leaves ordinary task continuation with its existing owners.

The scoped `agent-instructions/discovery` query supplies root markers and candidate names. A mismatch, disabled loader, changed filesystem, changed working directory, or newly queued user input invalidates preparation. Plugin teardown aborts and joins its owned filesystem operations.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Context types](../../../docs/subsystems/context.md) — exact status, document, tool, and discovery declarations.
- [Instruction loader](../agent-instructions/README.md) — precedence, byte budgets, and logged refresh.
- [Work handoffs](../../goal/work-handoff/README.md) — unfinished-work capture and continuation.
- [Configuration catalog](../../../docs/config-catalog.md) — deployment bounds and defaults.

-----

<a id="model-experience"></a>
## Model Experience

### Project-document assessment

#### What the model sees

A logged `project-context` input requests an assessment of the current project knowledge and supplies observed originals. The model uses `project_context_read` before additional guide changes and ends the assessment through `project_context_update` with `updated`, `unchanged`, or `deferred` plus a concrete summary. Ordinary tool errors remain correctable within the active maintenance phase.

#### Token effect

Maintenance adds ordinary model steps and bounded file observations to the current turn. No assessment request is added after cancellation or an exhausted goal budget. Loading saved project knowledge in another chat consumes the instruction loader's project-chain budget.

#### KV Cache effect

Assessment and tool results append to retained history. Changed knowledge reaches existing chats through logged instruction refresh; fresh chats load its current contents in their initial instruction baseline.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Observed files only** — consolidation requires complete originals explicitly read in the active phase; it does not search every project guide.
- **Per-file publication** — multiple edits are version-guarded and serialized, but are not one filesystem transaction; a later failure explicitly reports earlier changed files for re-reading, without rolling them back.
- **Finite context budgets** — large project knowledge can be omitted or truncated by instruction loading; retain current facts concisely and link detailed references.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Keep maintenance authority rooted in the live Agent and its scoped services. Durable observations support recovery and do not grant permission to overwrite a changed file.

</details>
