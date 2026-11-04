---
description: "可选的 Orchestration Mode 实验性配置文件包：将单个任务拆分为并行子代理，在所选多模型模型池上提供有界的路线故障转移。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-orchestration-profile

[English](README.md) | 中文

## 概述

`dsh-experimental-orchestration-profile` 是一个可选的配置层，用一个包启用 **Orchestration Mode**。在 `dsh-base` 之后应用即可挂载 Orchestration 服务及其 `run_orchestration` 工具，并配以所选的多模型模型池；这样会话可以把一个目标拆分为跨多种模型的独立并行子任务，并在任一子任务失败时使用下一条符合条件的模型路线重新开始，而不是让整个运行失败。本包为实验性质，仅在显式启用时随包提供，绝不会出现在默认包中。

## 目录

- [使用本配置](#use-this-profile)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-profile"></a>
## 使用本配置

安装本包并将其补丁应用在 `dsh-base` 之上，即可为主机添加 Orchestration Mode。补丁会插入服务与工具；模型池在 `tool-orchestration` 配置中选择：

```yaml
- id: tool-orchestration
  name: '@deepseek-ai/dsh-experimental-tool-orchestration'
  config:
    pool:
      - provider: deepseek-official
        model: deepseek-v4-flash
      - provider: deepseek-official
        model: deepseek-v4
```

由于实验隔离禁止在默认包中提供实验包，本配置文件天然为可选开启。它不会禁用正常子代理委托；编排是一种额外的能力，模型可以通过 `run_orchestration` 选择使用。

### 成功与失败的表现

启用 Orchestration Mode 的会话通过把目标拆分为并行子任务、汇总各子任务输出并整合结果来完成其目标。当所有子任务都完成时运行成功；被拒绝的子任务不会被重新路由，而是作为失败的步骤呈现。

-----

<a id="model-experience"></a>
## 模型体验

### 委托的 run_orchestration

#### 模型所见

本包随 profile 的其他部分一起挂载 `run_orchestration` 工具及其 Orchestration 服务。面向模型的工具 schema、子任务提示与结果属于 `@deepseek-ai/dsh-experimental-tool-orchestration` 与 `@deepseek-ai/dsh-experimental-orchestration`；配置文件层本身不贡献任何提示或工具文本。

#### Token 影响

本包没有直接的 token 影响。规划与工作进程调用会在挂载的 `tool-orchestration` 模型池配置的路线上消耗 token。

#### KV Cache 影响

没有直接影响。被组合的服务与工具拥有任何模型可见的上下文；配置文件层不添加任何内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **模型池为静态配置** — 模型池在配置补丁中设置；按会话的 GUI 多模型选择器已推迟。
- **尚无选择器规范项** — 本层添加能力；像 Standard/PTC 那样的首选 Mode 选择项是下一步，需在可运行环境中经 Loader 验证。
- **无持久化** — 运行不会在重启后恢复；每次调用都会重新规划。
- **实验原型，无稳定性承诺** — 本包公开，但在孵化期间其契约与位置可能自由变更。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 — 点击展开</summary>

本开发备注是维护者的工作上下文，显式地不具有权威性。

#### Promotion

Promotion 到产品角色组需要按[实验性子树规则](../AGENTS.md)审查公共契约、限制、测试证据、发布载荷、运行时依赖以及具名的稳定负责人。首选 Mode 选择项与按会话 GUI 模型池选择器是自然的后续步骤。

</details>
