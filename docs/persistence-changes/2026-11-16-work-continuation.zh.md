---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-16-work-continuation

[English](2026-11-16-work-continuation.md) | 中文

## 概述

新增持久化待办授权、完成修复计数和可恢复工作交接。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-16-work-continuation
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-11-15-orchestration-routing"
    after: "aea3ddadd7e8ab98fdf3acdb2c35f09965ab871e55cc69cb1c0584ebed547d68"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-11-15-orchestration-routing"
    after: "159c87abe3f3afa8e713d0d6ac07e8082e2f8631e1c1a4a245c67bd7ef087168"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-11-15-orchestration-routing"
    after: "3ede2a830728d60556d83e6c66e768cc03bacd5daf8cc85d7723ce29c342da32"
    decision: same-version
  - root: "event:todo/policy"
    previous: null
    after: "55a59125c15d762eb8f31c9be30724690159094ce1c5c186997dedbab71607f0"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-11-15-orchestration-routing"
    after: "59b86335bb751049176567b2ce4d9f5c84cda06f1b6839b5c8298be8c5abc5ac"
    decision: same-version
  - root: "event:work-handoff/captured"
    previous: null
    after: "1bbc75e2b064894e604f66ea577690b0d23c26bfcaf6cbac2d5755dd9cd1455f"
    decision: same-version
  - root: "event:work-handoff/checkpoint"
    previous: null
    after: "d2363bc4dc1cc6d1b751e6f37424e84b5636f6268073e16c1bff81c26710faf6"
    decision: same-version
  - root: "event:work-handoff/cleared"
    previous: null
    after: "1abfbe7652bb34115d53f5b0fc07b30149472cdffbf608b01c800781f9201d54"
    decision: same-version
  - root: "event:work-handoff/imported"
    previous: null
    after: "7baf2baf2c611d74c9ff3d3ef30d6ea78c478646aca3ce74922e0d98d580ce50"
    decision: same-version
  - root: "event:work-handoff/saved"
    previous: null
    after: "23d46302319c899792296daef52877199b09a21c07e19338ce22aa2cf6452d19"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

现有 todo/write 和目标记录保持不变。新读取器要求用户明确继续未分类的旧列表。新增的必需 todo/policy 和 work-handoff 事件使旧读取器安全拒绝不支持的工作状态。新增 work-handoff 消息来源保留日志内容；不解释来源的读取器保留消息，不会仅凭来源启动继续操作。现有事件判别值的含义不变。

<a id="verification"></a>
## 验证

工作交接投影、Markdown、策略解析和真实 AgentFactory 服务的 27 项聚焦测试通过。待办策略和继续测试覆盖旧授权、有限修复、进度、取消和目标归属。核心停止原因测试保留 turn/end 语义。

<a id="dev-note"></a>
## 开发备注

无。
