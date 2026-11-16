---
description: "为长期任务的用户与维护者提供持久的未完成工作报告和明确的继续操作。"
kind: "package-reference"
---

# @deepseek-ai/dsh-work-handoff

[English](README.md) | 中文

## 概述

`dsh-work-handoff` 在执行停止时保存未完成工作，包括 goal 轮次耗尽、输出上限、取消与错误。普通模型停止或兼容的历史 limit 记录不会阻止已授权 current-task 列表自动恢复。它结合模型撰写的检查点、有界的已记录证据、当前任务状态和工作区观测。用户可导出 Markdown，或明确选择在当前会话或新会话中继续。保存交接记录不发送模型请求，也不宣称任务已完成。

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

共享 base 在 goal 与 todo 所有者旁挂载此服务。自定义组合需要 Agent、Session 持久化、会话投影与工具服务：

随附 base 要求交接保存、goal 轮次控制与 todo 协调全部激活；任何一项保护无法加载时，启动都会失败。

```yaml
- name: '@deepseek-ai/dsh-work-handoff'
```

### 保存与恢复工作

在预期停止前，模型调用 `work_checkpoint`，提供简明摘要、已报告完成的工作、剩余任务与下一步操作、验证报告和具体阻塞条件。检查点中的声明与已记录的工具证据保持分离。goal 驱动器在轮次额度耗尽时请求宿主保存交接记录；明确暂停与等待、输出上限、取消与执行错误也会保存未完成工作。达到硬性限制后不增加收尾请求。

交接记录包含目标、任务列表、goal 额度、待处理的 job 与子代理、有界工具观测以及可用的 Git 信息。即使可选附件导出失败，Markdown 仍保留在 Session 中。只有 Session 持久化确认交接记录后，`saved` 才变为 true。持久化失败会使报告明确保持未保存状态，并拒绝操作；依赖继续操作前应先恢复存储。

### 自动与明确续行

处于 active 或历史 limit 状态的已授权 current-task 列表在持久化检查后自动恢复。Web 条带显示“正在自动继续”，达到提醒阈值不会要求手动继续。明确暂停、等待、失败、goal 停止、计划、提案与旧列表仍保留各自限制。条带按实际停止状态提供复制、下载、继续工作与在新会话中继续。继续工作会确认当前任务列表（包括旧列表），并排入一次普通续行。在新会话中继续会选择确切的已保存交接记录，检查源目录，并保留源模型选择、Agent preset 与已记录的执行限制。交接记录是需对照工作区验证的上下文，不授予额外权限或计划批准。同一交接记录的重复创建请求共享一个结果。

goal 的默认额度仍为 256 个已准入自动 Round。一个 Round 可包含多个模型步骤；用户轮次不消耗它。todo 的默认值三决定连续无进展停止后何时加强恢复指引，不会结束已授权执行。goal 轮次仍独立计数。

### 保存范围

部署配置通过 `maxEvidence`、`maxTextChars`、`maxPending` 与 `maxPolicyChars` 限制保留的证据、文本、待处理操作标识和复制的策略载荷。`gitTimeoutMs` 与 `processGraceMs` 限制可选只读 Git 检查。报告会明确标识缺失或失败的观测，绝不以编造的结果替代。默认值见[配置目录](../../../docs/config-catalog.zh.md)。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

`ctx.workHandoffs` 负责保存、持久化确认与明确的继续操作。有界的 Session 投影保留最新检查点、工具观测、待处理操作标识、目标引用和策略快照。其客户端值为最新 `WorkHandoffView` 或 null。保存按 Session 串行执行，并标识停止的轮次与 goal 额度，因此重复请求不会产生重复报告。重放 Session 不执行模型请求或工作区检查。

宿主在保存时观测工作区信息，并在渲染 Markdown 时区分模型声明与已验证证据。新会话续行在准入前校验保留的策略数据和当前源目录。插件清理会取消并等待自身的保存与续行操作，然后处置创建的 Agent 句柄。

Agent 所有的服务先通过保留的预设解析，再查询继承的提供方。因此，保存与明确续行会在源 Agent 和目标 Agent 各自的预设 realm 内读取或修改 todo 策略。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Goal 类型与工作交接](../../../docs/subsystems/goal.zh.md)——检查点、保存请求与视图的精确字段。
- [Goal 轮次驱动器](../goal-round-driver/README.zh.md)——自动轮次准入与额度耗尽。
- [Todo 策略](../../todo/tool-todo/README.zh.md)——列表用途与用户授权续行。
- [Web 工作条带](../../client/ui-goal/README.zh.md)——可见状态与导出操作。

-----

<a id="model-experience"></a>
## 模型体验

### 进度检查点与续行

#### 模型看到的内容

`work_checkpoint` 工具接受 `summary`、`completed`、`remaining`、`validation` 与 `blockers`。其结果确认检查点已记录，并明确说明这不代表任务完成。自动或用户触发的续行通过普通保留消息提供已记录的任务上下文，要求模型重新检查工作区信息与权限。

#### Token 影响

宿主保存不消耗模型 Token。检查点工具调用及结果消耗普通请求 Token。`maxTextChars` 限制完整检查点和每条保留证据预览的字符数。保存的 Markdown 包含已接纳的完整任务列表和目标，因此可能更大；明确续行会将其加入普通模型上下文，仍受该请求的上下文准入限制。

#### KV Cache 影响

检查点工具结果追加到当前对话。新会话续行以交接记录开始，不复制源对话。同一会话的续行在保留前缀后追加内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **有界证据**——报告保留预览与引用，不包含每个历史结果。源 Session 与工作区仍是权威依据。
- **不独立评估完成情况**——模型报告的完成与验证仍是声明，并列呈现于已记录的观测旁。
- **续行权限**——已授权 current-task 工作自动恢复；旧列表、提案与明确暂停仍需要相应用户确认。保存的报告不授予权限。
- **存储与工作区可用性**——持久化失败会阻止保存确认；策略数据、组合或源目录不可用可能阻止新会话续行。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

goal 与 todo 所有者决定何时允许继续执行。本服务保留恢复信息并准入已授权续行，不拥有第二个自动循环。

</details>
