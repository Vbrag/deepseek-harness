---
description: "可选的 Orchestration Mode 实验性配置文件包：将单个任务拆分为并行子代理，在所选多模型模型池上提供有界的路线故障转移。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-orchestration-profile

[English](README.md) | 中文

## 概述

`dsh-orchestration-profile` 是一个可选的配置层，用一个包启用 **Orchestration Mode**。在 `dsh-base` 之后应用即可挂载 Orchestration 服务及其 `run_orchestration` 工具，并配以所选的多模型模型池；这样会话可以把一个目标拆分为跨多种模型的独立并行子任务，并在任一子任务失败时使用下一条符合条件的模型路线重新开始，而不是让整个运行失败。本包为实验性质，仅在显式启用时随包提供，绝不会出现在默认包中。

## 目录

- [使用本配置](#use-this-profile)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-profile"></a>
## 使用本配置

安装本包并将其补丁应用在 `dsh-base` 之上，即可为主机添加 Orchestration Mode。补丁会插入服务与工具，并预置一个提供商对齐的默认模型池；模型池可通过 GUI 面板或 `tool-orchestration` 配置替换：

```yaml
- id: tool-orchestration
  name: '@deepseek-ai/dsh-tool-orchestration'
  config:
    pool:
      - provider: uni-paderborn
        model: gwdg.deepseek-v4-flash-0731
      - provider: uni-paderborn
        model: gwdg.glm-5.3-flash
```

由于实验隔离禁止在默认包中提供实验包，本配置文件天然为可选开启。它不会禁用正常子代理委托；编排是一种额外的能力，模型可以通过 `run_orchestration` 选择使用。

### 为会话启用 Orchestration Mode

`run_orchestration` 仅在会话处于 Orchestration Mode 时才委派；默认会话会拒绝该工具，因此正常的单模型循环永远不会被静默替换。可在会话作曲者的 Default/Orchestration 菜单中开启该模式，或执行 `/orchestration on`，并用 `/orchestration off` 退出。该选择会被记录并在重启后恢复。

### 成功与失败的表现

启用 Orchestration Mode 的会话通过把目标拆分为并行子任务、汇总各子任务输出并整合结果来完成其目标。当所有子任务都完成时运行成功；被拒绝的子任务不会被重新路由，而是作为失败的步骤呈现。

-----

<a id="model-experience"></a>
## 模型体验

### 委托的 run_orchestration

#### 模型所见

本包随 profile 的其他部分一起挂载 `run_orchestration` 工具及其 Orchestration 服务。面向模型的工具 schema、子任务提示与结果属于 `@deepseek-ai/dsh-tool-orchestration` 与 `@deepseek-ai/dsh-orchestration`；配置文件层本身不贡献任何提示或工具文本。

#### Token 影响

本包没有直接的 token 影响。规划与工作进程调用会在挂载的 `tool-orchestration` 模型池配置的路线上消耗 token。

#### KV Cache 影响

没有直接影响。被组合的服务与工具拥有任何模型可见的上下文；配置文件层不添加任何内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **模型池已预置提供商对齐，随后可通过 GUI 编辑** — 本层附带一个默认模型池，命名基础 profile 所挂载的提供商路由；GUI 面板通过 `persistPool` 替换它，该操作在内存中应用并尽力写入 profile。被拒绝的 profile 写入会保留会话级模型池。
- **模式按会话选择，尚无专门的选择器条目** — 会话通过作曲者的 Default/Orchestration 菜单或 `/orchestration on|off` 切换，尚未成为首选的规范行。
- **无持久化** — 运行不会在重启后恢复；每次调用都会重新规划。
- **尚无无密钥的录制会话快照** — Loader 启动测试确定性地覆盖了组合后的模型可见表面，但录制 `run_orchestration` 会话快照仍需带密钥的维护者执行（`test:snapshot:record`）。
- **实验原型，无稳定性承诺** — 本包公开，但在孵化期间其契约与位置可能自由变更。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 — 点击展开</summary>

本开发备注是维护者的工作上下文，显式地不具有权威性。

#### Promotion

Promotion 到产品角色组需要按[实验性子树规则](../AGENTS.md)审查公共契约、限制、测试证据、发布载荷、运行时依赖以及具名的稳定负责人。首选的 Mode 选择器行与录制会话快照是自然的后续步骤。

</details>
