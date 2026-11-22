---
kind: upgrade-guide
description: "已准备的 LLM 调用提供令牌预算，自动压缩会考虑 TPM 限制。"
---

# 更新已准备调用与 TPM 压缩

[English](guide.md) | 中文

## 变更

`PreparedLlmCall` 新增 `requestTokenBudget(options)`。自动压缩还会考虑路由的每分钟令牌限制，并要求 TPM 驱动的替换持久保存后才能继续。

## 迁移

1. 为自定义 `PreparedLlmCall` 实现及测试替身添加 `requestTokenBudget`；没有已知令牌预算时返回 `undefined`。提供方适配器可在 `PreparedAdapterCall` 上选择实现对应方法。
2. 检查 `compaction-basic` 配置中的 `tpmThresholdRatio` 和 `tpmTargetRatio`。默认值分别为 `0.9` 和 `0.8`；按模型覆盖使用 `modelPolicies`。
3. 预期使用 TPM 压缩时，确保启用会话持久化。替换无法保存时，`COMPACTION_DURABILITY_REQUIRED` 会停止请求。
4. 更新后的应用启动后，检查长请求是否压缩或报告可处理的限制，并确认已完成的工具没有重复执行。

摘要没有文本或未能减少所选历史时，现在分别使用 `COMPACTION_EMPTY_SUMMARY` 或 `COMPACTION_INSUFFICIENT_REDUCTION` 错误代码。当配置的摘要输出上限无法容纳在路由预算内时，TPM 触发的摘要可能使用较低的上限。
