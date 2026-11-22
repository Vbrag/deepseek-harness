---
kind: upgrade-guide
description: "编排模型池保存和计费失败使用更新后的结果与错误代码。"
---

# 更新编排模型池客户端和计费处理

[English](guide.md) | 中文

## 变更

`persistPool` 接受设置修订号并返回结构化结果，不再返回布尔值。当 `userPoolConfigured` 为 true 时，显式空用户池会禁用路由。网关预算耗尽报告为 `BILLING_EXHAUSTED`。

## 迁移

1. 在调用 `persistPool` 前调用 `getPoolSettingsState`，传入其非空修订号，并处理 `saved`、`stale` 和 `failed` 状态。
2. 对有意设为空的 `userPool` 同时设置 `userPoolConfigured: true`；旧版空覆盖省略该标志时仍继承模型池。
3. 模型失败的消费者应处理 `BILLING_EXHAUSTED`。仅在提供方路由共享同一计费账户时配置相同的 `billingBudgetKey`，并且仅在提供方确认模型免费时标记 `free: true`。
4. 更新后的应用启动后，重新打开编排设置面板，检查有效模型池和保存结果。
