---
description: "使用 Web 编排开关并为子代理配置模型池。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-orchestration

[English](README.md) | 中文

## 概述

使用输入栏开关为当前会话启用编排，并在编排设置中选择子代理模型和专长。控件显示等待生效的更改并报告选择失败，不会提前修改所显示的模式。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

Web 应用组合包挂载本包，基础配置提供编排服务。Web Client loader 挂载 `/client` export；root Host export 不执行行为，本包也没有用户配置字段。

### 选择会话模式

使用输入栏的编排开关更改当前会话。模型池为空时先选择并保存模型。出现提示时检查并授权新增路由；已有子代理的授权保持不变。等待生效的更改显示“从下一步生效”；请求失败时保留主机投影中的选择以便重试。

### 选择模型池

面板列出提供方模型及其能力徽章。勾选行、**全选**和**清空**调整本地草稿；还可为所选模型指定任务专长。**保存模型池**根据设置修订号持久化两者。打开面板时会刷新有效模型池与目录。显式空池保持为空，新增目录条目不会更改已保存的选择。

面板报告写入成功、失败或修订过期。写入失败时保留草稿，也不会声称已持久化。修订过期时，先刷新设置并检查保留的草稿，再保存。计费额度耗尽后修复账户时，**重试计费受限的模型**可清除已观察到的计费失败，使后续请求可以重试。

### 查看模型切换

打开会话面板即可查看**编排模型**。主会话与每个已观察到的本地子代理会显示上次记录的请求所用模型、已选下一模型或请求的偏好模型、先前模型以及路由原因。主会话保持输入栏中选择的模型；受阻时，面板会提示解决问题或选择其他模型后重试。已排队的切换、**正在切换模型**、**等待可用容量**和受阻的切换分别使用不同标签。只有主机发布使用某个模型的请求后，已选或请求的路由才会显示为**上次使用**；尚无请求记录的会话显示**尚无模型请求**。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

Client export 通过 `ctx.remote.$mount` 挂载 `orchestrations` Remote contribution，然后注册设置面板、附加的 `conversation.input.left` 输入栏控件和 `conversation.session.panel.section` 区域。开关读取 `orchestration` 投影，通过主机检查启用请求，并通过会话绑定的命令服务提交关闭命令。该区域读取已发布的主会话和子代理 `orchestrationRouting` 与 `modelSelection` 投影；它不打开会话，也不扫描日志。面板的目录来自 Host 的 `getCatalog` Remote。

| 文件 | 职责 |
|---|---|
| [`src/client/mount.ts`](src/client/mount.ts) | locale、slot 与 Orchestration Remote registration |
| [`src/client/OrchestrationPanel.tsx`](src/client/OrchestrationPanel.tsx) | 带能力徽章与模型池选择的提供商目录行 |
| [`src/client/OrchestrationRouting.tsx`](src/client/OrchestrationRouting.tsx) | 上次使用和后续子代理模型及其路由进度 |
| [`src/client/locales.ts`](src/client/locales.ts) | 本地化控件与模型进度标签 |
| [`src/index.ts`](src/index.ts) | 不执行行为的 Host entry |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Orchestration 配置包](../../experimental/orchestration-profile/README.zh.md)——可选的帕德博恩默认值。
- [Orchestration 服务](../../subagent/orchestration/README.zh.md)——持有模型池的 Host `orchestrations` 服务。
- [子代理工具](../../subagent/tool-subagent/README.zh.md)——通过任务评估与选定上下文执行普通委派。
- [客户端包](../README.zh.md)——用户界面包。

-----

<a id="model-experience"></a>
## 模型体验

### 模型池选择

#### 模型所见

面板通过 Host `orchestrations` Remote 命名空间写入所选的多模型模型池。池条目是编排模式下普通子代理可选择的 `provider`/`model` 路由；面板本身不注册任何工具、提示分区或面向模型的输入，所选路由在子代理启动时记录。

#### Token 影响

面板本身无 Token 消耗。普通子代理请求在其所选路由上消耗 Token；模型分配不会添加独立的规划请求。

#### KV Cache 影响

无。面板不添加任何模型上下文，也不保留任何 KV 前缀；模型池是主机持有的状态，而不是提示内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **模型池选择器受目录范围限制** — 面板只列出实时 LLM 注册表公布的提供商；模型仅在提供商报告时出现，目录变更在下次打开面板时生效。
- **需要 Host 服务** — 面板需要由 Orchestration 服务挂载的 `orchestrations` Remote 命名空间；缺失时读写会被拒绝，面板显示保存失败提示。
- **配置档覆盖** — 优先级更高的主目录补丁或命令行覆盖可能拒绝模型池写入；面板会报告失败。
- **无按会话覆盖** — 所选模型池是单一的共享主机值，不是按会话或按运行的覆盖。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 — 点击展开</summary>

本 Dev Note 是面向维护者的工作上下文，明确不具权威性。

模型池由当前配置共享；模式选择和路由授权属于各个会话。

</details>
