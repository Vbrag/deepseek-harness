---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-25-orchestration-pool-snapshot

[English](2026-11-25-orchestration-pool-snapshot.md) | 中文

## 概述

为每次编排启用记录所选模型池的成员身份。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-25-orchestration-pool-snapshot
baseline: false
changes:
  - root: "event:orchestration/pool-snapshot"
    previous: null
    after: "b6ae9be32d8f1971015bc524b8d1dbda437bce855e9a3ff79c67f156a9b2d611"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

当前读取器保留旧模式记录；缺少快照时，新的路由需要重新启用。旧读取器会拒绝新的必需事件，不会将其解释为无限制模型池。现有工作代理及已记录权限得以保留。

<a id="verification"></a>
## 验证

编排、客户端、配置档和 Session 兼容性专项套件通过 186 项测试，包括旧读取器拒绝以及模型池删除和重新加入。

<a id="dev-note"></a>
## 开发备注

无。
