---
description: "在实验性 Orchestration 组合中，将单个任务拆分为并行子代理，并在所选多模型模型池上提供有界的路由故障转移。"
kind: "package-reference"
---

# @deepseek-ai/dsh-orchestration

[English](README.md) | 中文

## 概述

`dsh-orchestration` 提供一个 `orchestrations` 服务：将一个原始任务拆分为彼此独立的子步骤计划，然后在所选模型池中为每个步骤分配一条模型路由，作为并行生成的子代理运行。当某个工作进程以失败、错误或达到 token 上限而结束时，运行不会终止：在有限的重试预算内，该步骤会使用模型池中下一条符合条件的路由重新开始。本包为实验性质，不提供稳定性承诺。

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

在需要跨多种模型把目标拆分为并行子任务，并在某个模型路由失败或无响应时自动替换为另一条路由的场景下使用本包。

### 何时选择它

适用于单个自包含任务具有多个可独立分解的部分，并且拥有一个模型路由池的情况。它不协调步骤之间的依赖、不跨重启持久化计划，也不恢复进行中的工作。

### 配置模型池与限制

可在配置中设置已验证的部署限制：

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxConcurrency` | `3` | 同时运行的子步骤工作进程上限 |
| `maxAttemptsPerStep` | `2` | 每个步骤在所有符合条件的路由上的最大尝试次数 |
| `workerTimeoutMs` | `120,000` | 尝试运行超过该时长即放弃，并触发故障转移 |
| `defaultToOrchestrator` | `false` | 为没有显式 `/orchestration` 选择的会话提供默认编排模式；`run_orchestration` 工具在该模式之外拒绝委派 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-orchestration)是每个可用字段及其 JSDoc 的详尽来源。

### 选择会话模式

编排是按会话的模式。默认会话运行正常的单模型循环；选择 Orchestration 后 `run_orchestration` 才可委派。可在作曲者的 Default/Orchestration 菜单中选择，或执行 `/orchestration on` 或 `/orchestration off`。该选择被记录为 `orchestration/mode` 会话事件，并由 `orchestration` 投影折叠，因此重启后依然保留。在两次轮次之间选择会立即生效；在打开的轮次内则保持待定（“从下一步开始生效”），直到下一个被接受的边界提交它。`defaultToOrchestrator` 为从未做显式选择的会话提供默认值。

### 运行一次编排

调用 `ctx.orchestrations.run(parent, task, pool, signal)`。`pool` 是路由的有序数组，每项包含 `provider` 与 `model`。能力路由从经过调研的提供方目录解析而来，而不是来自每条路由上的标签。

```ts
import type { PoolRoute } from '@deepseek-ai/dsh-orchestration'

const pool: readonly PoolRoute[] = [
  { provider: 'paderborn', model: 'gwdg.deepseek-v4-flash-0731' },
  { provider: 'paderborn', model: 'gwdg.glm-5.3-flash' },
]
const result = await ctx.orchestrations.run(parent, 'review the diff and draft a fix', pool, signal)
```

协调器使用父代理所选的模型和推理强度规划任务；工作代理使用单独选择的模型池。每个步骤以 `parent` 下的生成子代理形式运行。返回的 `OrchestrationResult` 列出每个步骤的结果、已尝试的路由、替换尝试数和失败步骤数。

### 成功与失败的表现

当某个工作进程以 `completed` 结束时步骤成功，并返回其助手输出。当步骤的尝试次数用尽，或某个工作进程以 `refusal` 结束时步骤失败；`refusal` 绝不会被转移路由，因此被策略拒绝的工作会作为一个失败的步骤呈现，而不是静默重跑。空模型池返回一个空的失败结果；不可解析或空的计划会在启动任何工作进程前被拒绝。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本小节说明服务背后的设计决策并指向实现它们的代码；可观察行为在[使用本包](#use-this-package)中完整覆盖。

### 设计哲学

服务组合稳定的 `ctx.llm` 与 `ctx.subagents` seam，并完全存在于 agent loop 之外。任务拆分是单次只读的模型调用，从不写入会话日志。路由选择是确定性的，并且跨尝试互不重叠，因此替换绝不会重复使用该步骤已失败的路由。

### 源码映射

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config` schema、`orchestrations` 服务、运行与按步骤执行 |
| [`src/plan.ts`](src/plan.ts) | 纯路由排序、资格判定与有界尝试逻辑 |
| [`src/coordinator.ts`](src/coordinator.ts) | 通过单次 LLM 调用把任务分解为已校验计划 |
| [`src/types.ts`](src/types.ts) | 公共的模型池、配置、计划、工作进程与结果类型 |

