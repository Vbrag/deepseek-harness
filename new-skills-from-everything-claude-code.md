# New skills for DSH identified from `everything-claude-code`

Scope of this analysis: the repo at `D:\GitHub\everything-claude-code`, reviewed for
new skills **not yet represented within DeepSeek Harness (DSH)**, focused on
programming, web & GUI design/development, document creation (word processing), and
presentation design/editing.

---

## 1. What the project is

`everything-claude-code` is a **Claude Code plugin** — a battle-tested collection of
agents, skills, hooks, commands, rules, contexts, MCP configs, and Node.js scripts,
evolved over ~10 months of daily use by the author (Anthropic hackathon winner). It
ships as a marketplace plugin and is installed into Claude Code's config.

The whole project is **software-engineering oriented**. Every one of its 11 skills,
9 agents, 15 commands, 8 rules, and MCP catalog is about building, reviewing,
testing, securing, and shipping software. It contains **zero** content about word
processing or presentation design.

### Skill inventory (11 skills)

| Skill dir | Description |
|-----------|-------------|
| `coding-standards` | TS/JS/React/Node authoring standards, naming, immutability, API conventions |
| `backend-patterns` | API design, repository/service layers, caching, middleware, authN/Z, queues |
| `frontend-patterns` | React/Next.js patterns: composition, hooks, state, virtualization, a11y |
| `clickhouse-io` | ClickHouse OLAP tables, query optimization, ETL, cohort/funnel analytics |
| `tdd-workflow` | Test-driven development with 80%+ coverage, unit/integration/E2E |
| `security-review` | Security checklist: secrets, injection, XSS/CSRF, auth, rate limiting |
| `continuous-learning` | Auto-extract reusable patterns from sessions into new skills |
| `strategic-compact` | Suggest manual context compaction at logical task boundaries |
| `eval-harness` | Eval-driven development, pass@k metrics, graders |
| `verification-loop` | 6-phase verify report (build, types, lint, tests, security, diff) |
| `project-guidelines-example` | Template for project-specific architecture/pattern skills |

### Skill format

Each skill is a `SKILL.md` with YAML frontmatter (`name`, `description`) — the **same
format** DSH uses for its `.agents/skills/*/SKILL.md`. This means the content and
packaging pattern are directly portable/adaptable into DSH's skill system.

---

## 2. How DSH's "skills within DSH" compare

"Represented within DSH" = the session skill catalog (`.agents/skills/*` + the
installed skill catalog surfaced through the `skill` tool). Current DSH skills are
**heavily DSH-internal and process-oriented**: code review, PR description, agent
notes, prose standards, error handling, responsive UI, client UI/UX, session
projection, plugin anthology, performance, docs, i18n, upgrade guides, GIF recording.

DSH today has **no general software-engineering authoring/practice skills** (no
generic coding standards, backend patterns, frontend patterns, TDD, security review,
analytics-DB patterns) and **no office-document / presentation skills** at all.

---

## 3. New skills identified — by focus area

Legend: **[Port]** = content exists in `everything-claude-code`, port/adapt into DSH.
**[Author]** = no source content; DSH must author it from scratch (always the case for
the word-processing and presentation areas, which the target repo does not cover).

### A. Programming

New skills DSH does not yet represent:

| New skill | Source | Why it is new to DSH |
|-----------|--------|----------------------|
| `coding-standards` **[Port]** | `skills/coding-standards` | DSH's `dsh-code-review`, `dsh-prose-standard`, `dsh-find-simplifications` are review/process skills for the DSH codebase; none is a general TS/JS/React/Node authoring-standards skill usable across projects. |
| `backend-patterns` **[Port]** | `skills/backend-patterns` | API design, repository/service layers, caching, JWT/RBAC, rate limiting, queueing illustrated with executable TS/Node code. DSH has `dsh-error-handling` but no structural backend-architecture skill. |
| `tdd-workflow` **[Port]** | `skills/tdd-workflow` | Red/Green/Refactor, 80%+ coverage, unit/integration/E2E patterns. DSH's `dsh-ci-test-reliability` and `dsh-pre-push-checks` are CI test-infrastructure/gate skills, not a general TDD methodology skill. |
| `security-review` **[Port]** | `skills/security-review` | Secrets, injection, XSS/CSRF, rate limiting, dependency audit with coverable checklists. DSH's `dsh-code-review` touches quality but has no dedicated security checklist. |
| `clickhouse-io` **[Port]** | `skills/clickhouse-io` | OLAP schema design, query optimization, materialized views, ETL/CDC — a domain DSH has no skill for. |

