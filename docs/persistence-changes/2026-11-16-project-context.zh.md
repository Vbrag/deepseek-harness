---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-16-project-context

[English](2026-11-16-project-context.md) | 中文

## 概述

添加项目文档评估状态、完整原始文档观察记录及带来源标记的维护输入。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-16-project-context
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-11-16-work-continuation"
    after: "254a1fd6191023f9cbe7ea0d7375ee9e10fc8617ccfcf40e828e647fdea4d18b"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-11-16-work-continuation"
    after: "7eb6fd5360a3c2adccc62b3e133a4c4ffdc42da890f08b26f9fb18ed3630adce"
    decision: same-version
  - root: "event:project-context/document-observed"
    previous: null
    after: "7d245e0ce5bdb8b86a8207f9e3989c89e24bd40eff11f15def1fb932861ea1ec"
    decision: same-version
  - root: "event:project-context/status"
    previous: null
    after: "b6cc8e88bd5558480a5c8f08c45a6222027ecd5945b3c5dd561270299f2634be"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-11-16-work-continuation"
    after: "78ca0fa7fe13d2fb7c3453a70ae2525d5ff7bb4f5153051c4b5f90fcd758c56d"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-11-16-work-continuation"
    after: "b5c12bc35c68edafa8fa88a161a9aa0f9937020426d54481fddab84ad5556f6d"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

Session 格式版本保持不变。新事件判别值必须可读，旧读取器会拒绝未知记录，不会将未完成的文档视为已完成。维护输入添加独立消息来源变体；现有历史仍可读取。投影回放恢复状态，不执行文件操作或转移写入权限。

<a id="verification"></a>
## 验证

聚焦投影与驱动测试覆盖检查点后缀回放、子智能体隔离、当前轮次恢复、维护中断及任务与目标继续语义。TypeScript 与 Python SDK 事件消费者保留新类型记录。

<a id="dev-note"></a>
## 开发备注

无。
