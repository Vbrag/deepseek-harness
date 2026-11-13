---
name: codemap-docs
description: Map a codebase's structure into Markdown codemap documentation — entry points, key modules, data flow, dependencies, and freshness timestamps. Load when generating or updating architecture documentation, READMEs, RUNBOOKs, or per-area codemaps from source code.
---

# Codebase codemap documentation

Use this skill when the task is generating or updating documentation **from a codebase's actual structure** — architectural codemaps, README summaries, per-area guides, or runbooks. Codemaps are derived from the code, not written from memory: documentation that does not match the code is worse than none. Always read the source before documenting it.

## When to activate

- Generating or regenerating architecture/area codemaps from an existing codebase.
- Syncing a README or guide with the current project structure, scripts, and environment.
- Auditing stale documentation against the real code.
- Onboarding a new area: entry points, key modules, data flow, and external dependencies.

## Core principles

1. **Single source of truth is the code** — generate from what you read, never from assumptions.
2. **Freshness timestamps** — every codemap records its `Last updated` date so staleness is visible.
3. **Actionable** — include commands that actually work against the current tree.
4. **Linked and scoped** — cross-reference related areas; keep each codemap focused and under a reasonable length.
5. **Verified** — check that every cited path exists and every snippet is accurate before finishing.

## Workflow

### 1. Discover the repository structure

Use the project's own tooling to map the layout before writing. In a DeepSeek Harness codebase, prefer the workspace tooling and reading real files:

- List the top-level layout and workspace/package layout (for a pnpm workspace, the `packages/*` groups).
- Identify entry points: `src/index.ts`, `apps/*`, package `main`/`exports`, CLI bins.
- Locate package manifests and workspaces to understand grouping.

Use the repository's search and read tools (`glob`, `grep`, `read`) rather than running external generators, unless the project itself ships a codemap generator you are asked to run.

### 2. Map per area

For each area you document:

- **Entry points** — the files that start or export the area.
- **Key modules** — a table of `Module | Purpose | Exports | Dependencies`.
- **Data flow** — a short description or ASCII diagram of how data moves through the area.
- **External dependencies** — the non-local packages and services it uses, with their role.

### 3. Emit codemaps

Structure the output consistently, for example a `docs/CODEMAPS/` tree with an index plus one file per area:

```
docs/CODEMAPS/
├── INDEX.md        # Overview of all areas and how they connect
├── <area>.md       # One codemap per area
```

Use a consistent per-file skeleton:

```markdown
# <Area> Codemap

**Last updated:** YYYY-MM-DD
**Entry points:** <main files>

## Architecture
<ASCII diagram of relationships>

## Key modules
| Module | Purpose | Exports | Dependencies |
|--------|---------|---------|--------------|

## Data flow
<description>

## External dependencies
- <package/service> - role

## Related areas
<links to codemaps that interact with this one>
```

### 4. Sync README and runbooks

When asked to update a project README or runbook, derive it from the same source of truth:

- README: read `package.json` scripts and `.env.example`, then document setup, available scripts, environment variables, and testing.
- RUNBOOK: document deployment procedures, monitoring, common issues and fixes, and rollback from the actual config and code.

### 5. Validate

Before finishing:

- Every file path mentioned exists in the tree.
- Every internal link resolves.
- Every snippet or command reflects the current source.
- Freshness timestamps are current.
- No obsolete references remain.

## Document quality guidance

These are decision rules, not mechanics:

- Keep each codemap focused; split a large codebase into per-area files with an index rather than one giant map.
- Prefer overview-then-detail: an ASCII diagram and a module table communicate more than raw file dumps.
- Note removed or renamed modules explicitly so readers are not misled by stale references.
- Tie every statement to a path or a read; do not describe behavior you did not verify.

## Cross-reference in a DeepSeek Harness codebase

When the documentation is for this repository, follow the repository's documentation conventions for prose, layout, and bilingual line alignment; this skill supplies the derive-from-code workflow, not the prose standard.
