---
name: continuous-learning
description: Extract reusable patterns, error resolutions, and project conventions from completed sessions and turn them into durable, logged learnings. Load when asked to capture knowledge from a finished session, learn from corrections, or synthesize recurring workarounds and debugging techniques.
---

# Continuous learning from sessions

Use this skill when the task is extracting reusable knowledge from completed or in-progress sessions — recurring error resolutions, user corrections, workarounds, debugging techniques, and project conventions — and saving it in a durable, logged form so future sessions can use it.

## When to activate

- Capturing a hard-won error resolution or workaround after a debugging session.
- Synthesizing a recurring user correction into a lasting convention.
- Recording project-specific conventions learned the hard way.
- Turning a one-off technique into a reusable guidance note.

Do **not** capture one-time fixes, simple typos, or external-API transient issues: those add noise without durable value.

## Pattern types worth capturing

| Pattern | What to capture |
|---------|-----------------|
| `error_resolution` | How a specific error was resolved, including the root cause and the fix. |
| `user_corrections` | A lasting correction a user gave that should become a convention. |
| `workarounds` | A solution to a framework, library, or host quirk that will recur. |
| `debugging_techniques` | An effective debugging approach that transfers to other problems. |
| `project_specific` | A convention, layout decision, or constraint specific to the project. |

## Workflow

1. **Review the session** for the pattern types above. Look for places where a lot of effort produced a durable lesson (an error that took several attempts, a correction the user repeated, a quirk you had to discover).
2. **Decide** whether the lesson is durable and reusable versus a one-time fix. Only durable, transferable lessons belong.
3. **Write the learning** as concise, actionable guidance: the situation, the root cause or reason, and the concrete practice to follow next time. Keep it specific enough to act on but general enough to transfer.
4. **Preserve DSH's model-visible invariant**: the learning must be part of the session's logged history. Express it as a visible message, an edit to a documented note, or a skill/note you reference — never as hidden side effects that the model cannot reconstruct from the log.
5. **Store it durably** where future sessions can find it, for example under the project's `.agents/notes/` (or equivalent) following the repository's agent-note and architecture-note rules, or as a new skill/note if it is broadly reusable.

## Guidance for good learnings

- **One home per fact**: capture a specific lesson once, in the most appropriate place, with a pointer where others would look for it. Avoid duplicating it across many files.
- **Durable decision rationale, not transcripts**: record the decision and why, not a play-by-play of the session. Mechanical or one-off edits are exempt.
- **Archived notes are frozen**: if the repository archives notes, do not edit archived records or treat them as current authority.
- **Respect project politics and scope**: follow the repository's rules for when a note or skill is warranted; do not create low-signal entries for trivial work.
- **Clean as you go**: if an existing note is superseded by a new capture, retire or prune it rather than leaving conflicting guidance.

## Cross-reference

In a DeepSeek Harness codebase, follow the repository's agent-notes and skill conventions for where and how learnings are recorded; this skill supplies the extraction workflow and the "durable, logged, one-home-per-fact" discipline, not the note taxonomy itself.
