---
kind: upgrade-guide
description: "包含提示词增强记录的 Session 需要更新后的 Session 读取器。"
---

# 打开包含提示词增强的 Session

[English](guide.md) | 中文

## 变更

使用提示词增强的 Session 包含新的必需请求、结果和接受记录。更新后的读取器保留原始提示词、增强结果和选定的提交文本。无法识别这些记录的旧读取器会拒绝读取该 Session；不含这些记录的现有 Session 仍可读取。

## 迁移

1. 将打开受影响 Session 的所有应用和 SDK 读取器更新到能识别 `prompt-enhancement/*` 事件的版本。
2. 升级或在不同安装之间移动 Session 前，保留一份备份。包含这些事件的 Session 应继续使用更新后的读取器；没有自动降级转换。
3. 对于源码构建，在启用此功能前完成[持久化类型确认](../../../cookbook/reviewing-persistence-type-changes.zh.md)并重新生成 Session 目录。在增强提交后重新打开 Session，确认原文与已提交文本仍可查看。
