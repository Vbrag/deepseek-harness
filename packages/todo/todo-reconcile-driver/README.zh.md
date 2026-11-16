---
description: "在同一轮次继续已授权但未完成的待办工作，并在必须停止执行时保留显式交接记录。"
kind: "package-reference"
---

# @deepseek-ai/dsh-todo-reconcile-driver

[English](README.md) | 中文

## 概述

`dsh-todo-reconcile-driver` 帮助 agent 在最终回复仅承诺继续工作时完成已授权的任务。如果 current-task 列表仍有未完成条目，驱动会要求模型在同一轮次继续。提案仍然只是计划。显式暂停、等待、取消、输出上限和现有目标控制都会得到遵守。模型反复停止且没有净完成进展时，会收到更强的恢复指引，已授权工作继续执行。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

将驱动与待办工具、目标服务和工作交接服务一起挂载。可以没有当前目标，但必须提供目标服务，以便驱动遵守目标的继续执行和暂停控制。

待办和计划模式服务可以归属于 Agent 的隔离预设。驱动读取该 Agent 所保留预设的确切服务所有者，不要求这些服务出现在 Host 的全局上下文中。

```yaml
- name: '@deepseek-ai/dsh-todo-reconcile-driver'
  config:
    maxNoProgressRepairs: 3
```

`maxNoProgressRepairs` 是正整数，默认值为三，用于决定何时开始加强已记录的恢复指引。每次普通提前停止后，已授权的未完成工作都会继续；达到此阈值不需要用户选择继续。已完成条目的数量严格增加时，修复计数重置。goal 轮次、输出上限、明确暂停与失败保留各自停止规则。

新的执行列表声明 `purpose: current-task`，计划提案声明 `purpose: proposal`。旧有未分类列表必须由用户选择继续。模型不能通过静默更改用途或继续状态来激活提案、旧列表或已暂停列表。打开提案、旧列表与明确暂停的工作不构成执行授权。

打开处于 active 或历史 limit 状态的已授权 current-task 列表后，工作交接所有者会检查持久状态与竞争工作，然后自动恢复。已有修复计数保持不变。暂停、等待、提案、旧列表、goal 控制、计划控制与失败工作保留各自限制。持久化提供者缺失或失败时，会在下一次请求前明确停止。

活动目标拥有其继续执行权。已暂停或阻塞的目标继续保持暂停。因输出上限或结束轮次的工具而终止的模型响应不会触发待办修复。工作交接服务负责这些执行结果的恢复报告。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

驱动读取待办工具的投影与当前目标。在可等待的 `agent/turn-stopping` 扩展点，只有模型正常结束才能触发修复。驱动刷新持久化状态、等待活动后代任务结束、再次刷新，然后在增加持久化修复计数并发送引导消息之前复核当前列表、目标、继续状态与取消信号。修复消息进入现有的模型可见会话历史。

待办策略所有者保存用途、暂停状态、已完成数量的历史最高值和修复计数。取消、错误或输出上限的终止事件会在投影回放时暂停活动执行列表。用户选择继续会重置策略，由 Host 调用方安排下一轮次。驱动卸除会停止其等待，并在释放监听器之前等待回调结束。

停止监听器见 [`src/index.ts`](src/index.ts)，持久化策略归属见 [`../tool-todo/src/policy.ts`](../tool-todo/src/policy.ts)。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [待办工具](../tool-todo/README.zh.md)——列表用途与用户显式继续。
- [目标服务](../../goal/goal/README.zh.md)——目标继续执行与暂停。
- [工作交接](../../goal/work-handoff/README.zh.md)——未完成工作报告与用户继续选项。

-----

<a id="model-experience"></a>
## 模型体验

### 同轮次修复

#### 模型看到什么

保留的用户角色 `<todo_continue>` 消息列出未完成条目，要求模型执行下一项、验证已完成工作，并更新完整列表。它还要求模型在暂停执行时记录具体的暂停或等待原因。仅表达行动意图不算完成。

#### Token 影响

每次准入的修复都会新增一个指令块与未完成列表。达到配置的无进展阈值后，会加入更强的恢复指令；已授权工作继续，直到完成或出现实际停止条件。

#### KV Cache 影响

修复消息追加在当前对话的可复用前缀之后，不会创建新 agent 或复制对话。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 任务完成依赖模型记录的状态；驱动不会独立验证工作区结果。提案不会授权执行。旧有或已暂停工作必须由用户显式继续。修复计数决定指引强度；现有目标和执行限制保留各自控制权。

<a id="dev-note"></a>
### 开发备注

todo 策略负责列表分类与修复计数；此驱动器仅通过普通停止扩展点请求续行。