### 路由选择与故障转移

每个步骤按所需领域、模态和上下文大小匹配工作代理路由。同一步骤的尝试不会重复使用同一模型。已结束的 `error`、`aborted` 和 `max-tokens` 结果可以在 `maxAttemptsPerStep` 范围内启动替换代理；`refusal` 不会触发替换。调用方取消会阻止新尝试，但仍等待当前激活结束。工作代理启动被拒绝时，该步骤直接失败而不切换路由，因为拒绝可能代表策略限制或状态未知的部分启动。`failovers` 统计实际替换尝试，而不是失败步骤或重试意图。

### 预算与取消

工作进程并发由一个简单的信号量以 `maxConcurrency` 为界。每次尝试都有 `workerTimeoutMs` 上限；超过后销毁激活并计为一次失败尝试用于故障转移。运行不会等待结果在超时之后才确定的激活，因此不响应的工作进程不会阻塞步骤。调用方的 `signal` 会转发到每次激活与协调器调用。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [实验性包参考](../AGENTS.md) — 放置、发布与依赖隔离。
- [子代理激活](../../../docs/subsystems/subagent.zh.md) — worker 依赖的 `spawn` 提供方与 `delivery: caller` 语义。

-----

<a id="model-experience"></a>
## 模型体验

### 协调器规划

#### 模型所见

一次只读的模型调用把原始任务拆分为由独立步骤组成的 JSON 计划。该规划调用及其纯文本任务从不写入会话；模型只会把最终计划作为结构化输出看到，而不是作为会话消息。

#### Token 影响

每次运行使用父代理当前选择的路由发起一次规划请求，并保留所选推理强度。规划失败不会产生任何步骤结果，并且只消耗这一次请求。

#### KV Cache 影响

无。规划调用不与任何后续工作进程共享提示前缀，也不属于会话日志。

### 工作进程尝试

#### 模型所见

每个计划步骤都作为一个全新、自包含的生成子代理运行，其提示词就是该步骤的描述；工作进程模型看不到任何父级历史。路由后的步骤以 `caller` 语义投递，因此编排器会在决定替换前等待每次尝试。

#### Token 影响

每次工作进程尝试都在其指定的路由上消耗模型 token。已决出的失败在故障转移时会在下一条符合条件的路由上发起新的请求，最多 `maxAttemptsPerStep`；每次尝试单独计费。

#### KV Cache 影响

尝试之间没有共享前缀。每个工作进程都是独立的 spawn；故障转移会从零开始重启该步骤，不保留失败尝试的 KV 前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **扁平且无依赖的拆分** — 协调器输出的步骤集彼此独立，没有排序、依赖或合并阶段；步骤之间的依赖必须合并进单个步骤的提示中。
- **无持久化** — 计划与步骤结果不会被持久化；进程重启不会恢复一次已开始的运行。
- **协调器调用不写入日志** — 规划模型调用与路由决策不会被作为会话事件发出，因此对模型可见的规划输入无法从会话日志重建；外层的 `run_orchestration` 工具调用并不捕获它们。在依赖该模式用于可审计性之前，必须先解决这一点。
- **模式按会话隔离、已记录日志、可恢复且由命令驱动** — 编排模式由 `orchestration/mode` 会话事件与 `/orchestration` 命令生命周期经 `orchestration` 投影折叠得到，因此重启会恢复选择。`run_orchestration` 工具在非编排模式下拒绝委派，因此默认会话正常运行。`defaultToOrchestrator` 为没有显式选择的会话提供默认值。
- **尝试可能重放副作用** — 故障转移会从零开始重试步骤，因此部分完成副作用动作后失败的步骤可能重复该动作；步骤必须具有幂等性。
- **不支持同一步骤内的循环内故障转移** — 框架只路由未来的步骤；替换是在下一次决出失败时启动一个全新的生成工作进程。
- **实验原型，无稳定性承诺** — 本包公开，但在孵化期间其契约可能自由变更。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文，显式地不具有权威性。

#### 晋升

晋升到产品角色组需要审核公共契约、限制、测试证据、发布载荷、运行时依赖方，以及命名稳定的所有者，相关规则见[实验性子树规则](../AGENTS.md)。持久化的计划/任务看板与 GUI 模型池选择器是自然的下一步。

</details>
