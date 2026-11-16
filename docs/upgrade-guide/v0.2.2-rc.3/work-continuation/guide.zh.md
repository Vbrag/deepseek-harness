---
kind: upgrade-guide
description: "Todo 执行列表需要声明用途，续行驱动器需要工作交接服务。"
---

# 自动继续已授权的未完成工作

[English](guide.md) | 中文

## 变更

新建的非空 `todo_write` 列表须声明 `purpose: current-task`（已授权执行）或 `purpose: proposal`（计划）。现有未分类列表必须经用户明确选择继续后才可自动修复。暂停与等待列表保留其停止状态；重写状态不会悄然重新激活它们。

共享 base 包含 `@deepseek-ai/dsh-work-handoff`。goal-round 与 todo-reconcile 驱动器需要其 `workHandoffs` 服务。普通模型停止后，已授权的未完成执行会继续，直到完成或出现实际停止条件。默认值三决定何时加强无进展恢复指引，不构成停止上限，也不要求手动继续。历史 current-task 的 active 或 limit 记录会保留计数并自动恢复；明确暂停与失败限制仍然有效。Goal 续行保持独立的默认值：256 个已准入自动 Round，每个 Round 可包含多个模型步骤。用户轮次不消耗 goal Round。goal 额度耗尽或达到输出上限会保存交接记录，不增加模型请求；额度耗尽既不代表完成，也不代表阻塞。

共享 base 把 `work-handoff`、`goal-round-driver` 与 `todo-reconcile-driver` 标记为 `required: true`；若这些保护无法激活，启动会失败。依赖相同保证的自定义组合必须保留这种必需激活设置。

新的 `todo/policy` 与 `work-handoff/*` Session 记录保留续行决策与恢复信息。不理解这些必需记录的旧读取器会拒绝受影响的会话。参见 [Session 格式兼容性规则](../../../persistence-changes/README.zh.md#compatibility-rules)。

回合失败保留结构化的 `HarnessError.code`；消费方必须在 `UNKNOWN` 之外接受这些领域错误代码。未分类的失败仍使用 `UNKNOWN`。

## 迁移

1. 一起升级宿主、链接的包与 SDK 消费方。保留 Session 存储，并使用兼容读取器打开包含新记录的会话。
2. 在自定义 profile 中，把 `@deepseek-ai/dsh-work-handoff` 挂载到 `@deepseek-ai/dsh-goal-round-driver` 或 `@deepseek-ai/dsh-todo-reconcile-driver` 旁。随附 base 组合已包含它。自定义隔离 Agent 预设必须为 `tool-todo` 行添加 `isolate: { todoPolicy: true }`；全局 profile 行保持全局。
3. 更新自定义 `todo_write` 调用方，为每个新建非空列表分类。暂停执行时，使用 `disposition: paused` 或 `waiting` 并提供 `reason`。现有旧列表需要用户选择继续；不要批量把保存的列表分类为可执行。
4. 确认已授权执行在三次普通提前停止后无需手动点击仍会继续，且历史 current-task limit 记录会自动恢复。提案、暂停列表与等待列表保持停止。goal 耗尽或达到输出上限时，确认已保存交接记录且没有另一次模型调用。
5. 对提案、旧工作、实际暂停与新会话续行保留明确用户批准。耗尽额度的 goal 必须先提高 `maxGoalRounds` 才可恢复同一 goal；选定的已保存交接记录可在保留限制的新会话中开始。失败与导出行为见[工作交接参考](../../../../packages/goal/work-handoff/README.zh.md)。
