---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-25-orchestration-authorization

[English](2026-11-25-orchestration-authorization.md) | 中文

## 概述

新增必需的编排模式请求、路由、路由状态和子代理模型授权事件。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-25-orchestration-authorization
baseline: false
changes:
  - root: "event:orchestration/mode-request"
    previous: null
    after: "2ac58dc1b9c294d4f7cb4084dc2394becc9721c84967df1ec01e5a20b46d0f07"
    decision: same-version
  - root: "event:orchestration/route"
    previous: null
    after: "53d20adb6a6db92fbfcbca231413554ead80c5423bd62fa46d3176d6e35d4d53"
    decision: same-version
  - root: "event:orchestration/routing-state"
    previous: null
    after: "76804487236b6d64b7066dcb69ccaacb7bb5d2648d6d993eced04681d502fc6e"
    decision: same-version
  - root: "event:subagent/model-selection-policy-authorized"
    previous: null
    after: "f9c115b631988a873b10319b60ab84612fb792115080acd5d796b423129b560f"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

当前读取器接受已有 Session，并回放原有可忽略的实验性模式和路由记录。新的授权事件添加明确批准的路由，不修改已有子代理的授权。不认识新事件名的读取器会拒绝这些必需事件，不会静默忽略权限。由于事件标识允许安全拒绝，Session 头版本保持为 4。

<a id="verification"></a>
## 验证

编排、Session、配置、SDK 和界面的专项套件通过 200 个测试。编排历史与自适应路由测试通过 57 个测试，包括旧版读取器拒绝和旧路由记录回放。三个无需密钥的编排 SDK 快照已成功刷新。

<a id="dev-note"></a>
## 开发备注

无。
