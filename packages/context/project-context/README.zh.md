---
description: "在根轮次完成时维护项目知识，通过受保护的 Markdown 整合与新聊天上下文加载保留事实。"
kind: "package-reference"
---

# @deepseek-ai/dsh-project-context

[English](README.md) | 中文

## 概述

`dsh-project-context` 跨聊天维护持久的项目知识。主 Agent 完成普通工作前，会评估根目录的 `PROJECT_CONTEXT.md`，记录有用变更，并报告已更新、无需更改或已延后。目标、工作状态、决策、验证与后续步骤属于此知识文件；长期指令保留在 `AGENTS.md` 和 `CLAUDE.md` 中。明确观察过的重复指南可整合为转发存根，而原始内容保留在 Session 中。Web 状态区分文档维护与任务完成。

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

共享 base 与指令加载器一起启用此服务。自定义组合需同时挂载二者，并保留能够确认写入的 Session 持久化提供方。更改默认文件名时，在两个配置行上设置相同的 `projectContextFileName`。写入方检查当前 Agent 作用域内的加载器，而不会假设其他 preset 的配置适用。禁用指令加载时，也需禁用 `project-context` 配置行。

### 维护项目知识

简洁保留目标、当前与已完成工作、重要决策、验证证据及后续操作。更新过时事实，不要逐轮追加对话记录。新聊天会在项目长期指令之前加载 `PROJECT_CONTEXT.md`，并沿用加载器的既有字节预算。其托管区域保留所有权标记以外的其他人工文本。首个可用根指令候选中的带标记链接指向规范知识文件，不替换既有规则。

主 Agent 可调用 `project_context_read` 获取完整的原始 Markdown 文档，再通过 `project_context_update` 请求精确指南编辑或转发存根。整合需将独有的当前事实保留在规范文件中；替换前会记录指南原文与版本。生成内容、归档、vendor、含作用域指令的文档及长期规则文档受保护，不会自动整合。不会递归遍历文档或自动删除文件。

### 继续与失败

评估在后代工作结束并持久保存检查点后，使用同一根轮次内的普通模型步骤。它没有独立的固定轮数上限，并遵循既有取消、权限、规划限制、目标预算与工作继续策略。子 Agent 不继承维护权限。被中断或失败的评估保留已延后或失败状态；更新笔记不会宣告任务完成，本身也不会消耗新的目标轮次。

写入使用 Agent 的文件系统提供方、普通沙箱策略、完整文件大小限制及观察到的新鲜度令牌。同一文件系统项目的并发更新串行执行；排队请求可在获准执行前取消，意外的外部编辑会拒绝过期写入。权限、存储或取消失败保留可见状态与未完成工作证据。重试前先恢复失败的依赖，并重新评估当前文件。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

`ctx.projectContext` 负责根发现、完整原文观察、逐项目写入队列及受保护发布。Session 投影保留最新源轮次、知识水位与维护状态；维护期间冻结水位，因此文档活动不能递归触发结束处理。回放不执行文件系统写入或模型请求。驱动挂接轮次停止事件，普通任务继续仍由既有组件负责。

作用域内的 `agent-instructions/discovery` 查询提供根标记与候选名。配置不匹配、加载器被禁用、文件系统变化、工作目录变化或新用户输入排队都会使准备失效。插件卸载时会取消并等待其拥有的文件系统操作结束。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [上下文类型](../../../docs/subsystems/context.zh.md) — 精确的状态、文档、工具与发现声明。
- [指令加载器](../agent-instructions/README.zh.md) — 优先级、字节预算与持久的刷新。
- [工作交接](../../goal/work-handoff/README.zh.md) — 未完成工作捕获与继续。
- [配置目录](../../../docs/config-catalog.zh.md) — 部署限制与默认值。

-----

<a id="model-experience"></a>
## 模型体验

### 项目文档评估

#### 模型可见内容

持久的 `project-context` 输入要求评估当前项目知识，并提供观察到的原文。模型在更改其他指南前使用 `project_context_read`，并通过 `project_context_update` 提交 `updated`、`unchanged` 或 `deferred` 与具体摘要来结束评估。普通工具错误可在当前维护阶段内纠正。

#### Token 影响

维护向当前轮次添加普通模型步骤与有界文件观察。取消或目标预算耗尽后不会添加评估请求。在其他聊天中加载保存的项目知识会使用指令加载器的项目链预算。

#### KV Cache 影响

评估与工具结果追加到保留的历史中。变更后的知识通过持久的指令刷新进入现有聊天；新聊天在初始指令基线中加载当前内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **仅限观察过的文件** — 整合要求在当前阶段明确读取完整原文；它不会搜索所有项目指南。
- **逐文件发布** — 多项编辑受到版本保护并串行执行，但不是单个文件系统事务；后续失败会明确报告前面已修改的文件供重新读取，不会将其回滚。
- **有限上下文预算** — 大型项目知识可能在指令加载时被省略或截断；请简洁保留当前事实，并链接详细参考。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

维护权限始终属于实时 Agent 及其作用域服务。持久观察用于恢复，不授予覆盖已变化文件的权限。

</details>
