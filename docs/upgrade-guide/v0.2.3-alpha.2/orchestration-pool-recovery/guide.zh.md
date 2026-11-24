---
kind: upgrade-guide
description: "编排模型池保存、计费失败和主模型恢复行为已更改。"
---

# 更新编排模型池客户端和计费处理

[English](guide.md) | 中文

## 变更

`persistPool` 接受设置修订号并返回结构化结果，不再返回布尔值。当 `userPoolConfigured` 为 true 时，显式空用户池会禁用路由。网关预算耗尽报告为 `BILLING_EXHAUSTED`。主会话保持会话中选定的模型，不再在恢复期间自动切换；共享预算阻止主会话分发时报告 `ORCHESTRATION_BILLING_UNAVAILABLE`。本地子代理仍可在获授权的模型池中切换。

## 迁移

1. 在调用 `persistPool` 前调用 `getPoolSettingsState`，传入其非空修订号，并处理 `saved`、`stale` 和 `failed` 状态。
2. 对有意设为空的 `userPool` 同时设置 `userPoolConfigured: true`；旧版空覆盖省略该标志时仍继承模型池。
3. 模型失败的消费者应处理 `BILLING_EXHAUSTED` 和 `ORCHESTRATION_BILLING_UNAVAILABLE`。仅在提供方路由共享同一计费账户时配置相同的 `billingBudgetKey`，并且仅在提供方确认模型免费时标记 `free: true`。
4. 更新后的应用启动后，重新打开编排设置面板，检查有效模型池和保存结果。
5. 主模型受阻时，修正报告的问题并重试，或在输入栏选择其他模型。修复耗尽的计费账户后，在模型池设置中重置计费状态。
