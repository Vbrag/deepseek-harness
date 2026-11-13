---
description: "Bundled frontend and GUI authoring patterns skill for React and Next.js component, hook, state, performance, animation, and accessibility work."
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-frontend-patterns

English | [中文](README.zh.md)

## Summary

This package contributes one bundled skill, `frontend-patterns`, that instructs the model how to author React and Next.js frontend and GUI code: component composition, compound components, custom hooks, state management with context and reducer, performance optimizations, form handling, animation, and accessibility. It is an instruction-only knowledge skill — it adds no tools, no executables, and no runtime services. Mount it beside the skill registry and `dsh-tool-skill`, and the skill becomes available in the model's skill catalog alongside the other bundled skills.

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

Mount the plugin to expose the `frontend-patterns` skill to agents. It registers a provider on `ctx.skills` that reads the skill's description at registration and its body on demand.

## When to choose it

Use this skill when the task is authoring or editing frontend or GUI code — React or Next.js components, custom hooks, state management, performance work, animation, or accessibility. It pairs with, but does not replace, the harness's own review and layout guidance for GUI work: the review and responsive skills govern visual and interaction standards, while this skill supplies the component, hook, and state authoring mechanics.

### Mount and configure

Load the plugin alongside the skill registry; it requires `ctx.skills`. It takes no configuration.

```yaml
- name: '@deepseek-ai/dsh-skill'
- name: '@deepseek-ai/dsh-skill-frontend-patterns'
```

### Observable behavior

The skill `frontend-patterns` appears in the model-facing catalog with its description, and loading it returns the full Markdown body. Disposal of the plugin unregisters the provider and removes the candidate from the catalog.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The provider mirrors `skill-office`'s bundled-provider shape, but for a single instruction-only skill: `SKILL_NAMES` holds the one skill name, `apply()` parses the asset's YAML frontmatter to read a description, and registers a `SkillProvider` whose `get()` returns the skill body unchanged from `assets/frontend-patterns/SKILL.md`. No configuration, executables, or runtime resources are resolved — the body is pure Markdown guidance.

Registry precedence, scope, and invocation permissions apply to every skill as documented by the skill registry. The provider registers no tools; loaded skill results are logged through the generic skill loader.

| File | Responsibility |
|---|---|
| [`src/index.ts`](src/index.ts) | Resource registration and unchanged skill body. |

| [`assets/`](assets/) | The bundled `frontend-patterns` skill. |

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

- **Instruction-only** — the skill provides guidance but no executable helpers; a follow-up could pair it with snippets or a scaffold generator.
- **Framework-scoped** — the patterns target the React/Next.js ecosystem and are not a general GUI toolkit.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The reference material for this skill is the `frontend-patterns` skill in the `everything-claude-code` project; it was adapted here to framework-agnostic, DSH-tool-aware guidance and cross-linked to the harness review and responsive skills rather than copied verbatim.

</details>
