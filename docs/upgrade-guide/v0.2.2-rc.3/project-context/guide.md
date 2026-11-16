---
kind: upgrade-guide
description: "Base profiles maintain PROJECT_CONTEXT.md at root-turn completion and load it before project standing instructions."
---

# Maintain project context across chats

English | [中文](guide.zh.md)

## Change

Base profiles enable `@deepseek-ai/dsh-project-context`. Before an ordinary lead-Agent turn finishes, the Agent assesses project knowledge through normal model steps and `project_context_update`. The canonical root file defaults to `PROJECT_CONTEXT.md`; the instruction loader reads it before project `AGENTS.md` and `CLAUDE.md`, within its existing byte budget. User-global and scoped instruction selection remains unchanged.

Project knowledge records goals, current and completed work, decisions, verification, and next steps. Standing rules remain authoritative. The writer preserves unrelated canonical-file text outside its managed section and adds a marked pointer to the first available root instruction candidate. Explicitly observed duplicate Markdown guides can become forwarding stubs after their original contents are logged; protected standing rules, generated files, archives, and scoped instructions are not consolidated.

This is a same-turn maintenance phase with no separate fixed round limit. Ordinary permissions, cancellation, plan restrictions, task continuation, and goal budgets remain in force. Its queued, updating, updated, unchanged, deferred, or failed Web status is independent of task completion. Required `project-context/*` records and the `project-context` message source require a compatible Session reader.

## Migration

1. Upgrade linked host and client packages together. Preserve Session storage and use the compatible reader for sessions containing these records.
2. In custom compositions, mount the project-context service with `@deepseek-ai/dsh-agent-instructions`, an acknowledged Session persistence provider, and the Agent's ordinary filesystem and tool services. Shipped base profiles include the service.
3. Keep the default filename or set the same `projectContextFileName` on the writer and loader. It must be a portable root Markdown filename distinct from standing instruction candidates; a missing, disabled, or mismatched loader prevents maintenance. When opting out of instruction loading, also disable the `project-context` row.
4. Review current project knowledge concisely. Preserve unique facts when consolidating guides; forwarding links retain discoverability, while logged originals support recovery. Do not bulk-replace standing instructions with task history.
5. Verify that a normal completed turn reports updated or unchanged, and that a fresh chat loads the current knowledge before standing rules. Interruptions should retain deferred or failed status without silently completing the task. See the [package reference](../../../../packages/context/project-context/README.md) for publication limits and failure recovery.
