---
kind: upgrade-guide
description: "Todo execution lists require a declared purpose, and continuation drivers require the work-handoff service."
---

# Continue authorized unfinished work automatically

English | [中文](guide.zh.md)

## Change

New nonempty `todo_write` lists declare `purpose: current-task` for authorized execution or `purpose: proposal` for a plan. Existing unclassified lists require explicit human Continue before automatic repair. Paused and waiting lists retain their suspension; rewriting statuses does not silently reactivate them.

The shared base includes `@deepseek-ai/dsh-work-handoff`. The goal-round and todo-reconcile drivers require its `workHandoffs` service. Ordinary model stops continue authorized unfinished execution until completion or an actual stopping condition. The default of three selects stronger no-progress recovery guidance, with no stopping cap or manual Continue requirement. Historical current-task active or limit records recover automatically while retaining counters; explicit suspension and failure restrictions remain. Goal continuation keeps its independent default of 256 admitted automatic rounds, each of which may contain many model steps. Human turns do not consume goal rounds. An exhausted goal allowance or output limit saves a handoff without an extra model request; exhaustion is not completion or blocking.

The shared base marks `work-handoff`, `goal-round-driver`, and `todo-reconcile-driver` as `required: true`; startup fails if these protections cannot activate. Custom compositions must retain that required activation when relying on the same guarantees.

New `todo/policy` and `work-handoff/*` Session records preserve continuation decisions and recovery facts. Older readers that do not understand these required records refuse affected sessions. See the [Session-format compatibility rules](../../../persistence-changes/README.md#compatibility-rules).

Turn failures preserve a structured `HarnessError.code`; consumers must accept these domain codes alongside `UNKNOWN`. Unclassified failures still use `UNKNOWN`.

## Migration

1. Upgrade the host, linked packages, and SDK consumers together. Preserve Session storage and use the compatible reader when opening sessions written with these records.
2. In custom profiles, mount `@deepseek-ai/dsh-work-handoff` alongside `@deepseek-ai/dsh-goal-round-driver` or `@deepseek-ai/dsh-todo-reconcile-driver`. Shipped base compositions already include it. Custom isolated Agent presets must add `isolate: { todoPolicy: true }` to their `tool-todo` row; global profile rows remain global.
3. Update custom `todo_write` callers to classify each new nonempty list. Use `disposition: paused` or `waiting` with `reason` when execution is suspended. An existing legacy list requires the human Continue action; do not bulk-classify saved lists as executable.
4. Confirm that authorized execution continues beyond three premature ordinary stops without a manual click, and that historical current-task limit records recover automatically. Proposals, paused lists, and waiting lists stay stopped. At goal exhaustion or an output limit, confirm a saved handoff without another model call.
5. Keep explicit user approval for proposals, legacy work, actual suspension, and new-session continuation. An exhausted goal needs a raised `maxGoalRounds` before same-goal resume; a selected saved handoff can start a fresh session with retained restrictions. See the [work-handoff reference](../../../../packages/goal/work-handoff/README.md) for failure and export behavior.
