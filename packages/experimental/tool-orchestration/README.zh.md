---
description: "面向模型的 run_orchestration 工具，基于可选的 Orchestration 服务：将任务拆分为并行子代理，在所选多模型模型池上提供有界的路线故障转移。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-orchestration

[English](README.md) | 中文

## 概述

`dsh-tool-orchestration` 向模型提供一个 `run_orchestration` 工具。在挂载了 `@deepseek-ai/dsh-orchestration` 的情况下，该工具将一个目标拆分为独立的并行子任务，并在配置的模型池上运行它们；任一个子任务失败时，会使用模型池中下一条符合条件的路线重新开始，而不是让整个运行失败。本包为实验性质。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

同时挂载 Orchestration 服务与本工具插件：

```yaml
- name: '@deepseek-ai/dsh-orchestration'
- name: '@deepseek-ai/dsh-tool-orchestration'
  config:
    pool:
      - provider: uni-paderborn
        model: gwdg.deepseek-v4-flash-0731
      - provider: uni-paderborn
        model: gwdg.glm-5.3-flash
```

`pool` 即所选的多模型集合，按优先级排序；协调器使用父代理所选的模型规划，每个工作子任务在一条模型池路线上运行，失败的子任务转移到下一条符合资格的路线上。空模型池会让工具调用明确失败，而不会静默地什么都不执行。

### 工具

| 工具 | 用途 |
|---|---|
| `run_orchestration` | 将一个自包含的目标拆分为独立的并行子任务并在模型池上运行，返回每个子任务的输出、所用路线，以及运行级别的故障转移/成功计数 |

模型以 `task` 调用 `run_orchestration`；它返回 `succeeded`、`steps`（每个包含 `id`、`description`、`status`、`output`、`route`、`failedOver`）、`failovers` 与 `failedSteps`。

### 成功与失败的表现

当协调器完成时工具即成功；只有所有子任务都完成时，`succeeded` 才为 `true`。被拒绝的子任务绝不会被重新路由，因此被策略拒绝的工作会作为失败的步骤返回，而不是静默重跑。当调用会话不在编排模式、模型池为空或协调器计划失败时，工具会拒绝（抛出错误）——因此默认会话保持正常的单模型行为，只有激活的编排选择才会委派。

-----

<a id="model-experience"></a>
## 模型体验

### run_orchestration

#### 模型所见

模型看到 `run_orchestration` 工具 schema。其描述与参数名固定了编排策略：当一个目标具有多个独立的可并行部分时优先使用该工具；保持每个子任务提示自包含；在给出最终回答前整合每个返回的子任务输出。

#### Token 影响

工具 schema 与结果文本都是模型可见的 token。执行一次运行还会通过 Orchestration 服务在配置的模型池路线上额外消耗规划与工作进程 token。

#### KV Cache 影响

没有直接影响。每个子任务作为独立的 spawn worker 运行，不共享 KV 前缀；本次运行自身不添加保留的模型上下文。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **配置预置的模型池由 GUI 选择器替换** — 本工具的 `pool` 配置只在服务模型池为空时进行预置；安装的 GUI 面板（`dsh-client-ui-orchestration`）可按部署以持久化的选择替换它。
- **无持久化** — 运行不会在重启后恢复；每次调用都会重新规划。
- **扁平且无依赖的拆分** — 协调器输出的步骤集彼此独立，没有排序或合并阶段。
- **实验原型，无稳定性承诺** — 本包公开，但在孵化期间其契约可能自由变更。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 — 点击展开</summary>

本开发备注是维护者的工作上下文，显式地不具有权威性。

#### Promotion

Promotion 到产品角色组需要按[实验性子树规则](../AGENTS.md)审查公共契约、限制、测试证据、发布载荷、运行时依赖以及具名的稳定负责人。持久化的计划/任务看板是自然的后续步骤。

</details>
