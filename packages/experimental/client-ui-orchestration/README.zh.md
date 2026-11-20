---
description: "使用并排查实验性 Web Orchestration 设置面板：从提供商能力目录中选择多模型模型池，用于 Orchestration Mode。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-orchestration

[English](README.md) | 中文

## 概述

在会话输入栏中选择默认或编排模式，并在编排设置分区中选择子代理模型。输入栏读取会话的主机投影，通过命令服务提交模式选择；它显示等待生效的更改，并报告选择失败，而不会乐观地修改显示的模式。设置面板按提供方分组列出实时提供商目录并显示能力徽章，写入主机共享模型池。通过实验性编排配置包启用这两个控件。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

通过 [`@deepseek-ai/dsh-orchestration-profile`](../orchestration-profile/README.zh.md) 启用本包。这个组合包同时提供 Orchestration 服务与本 Web 面板。Web Client loader 挂载 `/client` export；root Host export 不执行行为，本包也没有用户配置字段。

### 选择会话模式

使用输入栏的模式菜单选择默认或编排模式。只有主机发布编排投影且命令服务可用时，选择器才会显示。等待生效的更改显示“从下一步生效”；命令被拒绝或失败时，保留主机投影中的选择以便重试。共享 Menu 提供键盘导航、Escape 关闭和通过 portal 渲染的浮层。

### 选择模型池

面板展示实时 LLM 注册表报告的每个模型，按提供方分组，并根据目录条目或实时适配器元数据标注能力徽章。勾选或取消勾选某行为本地选择状态；**全选**与**清空**调整该选择；显式的**保存模型池**按钮会把整个池通过 `setPool` 持久化到主机。挂载时读取的模型池会作为面板的初始状态，因此主机当前的所选池即起始状态；当尚未持久化任何选择时，面板默认勾选目录中的每个模型，以便立即可用完整模型池。

面板显示已应用的所选池数量；当模型池为空时显示提示；当主机拒绝更新时显示保存失败提示。仅当主机应用了所选池后保存才报告成功；被拒绝的写入会显示失败提示，而非虚假的成功。主机会在内存中应用所选池，并尝试将选择持久化到配置档；当 `orchestration` 条目的 pool 归发货层所有时，写入会被拒绝，只有内存中的选择会保留（见下方限制）。

### 查看子代理模型切换

打开会话的子代理目录，即可在子代理列表下方查看**子代理模型**。每个已观察到的本地子代理会显示上次记录的请求所用模型、已选下一模型或请求的偏好模型、先前模型以及路由原因。已排队的切换、**正在切换模型**、**等待可用容量**和受阻的切换分别使用不同标签。只有主机发布使用某个模型的请求后，已选或请求的路由才会显示为**上次使用**；尚无请求记录的子代理显示**尚无模型请求**。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

Client export 通过 `ctx.remote.$mount` 挂载 `orchestrations` Remote contribution，然后注册设置面板、一个附加的 `conversation.input.left` 输入栏控件和子代理目录页脚。输入栏读取 `orchestration` 会话投影，通过会话绑定的命令服务提交 `/orchestration on|off`。页脚读取已发布的子代理 `orchestrationRouting` 与 `modelSelection` 投影；既有目录负责刷新子代理，页脚不打开会话，也不扫描日志。销毁插件时，先撤下控件，再撤下 Remote mount。面板的目录来自 Host 的 `getCatalog` Remote，它按提供方分组投影实时 LLM 注册表；精选的 Paderborn 事实仅作为已知路由上的标注。

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

- [Orchestration 配置包](../orchestration-profile/README.zh.md)——挂载本 Client plugin 的公开 opt-in bundle。
- [Orchestration 服务](../dsh-orchestration/README.zh.md)——持有模型池的 Host `orchestrations` 服务。
- [子代理工具](../../subagent/tool-subagent/README.zh.md)——通过任务评估与选定上下文执行普通委派。
- [实验性包](../README.zh.md)——孵化状态与发布规则。

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

- **模型池选择器受目录范围限制** — 面板只列出实时 LLM 注册表公布的提供商；模型仅在提供商报告时出现，目录变更在下次加载页面时生效。
- **需要 Host 服务** — 面板需要由 Orchestration 服务挂载的 `orchestrations` Remote 命名空间；缺失时读写会被拒绝，面板显示保存失败提示。
- **持久化要求用户层条目** — `persistPool` 通过配置档的 `orchestration` 插件条目持久化。当该条目的 pool 归发货 bundle 层所有时，配置编辑器会拒绝写入，保存被报告为失败；只有内存中的选择在本次会话生效。持久化到用户自有存储是后续工作。
- **无按会话覆盖** — 所选模型池是单一的共享主机值，不是按会话或按运行的覆盖。
- **实验原型，无稳定性承诺** — 本包公开，但在孵化期间其契约可能自由变更。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 — 点击展开</summary>

本 Dev Note 是面向维护者的工作上下文，明确不具权威性。

#### Promotion

Promotion 到产品角色组需要按[实验性子树规则](../AGENTS.md)审查公共契约、限制、测试证据、发布载荷、运行时依赖以及具名的稳定负责人。按会话覆盖是自然的后续步骤。

</details>
