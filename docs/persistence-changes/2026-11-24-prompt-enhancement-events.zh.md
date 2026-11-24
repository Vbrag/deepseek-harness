---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-24-prompt-enhancement-events

[English](2026-11-24-prompt-enhancement-events.md) | 中文

## 概述

在 Session 中记录辅助提示词增强请求、结果及接受的提交内容。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-24-prompt-enhancement-events
baseline: false
changes:
  - root: "event:prompt-enhancement/accepted"
    previous: null
    after: "0076b75b21ecc92d24978c528c3e2ed86250249b238c3ca7a1c3013040a19a9a"
    decision: same-version
  - root: "event:prompt-enhancement/request"
    previous: null
    after: "61d73c7de4357103cb5842ebdd1300497f546218599769f06586b5ddbf874049"
    decision: same-version
  - root: "event:prompt-enhancement/result"
    previous: null
    after: "e67cc98dbed015a6f5d870a5f7147291342e26053094a8b9ddca25be49d73004"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

现有 Session 不包含这些必需事件类型，无需启用增强即可继续读取。当前读取器识别这些独立判别字段，并保留记录的请求、结果及所选文本。不识别必需事件的旧读取器会在执行、修改或恢复截断前拒绝包含该事件的 Session，不会重新解释该事件。Session 头版本和已有事件含义保持不变。记录可能包含原始提示词、选取的上下文及辅助响应，因此有权读取 Session 的人可以查看这些内容。

<a id="verification"></a>
## 验证

持久化历史、提示词增强、当前事件接纳及 TypeScript SDK 投影测试共通过 108 项。接纳测试检查未知必需事件被拒绝且已存数据不会截断。提示词增强投影也由 Python SDK 预期输出和无密钥 Web Session 回放覆盖。

<a id="dev-note"></a>
## 开发备注

无。
