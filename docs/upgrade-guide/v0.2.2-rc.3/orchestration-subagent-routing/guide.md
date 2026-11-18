---
kind: upgrade-guide
description: "Orchestration replaces separate orchestration tasks with assessed subagents and authorized model changes within running child sessions."
---

# Orchestration uses normal subagents and adaptive routing

English | [中文](guide.zh.md)

## Change

Orchestration mode routes normal spawned subagents through the permitted pool. `run_orchestration`, `orchestrations.run`, and `@deepseek-ai/dsh-tool-orchestration` are removed with their separate planning, retry, timeout, and concurrency settings. Default mode retains ordinary delegation. Orchestration packages require dsh `>=0.2.2-rc.3`.

Local children can change models within an immutable child-owned grant, preserving their Session, inbox, history, and completed effects. An ancestor can queue a stopped child without waking it; the next authorized resume in Orchestration mode applies that phase. Explicit assessed phases require a durable checkpoint. Before compaction, pressure can select a ready larger authorized model. Confirmed overflow, invalid compaction budgets, throttling, quota failures, timeouts, and repeated empty output-limit responses can trigger bounded recovery. Exhausted recovery blocks visibly; tasks and completed tools are not restarted. Historical children without a grant retain their original route until an authorized ancestor records the direct parent's saved authorization. Pool edits never widen existing permissions.

Every fresh local delegation in Orchestration mode requires `task_assessment`, including workflow `agent()` calls and each `ralph` call. `outputTokens` estimates routing needs; optional `maxTokens` independently sets the actual generation cap. The profile gives exact GLM/Qwen routes 8192-token compaction headroom and summary caps, including scoped Web providers; explicit Loader settings win. `COMPACTION_INVALID_BUDGET` now rejects known infeasible budgets. Unknown capacity retains ordinary warning-and-continue behavior. Session data stays at the current format; older readers refuse the unsupported required grant event safely.

## Migration

1. Use a compatible host and linked plugins. For a source checkout, run `pnpm run build:artifacts`, then launch from the repository with `pnpm dsh web --no-open`.
2. Remove `tool-orchestration` rows and dependencies. Move its `pool` to `orchestration.config.pool`; remove `maxConcurrency`, `maxAttemptsPerStep`, and `workerTimeoutMs`. Use normal activation requests instead of `orchestrations.run`.
3. Supply `task_assessment` for normal subagents, workflow children, and Ralph calls. Ordinary coding requires `coding`; use optional `preferredCapabilities: ['reasoning']` when helpful. Visual code work requires both `coding` and `vision`, plus image modality. Estimate complete input with `contextTokens`; keep optional response estimates positive. Set `maxTokens` explicitly when you need a generation cap. Review custom compaction policies against the effective request cap.
4. For explicit running-child phases, call `ctx.subagents.requestModelChange()` with the target, assessment, reason, checkpoint, and caller signal. Optional request interruption leaves executing tools intact. Confirm persisted grants and routing status, safe waiting or blocking, and unchanged child identity. With mode off, confirm ordinary inheritance; with it on, confirm each selected route satisfies permissions, capabilities, and effective budgets. See [routing](../../../../packages/experimental/dsh-orchestration/README.md), [workflow](../../../../packages/workflow/workflow/README.md), and [Ralph](../../../../packages/experimental/tool-ralph/README.md).
