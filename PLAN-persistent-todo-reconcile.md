# Persistent To-Do List with Resume Reconciliation

## Problem & Goal

When a session is interrupted mid-turn and the user re-initiates it, the plan and to‑do list are lost. The root cause is in the `todos` session projection: every `turn/start` wipes the list to `null` (`packages/todo/tool-todo/src/index.ts:130`). So the next turn after any resume/restart clears the plan the model had been tracking.

Goal: make the to‑do list **durable across turns and restarts** until it is explicitly cleared, and — instead of asking the human to re-derive the plan state — make the harness issue **one dedicated model call on resume** that presents the persisted to‑do list plus goal status (done vs remaining) and asks the model to reconcile the statuses via `todo_write` based on the work already done.

### Success criteria
- A `todo_write` list survives `turn/start`, `turn/end`, process restart, and session `resume`; the projection never resets to `null` except before the first write.
- The list is cleared only by an explicit action: the model calling `todo_write(todos: [])`, or a human `/todo clear`.
- On a `resume`/`startup` with a non-empty persisted list (and a current goal), exactly one reconciliation model prompt is emitted that reflects current list + goal state and updates statuses via `todo_write` — no human prompt for that.
- The `stateVersion` of the `todos` projection is bumped so persisted checkpoints refold.
- All tests, snapshot, README, and upgrade-guide surfaces are updated; `pnpm run test`, `typecheck`, `lint`, and `build:check` pass.

---

## Part A — To‑do list persistence (the core change)

### A1. Change the `todos` projection fold
**File:** `packages/todo/tool-todo/src/index.ts` (register block, lines 118–135)

Replace the fold:
```ts
apply: (state, event) => {
  if (event.type === 'todo/write') return event.data.todos
  if (event.type === 'turn/start') return null          // ← remove
  return state
},
```
with a persistence-only fold:
```ts
apply: (state, event) => {
  if (event.type === 'todo/write') return event.data.todos
  return state
},
```
- Value is `null` before the first `todo/write` (unchanged), otherwise the latest whole list forever.
- Explicit clear = `todo_write` with `todos: []` → the list becomes `[]` (empty), which already passes the schema (no `minItems`) and `toTodoList`, and renders zero counts.

**Bump `stateVersion: 2 → 3`** on the same registration. Per `packages/session/session-projection/README.md` (§"ProjectionDefinition" and "Persisted checkpoints"), fold-semantics changes require a version bump so the persisted checkpoint cache (`session-projection-cache`, row `{ver, seq, val}`) refolds and never serves a stale wiped value. No new state fields — the JSON shape is unchanged (`TodoItem[] | null`), so this is a semantics-only bump; the wire schema is unchanged.

### A2. Update `src/types.ts` doc
**File:** `packages/todo/tool-todo/src/types.ts` (lines 30–48)
- Update the `todos` `SessionProjectionMap` JSDoc and the `todo/write` `SessionEventMap` JSDoc to remove the "cleared at turn start" wording and document: the list persists across turns/restarts until an explicit empty `todo_write`/`/todo clear`.
- Keep the `SessionProjectionSummaryExcluded<TodoItem[]> | null` type unchanged (still summary-excluded).

### A3. Tests
**File:** `packages/todo/tool-todo/tests/projection.spec.ts` (lines 87–100)
Replace the "clears the standing plan on the next turn/start" test with one asserting the opposite behavior:
- append `todo_write(list)` → `turn/end` → `turn/start` (turn 2) → expect `values.todos === list` (persisted).
- append `todo_write(todos: [])` → expect `values.todos === []` (explicit clear).
- Keep `asOfSeq` assertions.

**File:** `packages/todo/tool-todo/tests/tool-todo.spec.ts`
- Add a case: `todo_write` with `todos: []` succeeds and produces `counts = {0,0,0}` (explicit clear path is valid end-to-end).
- Existing tests (last-write-wins, replay, no-surface, HMR) remain valid unchanged; verify none assert turn-clearing.

