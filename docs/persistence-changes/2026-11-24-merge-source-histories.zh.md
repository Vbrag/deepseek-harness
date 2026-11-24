---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-24-merge-source-histories

[English](2026-11-24-merge-source-histories.md) | 中文

## 概述

合并编排与 SDK 分支独立记录的消息来源历史。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-24-merge-source-histories
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-11-16-project-context"
    additionalPrevious: ["2026-11-19-cua-input-notices"]
    after: "5451e3f3137ab466f245221219450913479a572450c13534692535ac31ab011d"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-11-16-project-context"
    additionalPrevious: ["2026-11-19-cua-input-notices"]
    after: "4ca98b89ce313e87efc1f226b7f591e7d54cc8f004b943f1157450f79a5f3e0e"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-11-16-project-context"
    additionalPrevious: ["2026-11-19-cua-input-notices"]
    after: "a81ca5ae5a4fd5d0f97f5658e485a83d6d5350c548079bfea123b1bc3c8f2313"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-11-16-project-context"
    additionalPrevious: ["2026-11-19-cua-input-notices"]
    after: "7f824e4f0a7d6293ad6f4ac1a4c86236a063a06599ee2f8799f9a7305c1ed0a7"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

四个受影响的事件根保留合并后的来源分支及元数据，包括 SDK 时区、编排和项目上下文归属、工作交接及计算机使用通知。当前读取器保留先前记录的来源对象。已发布的 V4 读取器保留非空生产者 kind 及其 JSON 元数据，包括它不解释的 kind；它也保留 SDK user 来源及时区字段。这些来源记录不改变 Session 头版本或已有事件判别字段。各读取器的具体行为仍由生产者负责；此确认不声称未知外部读取器兼容。

<a id="verification"></a>
## 验证

持久化历史、提示词增强、当前事件接纳及 TypeScript SDK 投影测试共通过 108 项。指令发现、已发布 V4 归属及消息来源测试共通过 248 项，另有三项因平台限制跳过。V4 检查将两条历史的代表性来源值经四个受影响事件位置往返，并保留 user 与 developer 消息派生结果。

<a id="dev-note"></a>
## 开发备注

无。
