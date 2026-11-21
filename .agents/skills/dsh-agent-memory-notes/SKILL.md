---
name: dsh-agent-memory-notes
description: Write a durable session-outcome record after a substantial multi-step task so a later session can reuse the decisions, preference signals, and failures without re-deriving them. Defines the record schema and capture protocol; defers the decision to capture to continuous-learning and note placement and curation to dsh-archive-agent-notes. Use when finishing a long task, after a costly debugging or design session, or when handing work to a future session.
---

# Durable session-outcome records

A session-outcome record is a short, structured note written when a substantial task ends, so the next session starts from the decisions and hard-won facts instead of rediscovering them. This skill owns **the record schema and the capture protocol**. It does not own the judgment of whether a lesson is worth keeping, and it does not own where curated notes live.

Delegate those two:

- **Whether to capture a lesson at all** — the durable-versus-one-off test, and the "one home per fact" rule — belong to the `continuous-learning` skill.
- **Where a durable decision note lives, how it is formatted, and when it is curated or archived** belong to [dsh-archive-agent-notes](../dsh-archive-agent-notes/SKILL.md).

Use this skill to write the record itself once those two have told you it is warranted.

## When to write one

Write a record when all of the following hold:

- The task took several steps, tool calls, or attempts, or crossed more than one file or package.
- A later session would plausibly need the same knowledge — a design decision, a correction you had to absorb, an environment quirk, a command that finally worked.
- The knowledge is durable: it will still be true after this task's diff is forgotten.

Do not write one for a single edit, a typo fix, a trivial question, or a failure whose only lesson is already in the code.

## Record schema

One record per task. Keep it under roughly 60 lines; a record nobody reads has no value.

```markdown
## Task
<one sentence: what was asked and what was delivered>

outcome: success | partial | blocked
scope: <the project area, package, or subsystem this touched>

### Preference signals
- <a constraint or preference the user stated, and the practice it implies next time>
- <quote the instruction when the exact wording changes the interpretation>

### Reusable knowledge
- <a fact a future session needs, with the file path, symbol, or command that proves it>
- <a decision and why the alternatives lost, when the decision will be re-litigated>

### Failures and how to do differently
- <what failed, the concrete cause, and the changed practice>

### References
- <path:line for each claim that can be pointed at>
```

Rules that make a record useful rather than decorative:

- **Each claim cites something checkable** — a path, a line, a command, a test name. An uncited claim is a guess the next session will trust.
- **Record the decision and its cost**, not a narration of the steps taken. Do not include a transcript, tool log, or play-by-play.
- **Preference signals quote the user** when the exact wording matters; otherwise state the practice the signal implies.
- **Failures name the cause**, not just the symptom. "Sandbox blocked the esbuild service worker; run the gate through Node's native type-stripping instead" is usable; "test command failed" is not.
- **Separate the durable from the transient.** A one-off environmental outage is not reusable knowledge.
- **Never record secrets, credentials, tokens, personal paths, or third-party content** you were not asked to preserve.

## Capture protocol

1. Draft the record while the task context is still live, before the final summary.
2. Assign each entry to exactly one section; if a fact fits two, put it where the next reader will look and cross-reference nothing.
3. Check the decisions against the code you actually shipped, and drop any claim the diff does not support.
4. Hand curation to [dsh-archive-agent-notes](../dsh-archive-agent-notes/SKILL.md): if the record states a lasting design decision, that skill decides whether it becomes a durable note, where it lives, and when it is retired. This schema is not an alternative note taxonomy.
5. Keep the record wherever the project already keeps durable agent knowledge. When the project has no such home, do not invent one — fold the durable parts into the project's existing documentation and the rest into the final summary.

## One owner per rule

This skill owns the record schema, the citation discipline, the section assignment, and the privacy rule for what a record may contain. It delegates the capture decision to `continuous-learning` and note placement, formatting, and curation to [dsh-archive-agent-notes](../dsh-archive-agent-notes/SKILL.md). When this schema and a project's documented note format disagree, the project's format wins and this file should be corrected.