### A4. README and docs
**Files:** `packages/todo/tool-todo/README.md`, `packages/todo/tool-todo/README.zh.md`
- Line 12 already claims "survives across turns and reopened sessions" — resolve the doc/code mismatch in that direction; keep the claim, no change needed there.
- Line 93 documents the old behavior ("cleared when the next turn starts while `turn/end` keeps the finished checklist visible"). Rewrite: the list is the latest `todo/write`, persists across turns and resumed sessions, and is cleared by an explicit empty write (`todo_write(todos: [])`).
- Add to Model Experience: an explicit empty write is the model-facing clear; list statuses may be reconciled by the resume driver (Part B).
- Follow `dsh-prose-standard`; keep English == Chinese alignment.

---

## Part B — Resume reconciliation model call (the user's custom requirement)

New behavior: instead of prompting the human when a resumed session has a stale plan, emit **one dedicated model prompt** that presents the persisted to‑do list + current goal (objective, phase, rounds started/max, done vs remaining) and asks the model to reconcile statuses via `todo_write` based on the work already done.

### B1. New package `packages/todo/todo-reconcile-driver`
Mirror the structure and conventions of `packages/goal/goal-round-driver` (separate package from the data-owning service = capability seam; function/namespace plugin with `name`/`inject`/`apply`, no default export).

- `inject: ['agents', 'goals', 'sessions', 'sessionProjections']`
- Registers with `ctx.sessionProjections` a read handle for the `todos` key (host state `TodoItem[] | null`). Reads goal state via `ctx.goals.get(agent)` (returns `GoalView | undefined`).
- On `agent/created` with `payload.source === 'resume'` (persisted load) **or** `'startup'` (fresh), when:
  - the `todos` projection is non-empty (`Array.isArray(todos) && todos.length > 0`), and
  - a current goal exists (`GoalView` defined),
  then issue **one** reconciliation prompt (single-shot, not a continuing round driver):
  - `agent.followup(createUserMessage({ content: renderTodoReconcilePrompt(todos, goal), source: { kind: ..., id } }))`
- Reuse the `goal-round-driver` race fences: wait for children/subagents at quiescence, request a durability checkpoint (`ctx.sessions.flush(agent.session)`) before admitting, and hook `agent/status === 'idle'` + `agent/pre-step` to admit only when the session is quiescent and this is the only queued input (avoid colliding with a competing human prompt). On a competing human prompt, withdraw the reconcile reservation (do not force it).
- Coalesce via one agent-local serialized driver loop exactly like `goal-round-driver` (`requestDrive`/`drive`), but `drive()` admits at most one reconcile round per resume **and never re-arms on later turns** — a resumption minus reserve flag; mark "reconcile done for this session lifecycle" and only re-trigger on a fresh `agent/created` `resume`/`startup`.
- If the model call or `todo_write` fails, log and disarm the reconcile (do not retry in a loop) — a one-shot best-effort, per `dsh-error-handling`.

### B2. Reconcile prompt rendering
**File:** `packages/todo/todo-reconcile-driver/src/prompt.ts`
`renderTodoReconcilePrompt(todos: TodoItem[], goal: GoalView): ContentBlock[]` — a single text block:
- Lists the current to‑do items with their persisted statuses.
- States the goal objective, phase, and rounds `started/max`; summarizes **done** (todos `completed`) vs **remaining** (`pending`/`in_progress`).
- Instructs the model: inspect the durable session state / workspace for what actually finished, then call `todo_write` with the reconciled whole list (mark finished items `completed`, keep or re-activate the next step). Do not clear the list unless the work is truly abandoned.

Model-visible text is pinned verbatim and covered by snapshot tests (per AGENTS.md model-facing contract rules).

### B3. Profile wiring
**Files:** `packages/bundle/base/cordis.patch.yml`, `packages/bundle/web-app/cordis.patch.yml`, and the web-app presets (`standard.patch.yml`, `ptc.patch.yml`, `cordis.patch.yml` under `packages/bundle/web-app/presets/`) — add the reconcile driver entry next to `tool-todo` / `goal-round-driver`, e.g.:
```yaml
- id: todo-reconcile-driver
  name: '@deepseek-ai/dsh-todo-reconcile-driver'
```
Mirror exactly how `goal-round-driver` and `tool-todo` are listed in each of those files so `verify-cordis-config` passes.

