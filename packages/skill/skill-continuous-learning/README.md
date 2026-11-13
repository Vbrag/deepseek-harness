---
description: "Bundled continuous-learning skill for extracting reusable patterns from sessions."
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-continuous-learning

English | [中文](README.zh.md)

## Summary

This package contributes one bundled skill, `continuous-learning`, that instructs the model how to extract reusable knowledge from completed or in-progress sessions — recurring error resolutions, user corrections, workarounds, debugging techniques, and project conventions — and save it in a durable, logged form. It is an instruction-only knowledge skill: it adds no tools, no executables, and no runtime services. Mount it beside the skill registry and `dsh-tool-skill`, and the skill becomes available in the model's skill catalog alongside the other bundled skills.

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

Mount the plugin to expose the `continuous-learning` skill to agents. It registers a provider on `ctx.skills` that reads the skill's description at registration and its body on demand.

## When to choose it

Use this skill when the task is capturing knowledge from a finished session — a hard-won error resolution, a recurring user correction, a workaround, a debugging technique, or a project convention — and turning it into durable, logged guidance for future sessions. It supplies the extraction workflow and the "durable, logged, one-home-per-fact" discipline; it does not replace the repository's own agent-note and skill conventions for where learnings are recorded.

### Mount and configure

Load the plugin alongside the skill registry; it requires `ctx.skills`. It takes no configuration.

```yaml
- name: '@deepseek-ai/dsh-skill'
- name: '@deepseek-ai/dsh-skill-continuous-learning'
```

### Observable behavior

The skill `continuous-learning` appears in the model-facing catalog with its description, and loading it returns the full Markdown body. Disposal of the plugin unregisters the provider and removes the candidate from the catalog.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The provider mirrors `skill-office`'s bundled-provider shape, but for a single instruction-only skill: `SKILL_NAMES` holds the one skill name, `apply()` parses the asset's YAML frontmatter to read a description, and registers a `SkillProvider` whose `get()` returns the skill body unchanged from `assets/continuous-learning/SKILL.md`. No configuration, executables, or runtime resources are resolved — the body is pure Markdown guidance.

Registry precedence, scope, and invocation permissions apply to every skill as documented by the skill registry. The provider registers no tools; loaded skill results are logged through the generic skill loader.

| File | Responsibility |
|---|---|
| [`src/index.ts`](src/index.ts) | Resource registration and unchanged skill body. |

| [`assets/`](assets/) | The bundled `continuous-learning` skill. |

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

- **Instruction-only** — the skill provides guidance but no executable helpers; a follow-up could pair it with snippets or an automated note organizer.
- **Relies on repository note conventions** — it depends on the repository's agent-note and skill rules for where learnings are stored, so behavior varies with the target repository's taxonomy.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The reference material for this skill is the `continuous-learning` skill from the `everything-claude-code` project; it was adapted here to instruction-only, logged, model-visible guidance and cross-linked to the repository's agent-note conventions rather than copied verbatim.

</details>
