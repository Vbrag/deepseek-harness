---
description: "Decompose one task into parallel subagents over a selected multi-model pool with bounded route failover in experimental Orchestration compositions."
kind: "package-reference"
---

# @deepseek-ai/dsh-orchestration

English | [中文](README.zh.md)

## Summary

`dsh-orchestration` adds an `orchestrations` service that turns one raw task into a plan of independent sub-steps, then runs those steps in parallel as spawn subagents, each assigned a model route from a caller-selected pool. When a worker ends in a failure, an error, or the token limit, the run does not stop: the step is restarted on the next eligible pool route within a bounded attempt budget. The package is experimental and has no stability promise.

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

Add this package when one session needs to split a goal into parallel sub-tasks across several models, with automatic replacement of a failed or unresponsive model route instead of failing the whole run.

### When to choose it

Choose it for a single self-contained task with multiple independent decomposable parts and a pool of model routes. It does not coordinate dependencies between steps, persist the plan across restarts, or recover work-in-progress.

### Configure the pool and limits

The service accepts validated deployment limits in its configuration:

| Field | Default | Meaning |
|---|---|---|
| `maxConcurrency` | `3` | Maximum worker sub-steps running at once |
| `maxAttemptsPerStep` | `2` | Maximum attempts per step across all eligible routes |
| `workerTimeoutMs` | `120,000` | Abandon an attempt that runs longer than this, then fail over |
| `defaultToOrchestrator` | `false` | Default orchestration mode for a session with no explicit `/orchestration` selection; the `run_orchestration` tool refuses to delegate outside it |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-orchestration) is the exhaustive source for every accepted field and its JSDoc.

### Select the session mode

Orchestration is a per-session mode. A Default session runs the normal single-model loop; selecting Orchestration lets `run_orchestration` delegate. Choose the mode from the conversation composer's Default/Orchestration menu, or issue `/orchestration on` or `/orchestration off`. The selection is logged as an `orchestration/mode` session event and folded by the `orchestration` projection, so it survives a restart. Between turns a selection applies immediately; during an open turn it stays pending ("Applies from the next step") until the next accepted boundary commits it. `defaultToOrchestrator` seeds sessions that have never made an explicit selection.

### Run an orchestration

Call `ctx.orchestrations.run(parent, task, pool, signal)`. The pool is the ordered list of route choices; each route names a `provider` and `model`. Capability routing is resolved from the investigated provider catalog, not from per-route tags.

```ts
import type { PoolRoute } from '@deepseek-ai/dsh-orchestration'

const pool: readonly PoolRoute[] = [
  { provider: 'uni-paderborn', model: 'gwdg.deepseek-v4-flash-0731' },
  { provider: 'uni-paderborn', model: 'gwdg.glm-5.3-flash' },
]
const result = await ctx.orchestrations.run(parent, 'review the diff and draft a fix', pool, signal)
```

The coordinator plans the task using the parent's selected model and reasoning effort; workers use the separate selected pool. Every step runs as a spawn subagent under `parent`. The returned `OrchestrationResult` lists each step's outcome, routes attempted, replacement attempts, and failed steps.

### What success and failure look like

