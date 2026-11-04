---
description: "为选择、组合或调试持久化任务列表自动对账的用户与维护者提供的一次性恢复对账驱动程序。"
kind: "package-reference"
---

# @deepseek-ai/dsh-todo-reconcile-driver

[English](README.md) | 中文

## Summary

`dsh-todo-reconcile-driver` 在恢复的会话仍带有未完成工作时，对其持久化的待办列表进行对账。`dsh-tool-todo` 的列表跨轮次、跨重启持续存在；当 harness 重新打开一个带有非空列表和当前目标的会话时，本驱动会发出**一次**模型提示，展示持久化的列表与目标状态，并要求模型通过 `todo_write` 对状态进行对账——而不是要求人类重新推导计划。它不需要配置。将其与 `dsh-tool-todo` 和 `dsh-goal` 一起挂载，以便恢复的计划保持状态真实，且模型能够接手下一步。

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

当恢复的会话应针对已完成工作对账其持久化计划、且无需人类提示时挂载 `dsh-todo-reconcile-driver`。它与待办工具和目标服务组合：`dsh-tool-todo` 拥有列表，`dsh-goal` 拥有持久化目标，本包读取两者并安排一次对账。

### Compose it

在待办工具和目标服务旁挂载驱动；驱动本身不需要配置。

```yaml
- id: tool-todo
  name: '@deepseek-ai/dsh-tool-todo'
  config:
    allowParallelInProgress: true

- id: todo-reconcile-driver
  name: '@deepseek-ai/dsh-todo-reconcile-driver'
```

目标服务是必需的，用于让驱动读取当前目标；仅挂载驱动而没有目标的组合永远不会对账（没有可锚定计划的对象）。

### When a reconcile occurs

在 `agent/created` 且来源为 `resume`（持久化重载）或 `startup`（新会话）时，当两个条件同时成立——持久化的 `todos` 投影为非空列表、且存在当前目标——驱动会入队恰好一条 `<todo_reconcile>` 提示。它写出 JSON 引用的目标、目标阶段和轮次预算，逐项列出每个持久化条目及其状态，汇总已完成与剩余，并指示模型检查工作区与持久化会话状态，然后通过一次 `todo_write` 写入整体对账后的列表。模型随后的 `todo_write` 会作为新的持久化计划落入 `todos` 投影。

### When reconcile does not happen

当列表为空、没有当前目标、来源为 `clear` 或 `compact`，以及在同一生命周期的后续任何轮次，驱动都会保持沉默——它绝不在单次准入后重新武装。当驱动进入 idle 时若人类消息已在队列中，会撤回对账预留，让人类输入先运行；仍在 idle 时处于队列中的对账提示会被移出收件箱。驱动是尽量而为的一次性操作：若模型调用或写入失败，它会记录并解除武装，而不是循环重试。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

本节说明驱动如何无竞争地安排对账；可观察行为见 [Use this package](#use-this-package)。

### Design

- **读取而非重新占有。** 驱动不会注册自己的 `todos` 投影单元——`dsh-tool-todo` 已拥有该键，重复注册会被拒绝。它改用 `ctx.sessionProjections.snapshot(session).values['todos']` 读取投影值，并用 `ctx.goals.get(agent)` 读取当前目标。
- **一次性准入。** `agent/created` 监听器把会话标记为"待对账"；串行化驱动循环在每个会话生命周期内最多准入一次预留，绝不会在后续轮次重新武装。
- **竞态栅栏。** `agent/pre-step` 监听器在下游监听器之前与之后两次核对完整声明的记录仍属于驱动自身，因此在步骤进入前会拒绝过期、取消或竞争性提示。先到达的人类工作会让驱动让位。
- **持久化检查点。** 入队前，驱动等待 `ctx.sessions.flush()` 并在等待后复核目标与竞争输入，从而让对账基于稳定的日志执行。
- **关闭即失败。** 卸除会关闭准入，以 `parent` 原因取消进行中的工作，并在其事件栅栏保持安装期间等待驱动与 agent 静默。

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：驱动状态机、竞态栅栏、卸除 |
| [`src/prompt.ts`](src/prompt.ts) | 保留的 `<todo_reconcile>` 提示 |

### The reconcile prompt

保留的提示是一个文本块：JSON 引用的目标、阶段与 `roundsStarted/maxGoalRounds` 行，随后是带状态的持久化任务列表、已完成对剩余的汇总，以及明确的对账指令。

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

驱动读取两个投影领域，并把列表策略委托给 `dsh-tool-todo`；阅读以下页面了解周边约定。

- [Todo tool](../tool-todo/README.zh.md) —— 本驱动所对账的持久化列表。
- [Goal service](../../goal/goal/README.zh.md) —— 本驱动用于锚定计划的持久化目标状态。

-----

<a id="model-experience"></a>
## Model Experience

### Reconcile prompt

#### What the model sees

每次准入的对账都是保留的一个用户角色 `<todo_reconcile>` 块，写出完整目标、目标阶段、轮次预算、带状态的持久化列表以及已完成对剩余的汇总，并以调用一次 `todo_write` 写入整体对账后列表的指令结尾。之前的人类消息、目标状态快照、assistant 输出与工具记录仍保留在同一会话历史中。

#### Token effect

每次准入的对账会新增一个固定指令块，外加目标与持久化列表。后续请求会在压缩遮蔽之前重新发送保留的提示；不会创建新的 agent 或复制会话前缀。

#### KV Cache effect

在同一个 epoch 内仅追加：准入的对账在可复用前缀之后扩展既有对话。压缩可能替换派生历史后缀并移动可复用边界。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


这些限制说明驱动何时不合适。它们是当前包约束，不是任务积压。

- **Requires a goal** —— 对账锚定于当前目标；没有目标的持久化列表永远不会触发提示。本包不会创建或恢复目标本身。
- **Best-effort one-shot** —— 失败的对账会被记录并解除武装，而非重试；瞬态模型或持久化失败需要之后由人类授权的恢复。
- **No goal re-arm** —— 重启后活动目标保持解除武装，直到显式恢复；本驱动只读取它，绝不恢复继续。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

本开发备注是维护者的工作上下文；它明确不具权威性。未决方向：对单次对账的异常失败重试策略，以及不依赖当前目标的跨目标对账；两者都按设计留在本包之外。

</details>
