---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-17-running-child-model-policy

[English](2026-11-17-running-child-model-policy.md) | 中文

## 概述

新增由子级自身持有的不可变运行模型授权，用于在本地子级 Session 内进行获授权的模型切换。编排阶段请求及有界恢复状态使用现有的可忽略插件记录表示，并由校验过的投影恢复。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-17-running-child-model-policy
baseline: false
changes:
  - root: "event:subagent/running-model-policy"
    previous: null
    after: "3c4824c63e6bbbdf03636a2c674fe0ade5a741b3ed6a62e9ecd60b6141f8804d"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

Session 版本不变。新读取器接受没有此授权的历史日志，并将这些子级限制在原始路由，直至获授权的祖先记录直接父级已保存的授权。分叉继承的授权被忽略，后续记录不能扩大首份子级自身授权。不认识必需 subagent/running-model-policy 事件的旧读取器会在执行、修改或恢复截断之前拒绝，而不是跳过授权约束。没有该插件的读取器仍将路由状态插件记录保留为可忽略的不透明 JSON；新投影校验递增 revision，仅回放不会授权或应用模型切换。

<a id="verification"></a>
## 验证

node --import tsx/esm node_modules/vitest/vitest.mjs run packages/session/session-persistence-jsonl/tests/current-event-admission.spec.ts packages/core/session/tests/canonical-envelopes.spec.ts --reporter=dot：253 个测试通过，覆盖未知必需事件无截断拒绝及不透明可忽略记录保留。已通过的 78-test 运行时测试包含 subagent model-change 与 reassign-model 覆盖；dsh-orchestration/tests/adaptive.spec.ts 的 10 个测试通过，覆盖阶段及恢复状态。

<a id="dev-note"></a>
## 开发备注

无。