A step succeeds when a worker finishes with `completed`, and its assistant output is returned. A step fails when its attempts are exhausted or a worker ends in `refusal`; a `refusal` is never routed around, so policy-denied work surfaces as a failed step rather than silently re-running. An empty pool or a pool that resolves to no usable routes rejects with a `CoordinatorError` before any worker starts; an unparseable or empty plan rejects before any worker starts.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the service and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The service composes the stable `ctx.llm` and `ctx.subagents` seams and lives entirely outside the agent loop. Task splitting is a single read-only model call never logged to a Session. Route selection is deterministic and disjoint across attempts, so a replacement never reuses a route that already failed that step.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` schema, `orchestrations` service, run and per-step execution |
| [`src/plan.ts`](src/plan.ts) | Pure route ordering, eligibility, and bounded-attempt logic |
| [`src/coordinator.ts`](src/coordinator.ts) | One-shot LLM task decomposition into a validated plan |
| [`src/types.ts`](src/types.ts) | Public pool, config, plan, worker, and result types |

### Route selection and failover

Each step matches a worker route by required domains, modalities, and context size. Among routes that tie for the best capability match, the scheduler prefers the least-used model so parallel steps spread across the pool instead of piling onto one model; a no-domain step round-robins over every usable route. Attempts for one step never repeat a model. Settled `error`, `aborted`, and `max-tokens` results can start a replacement within `maxAttemptsPerStep`; `refusal` never does. Caller cancellation prevents new attempts but waits for the current activation to settle. A rejected worker start ends that step without failover: it may represent a policy denial or an unknown partial start. `failovers` counts replacement attempts, not failed steps or intentions to retry.

### Budget and cancellation

Worker concurrency is bounded by a simple semaphore at `maxConcurrency`. Each attempt has a `workerTimeoutMs` ceiling; exceeding it disposes the activation and counts as a failed attempt for failover. The run never waits on an activation whose result settles after its timeout, so a non-responding worker cannot hang a step. The caller's `signal` is forwarded to every activation and the coordinator call.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Experimental package reference](../AGENTS.md) — placement, publication, and dependency isolation.
- [Subagent activation](../../../docs/subsystems/subagent.md) — the `spawn` provider and `delivery: caller` semantics the workers rely on.

-----

<a id="model-experience"></a>
## Model Experience

### Coordinator planning

#### What the model sees

One read-only model call splits the raw task into a JSON plan of independent steps. The planning call and its plaintext task are never logged to a Session; the model sees only the resulting plan as structured output, not as a conversation message.

#### Token effect

Each run issues one planning request on the parent's selected route, retaining its selected reasoning effort. A planning failure produces no step outcomes and consumes only that one request.

#### KV Cache effect

None. The planning call shares no prompt prefix with any later worker and is not part of the Session log.

### Worker attempts

#### What the model sees

Each planned step runs as a fresh, self-contained spawn subagent whose prompt is the step description alone; the worker model sees no parent history. A routed step is delivered with `caller` semantics, so the orchestrator awaits each attempt before deciding a replacement.

#### Token effect

Every worker attempt consumes model tokens on its assigned route. A settled failure that fails over issues a new request on the next eligible route, up to `maxAttemptsPerStep`; each attempt is billed independently.

#### KV Cache effect

No cross-attempt prefix. Each worker is an independent spawn; a failover restarts the step from scratch with no retained KV prefix of the failed attempt.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Flat dependency-free split** — the coordinator emits an independent step set with no ordering, dependency, or merge phase; dependences between steps must be folded into a single step's prompt.
- **No durability** — the plan and step outcomes are not persisted; a process restart does not resume an orchestrated run.
- **Coordinator call is not logged** — the planning model call and the routing decisions are not emitted as Session events, so the model-visible planning input is not reconstructable from the session log; the outer `run_orchestration` tool call does not capture them. This must be addressed before the mode can be relied on for auditability.
- **Mode is session-scoped, logged, recovered, and command-driven** — orchestration mode is a per-Session selection folded from the `orchestration/mode` session event and the `/orchestration` command lifecycle by the `orchestration` projection, so a restart restores the selection. The `run_orchestration` tool refuses to delegate outside Orchestration mode, so a Default session runs normally. `defaultToOrchestrator` seeds sessions with no explicit selection.
- **Attempts can replay side effects** — failover restarts a step from scratch, so a step that partially completed a side-effecting action before failing may repeat it. Steps must be written idempotently.
- **No same-step in-loop failover** — the framework routes only future steps; replacement is a fresh spawn worker on the next settled failure.
- **Experimental prototype with no stability promise** — the package is public, but its contracts can change freely while it incubates.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is explicitly non-authoritative.

#### Promotion

Promotion to a product-role group requires reviewing the public contract, limitations, test evidence, release payload, runtime dependents, and a named stable owner, per the [experimental subtree rules](../AGENTS.md). A durable plan/task board is the natural next step.

</details>