### B4. Reconcile-driver tests
**Directory:** `packages/todo/todo-reconcile-driver/tests/`
- Unit tests on `renderTodoReconcilePrompt` (list + goal + done/remaining, pinned text).
- Integration test (REAL composition per packages/AGENTS.md): mount AgentRegistry, SessionStore, ToolTodo, GoalService, SessionProjectionRegistry, and the reconcile driver with a real `Session`; seed a session with `todo/write` + `goal/change` and emit `agent/created` `resume`, then assert one user message (reconcile prompt) is queued and that a subsequent `todo_write` from the model updates the projection.
- Negative tests: no prompt when list empty or no current goal; no prompt on `clear`/`compact` sources; competing human input cancels the reconcile; no duplicate on later turns in the same lifecycle; HMR disposal removes the driver (`dispose` fiber) with no orphan schedule.

---

## Part C — Durable session goal (project bookkeeping)

- On implementation start (after plan approval), create a durable **goal** for this feature via the goal package's `create` path (e.g. `/goal` or the goal tool) so the objective survives this session's restarts — exercising the very persistence this change improves. Objective captures: "Make the to‑do list persist across turns/restarts until explicitly cleared, and reconcile it on resume via one model call (Part A + Part B)."
- Use `todo_write` to keep an in-turn list; after approval the durable goal and the durable todo list both persist across any resume.

---

## Conventions / cross-cutting (must-follow)

- **Session projection skill** (`dsh-session-projection`): apply to the `todos` fold change — synchronous deterministic fold, unchanged reference for unrelated events, version bump on semantics change (rule 4), tests for checkpoint restore + suffix replay in Part A tests.
- **Persistence-type change**: this alters `todos` projection semantics → acknowledge per `docs/cookbook/reviewing-persistence-type-changes.md`; add a short **Agent Note** (`packages/todo/tool-todo` decision rationale) for the durable change, and record the externally visible behavior change in an **upgrade guide** per `dsh-create-upgrade-guide` (model-facing: list no longer auto-clears each turn; explicit `todo_write([])` clears; optional `/todo clear`).
- **Both SDKs**: `todo/write` event and `todos` projection are projected by the TypeScript and Python SDK surfaces. Check/update SDK expected outputs in the same PR (AGENTS.md "Both SDKs project the loop").
- **Snapshot**: this changes model-visible turns (`todo_write` behavior + new reconcile prompt). Update the keyless recorded-session snapshot per `snapshots/AGENTS.md` and testing policy; the new reconcile prompt needs snapshot-harness support in the same change.
- **`dsh-error-handling`** for the reconcile driver failure paths; **`dsh-prose-standard`** for all docs and prompt text; **`dsh-pre-push-checks`** to select the smallest command set (`pnpm run test` on touched packages, `pnpm run typecheck`, `pnpm run lint`, `pnpm run build:check`).
- No changes to `agent-loop`; the reconcile driver is a new plugin on documented extension points (`agent/created`, `agent/status`, `agent/pre-step`, `sessionProjections`), so `docs/architecture.md` needs only the new-package/entry additions.

## Out of scope (explicitly not in this change)
- **Goal auto-rearm after restart** (disarm-on-load stays; automatic continuation after a quit still needs the human `/goal resume`). The user did not select this; it can be a follow-up.
- Root-causing the tool's mid-turn quit/crash itself (separate investigation).

## Acceptance / verification
1. `pnpm run test` (touched packages: tool-todo, todo-reconcile-driver) green; `projection.spec.ts` turn-persistence + explicit-clear tests pass.
2. `pnpm run typecheck`, `pnpm run lint`, `pnpm run build:check` pass; `verify-cordis-config` passes with the new profile entries.
3. Real-composition integration test confirms one reconcile prompt on `resume` with a non-empty list + active goal; none otherwise.
4. Keyless recorded-session snapshot updated and green.
5. README(s), Agent Note, and upgrade guide updated and consistent with `dsh-doc`/budget checks.
