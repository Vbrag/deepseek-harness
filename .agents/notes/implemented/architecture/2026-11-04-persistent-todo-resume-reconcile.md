# Agent Note: Persistent to-do list with resume reconciliation

Status: implemented

English | [中文](2026-11-04-persistent-todo-resume-reconcile.zh.md)

## Problem

The `todos` session projection wiped the standing plan to `null` on every `turn/start`, so one turn after any resume or restart the plan the model had been tracking was gone and a human had to re-derive it. The to-do list held the same lifecycle value as the event-sourced log did, but the fold treated the beginning of each turn as a reset instead of treating the latest whole `todo/write` as authoritative.

## Decision

`dsh-tool-todo`'s `todos` projection now persists the latest whole `todo/write` list across turns and resumed sessions. The fold only changes on `todo/write`; an explicit empty write (`todo_write(todos: [])`) or a human `/todo clear` is the only clear path. The projection `stateVersion` bumps from `2` to `3` so persisted checkpoints refold under the new semantics.

`dsh-todo-reconcile-driver` is a separate host package that, on `agent/created` with source `resume` or `startup`, a non-empty projected list, and a current goal, queues one `<todo_reconcile>` prompt asking the model to reconcile statuses via `todo_write` — instead of prompting the human. It reads the persisted list with `ctx.sessionProjections.snapshot(session).values['todos']` and the goal with `ctx.goals.get(agent)`; it does not register its own `todos` unit (the tool-todo package already owns that key). Admission is one-shot per session lifecycle with the same race fences as `goal-round-driver`: it runs only at whole-agent idle, waits for descendants, requests a durability checkpoint, and withdraws on a competing human prompt. A failed reconcile is logged and disarmed, never retried in a loop.

## Alternatives considered

- **Keep the per-turn wipe and ask the human to re-plan on resume.** Rejected because it preserved the original failure the change exists to remove.
- **Make the reconcile driver own the `todos` projection key.** Rejected because the session-projection registry refuses a second registration of the same key; the driver reads the tool-todo-owned value instead.
- **Re-arm reconcile on later turns.** Rejected because a repeated prompt would fight the model and the human for steering; one admission per resumed lifecycle is enough.

## Consequences

The list survives restart and resume until explicitly cleared; the model owns when to clear it. Resumed sessions with remaining work get one self-service reconcile instead of a human prompt. The client and both SDKs continue to project `todo/write` and `todos` unchanged in shape, but their persisted behavior no longer shows a turn-start wipe.

Focused projection, tool, and reconcile-driver tests pin the durable fold, explicit clear, single-admission reconcile, negative and competing-input cases, and HMR disposal. The upgrade guide records the model-facing change: the list no longer auto-clears each turn.