### B. Web & GUI design and development

| New skill | Source | Why it is new to DSH |
|-----------|--------|----------------------|
| `frontend-patterns` **[Port]** | `skills/frontend-patterns` | React/Next.js component composition, custom hooks, state, memoization, virtualization, a11y. DSH has `dsh-client-ui-ux` and `dsh-responsive-ui`, but those govern **DSH's own client GUI** review; they are not general React/Next.js development patterns. Content overlaps in spirit but is a distinct, general-purpose skill. |
| `web-gui-design` **[Author]** | — | General design skill: layout, spacing, typography, color, component-system design, responsive breakpoints, interaction patterns for user-facing web/GUI work. DSH's GUI skills are internal client review rules, not a design-authoring skill. |

### C. Document creation (word processing)

| New skill | Source | Why it is new to DSH |
|-----------|--------|----------------------|
| `office-document-authoring` **[Author]** | — | Authoring structured word-processing documents (`.docx`/Office output, headings, styles, tables, headers/footers, citations, revisions) from content. DSH has `dsh-doc` but it is specifically DSH **Markdown/website documentation** for the repo — not general word processing. Nothing in the target repo covers this, so it must be authored. |

### D. Presentation design and editing

| New skill | Source | Why it is new to DSH |
|-----------|--------|----------------------|
| `presentation-design` **[Author]** | — | Designing/editing slide decks: narrative structure, information hierarchy per slide, visual rhythm, chart/table use, speaker-notes balance. DSH has `record-browser-gif` (recording) and `dsh-official-plugin-artwork` (icons), but no presentation-authoring/editing skill. Nothing in the target repo covers this; must be authored. |

---

## 4. Priorities and notes

- **Highest-value, lowest-effort** — the five **[Port]** programming skills
  (`coding-standards`, `backend-patterns`, `tdd-workflow`, `security-review`,
  `frontend-patterns`) are ready-to-adapt, well-structured `SKILL.md` files that map
  almost 1:1 onto DSH's skill format. `clickhouse-io` is lower priority unless DSH
  users actually run ClickHouse workloads.
- **Biggest genuine gaps** — the two **[Author]** areas the task names (word
  processing and presentations) are empty *both* in the target repo *and* in DSH.
  These carry the most new capability for DSH but require original authoring, and
  real value depends on DSH's ability to emit binary Office/`.pptx` artifacts (a
  deliverables/attachment concern, per DSH's `deliverables` and `attachment`
  packages).
- **Not recommended** — `continuous-learning`, `strategic-compact`, `eval-harness`,
  `verification-loop`, `project-guidelines-example`: these rest on Claude Code's
  hook/Stop-trigger + slash-command machinery that does not map to DSH's layered
  skill/plugin/guard architecture, and DSH already covers their intent through
  `dsh-session-projection`, compaction, `schedule_*`, and `test:coverage`/gates.
- **Format compatibility** — every target skill already uses the `name` + `description`
  frontmatter `SKILL.md` format DSH expects, so **[Port]** skills can be adapted with
  minimal structural change (rewrite Claude-Code-isms such as `/commands` and hooks
  into DSH tool/skill idioms).

## 5. Field descriptors per area

| Area | Gap exists today? | Source in repo? | Action |
|------|-------------------|-----------------|--------|
| Programming | Yes | Yes (5 skills) | Port + adapt |
| Web & GUI design | Partial | Partial (frontend) | Port frontend-patterns; author web-gui-design |
| Word processing | Yes (full gap) | No | Author office-document-authoring |
| Presentations | Yes (full gap) | No | Author presentation-design |
