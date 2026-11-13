---
description: "Bundled eval-driven-development skill for defining and running capability and regression evaluations."
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-eval-harness

English | [中文](README.zh.md)

## Summary

This package contributes one bundled skill, `eval-harness`, that instructs the model how to practice evaluation-driven development (EDD): define expected behavior before implementation, run capability and regression evaluations continuously as work proceeds, grade with code, model, or human graders, and track pass@k and pass^k metrics against a baseline. It is an instruction-only knowledge skill — it adds no tools, no executables, and no runtime services. Mount it beside the skill registry and `dsh-tool-skill`, and the skill becomes available in the model's skill catalog alongside the other bundled skills.

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

Mount the plugin to expose the `eval-harness` skill to agents. It registers a provider on `ctx.skills` that reads the skill's description at registration and its body on demand.

## When to choose it

Use this skill when the task benefits from defining success criteria before implementation — planning a feature, verifying that a change does what was intended, running regression evals against a baseline, or confirming a refactor preserved existing behavior. It pairs with, but does not replace, the repository's own gate-selection guidance: this skill supplies the eval-driven framing and the pass@k / pass^k discipline, while the harness's review and testing guidance picks the specific checks that cover the diff.

### Mount and configure

Load the plugin alongside the skill registry; it requires `ctx.skills`. It takes no configuration.

```yaml
- name: '@deepseek-ai/dsh-skill'
- name: '@deepseek-ai/dsh-skill-eval-harness'
```

### Observable behavior

The skill `eval-harness` appears in the model-facing catalog with its description, and loading it returns the full Markdown body. Disposal of the plugin unregisters the provider and removes the candidate from the catalog.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The provider mirrors `skill-office`'s bundled-provider shape, but for a single instruction-only skill: `SKILL_NAMES` holds the one skill name, `apply()` parses the asset's YAML frontmatter to read a description, and registers a `SkillProvider` whose `get()` returns the skill body unchanged from `assets/eval-harness/SKILL.md`. No configuration, executables, or runtime resources are resolved — the body is pure Markdown guidance.

Registry precedence, scope, and invocation permissions apply to every skill as documented by the skill registry. The provider registers no tools; loaded skill results are logged through the generic skill loader.

| File | Responsibility |
|---|---|
| [`src/index.ts`](src/index.ts) | Resource registration and unchanged skill body. |

| [`assets/`](assets/) | The bundled `eval-harness` skill. |

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

- **Instruction-only** — the skill provides definitions, workflow, and grading guidance but no executable eval runner or grader harness; a follow-up could pair it with a reusable eval scaffold or wiring helpers.
- **Gate wiring is the caller's responsibility** — the skill tells the model which harness gates to wire mechanical graders to, but it does not provide the repository's specific gate commands or CI configuration.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The reference material for this skill is the `eval-harness` skill in the `everything-claude-code` project; it was adapted here to an instruction-only, gates-aware form and cross-linked to the repository's gate-selection and testing guidance rather than copied verbatim.

</details>
