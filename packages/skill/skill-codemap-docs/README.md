---
description: "Bundled codebase-to-documentation codemap skill for mapping source structure into Markdown codemap documentation."
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-codemap-docs

English | [中文](README.zh.md)

## Summary

This package contributes one bundled skill, `codemap-docs`, that instructs the model how to derive Markdown documentation from a codebase's actual structure — architectural codemaps, README and runbook sync, per-area guides, and stale-documentation audits. It is an instruction-only knowledge skill: it adds no tools, executables, or runtime services. Mount it beside the skill registry and `dsh-tool-skill`, and the skill becomes available in the model's skill catalog.

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

Mount the plugin to expose the `codemap-docs` skill to agents. It registers a provider on `ctx.skills` that reads the skill's description at registration and its body on demand.

## When to choose it

Use this skill when generating or updating documentation from a codebase's structure — architectural codemaps, README summaries, per-area guides, or runbooks. It pairs with but does not replace the repository's own documentation conventions for prose and layout; this skill supplies the derive-from-code workflow.

### Mount and configure

Load the plugin alongside the skill registry; it requires `ctx.skills`. It takes no configuration.

```yaml
- name: '@deepseek-ai/dsh-skill'
- name: '@deepseek-ai/dsh-skill-codemap-docs'
```

### Observable behavior

The skill `codemap-docs` appears in the model-facing catalog with its description, and loading it returns the full Markdown body. Disposal of the plugin unregisters the provider and removes the candidate from the catalog.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The provider mirrors `skill-office`'s bundled-provider shape for a single instruction-only skill: `SKILL_NAMES` holds the one skill name, `apply()` parses the asset's YAML frontmatter to read a description, and registers a `SkillProvider` whose `get()` returns the skill body unchanged from `assets/codemap-docs/SKILL.md`. No configuration, executables, or runtime resources are resolved — the body is pure Markdown guidance.

Registry precedence, scope, and invocation permissions apply to every skill as documented by the skill registry. The provider registers no tools; loaded skill results are logged through the generic skill loader.

| File | Responsibility |
|---|---|
| [`src/index.ts`](src/index.ts) | Resource registration and unchanged skill body. |

| [`assets/`](assets/) | The bundled `codemap-docs` skill. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Skill registry](../skill/README.md) — discovery and precedence.
- [Skill tool](../tool-skill/README.md) — model catalogs and loaded bodies.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-skill`, which renders the skill's description and name into the initial catalog and returns the full instruction body from `skill(name)`.

#### KV Cache effect

The skill body appends to history when loaded; it does not change tool declarations. The body is intended to stay within a token budget comparable to the other bundled authoring skills.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Instruction-only** — the skill provides the workflow but no executable codemap generator; it relies on the project's own read and search tools.
- **Project-scoped by convention** — the README/skill describes a generic workflow and defers layout and prose rules to the repository's documentation conventions.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The reference material for this skill is the `doc-updater` agent and `update-codemaps` command in the `everything-claude-code` project; it was adapted here to an instruction-only workflow routed through the harness's own read, search, and documentation-convention tools rather than external CLI generators.

</details>
