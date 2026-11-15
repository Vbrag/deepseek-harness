---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-15-orchestration-routing

[English](2026-11-15-orchestration-routing.md) | 中文

## 概述

确认当前源码树声明的编排模式事件及已有的待办事项协调消息来源。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-15-orchestration-routing
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-11-05-timeline-priority-notice"
    after: "b2cfa620aded003e20dab4eed1074c94b42bd2c689f422f0adea6fe51b40effd"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-11-05-timeline-priority-notice"
    after: "d64de4a2bb4de9a8a0e3711bc2640af31f099c2347a317f00bda85877241b571"
    decision: same-version
  - root: "event:orchestration/mode"
    previous: null
    after: "e217a63abfb41ed4d6d8cbb1ef8501565a69691021fccd271e70738ae06a1c81"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-11-05-timeline-priority-notice"
    after: "dd702be63d43a79652c38ce05277a3ecb7965945edaf861b3e07463b8d208eb6"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-11-05-timeline-priority-notice"
    after: "4826141ce632215afd02acc78ffe8df4c2d9ba9f2fe0503f4319aee188faa8d6"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

现有记录继续有效，并保留模型可见内容。orchestration/mode 使用独立的仅日志判别值；无法识别此必需事件的旧读取方会拒绝读取，而不会重新解释模式或修改已存储的代际文件。新增 todo-reconcile 来源仅包含非空 kind 字段。旧版和当前 Session 恢复路径均保留未知的非空来源种类及其消息内容。路由决策和待生效选择使用可忽略的插件记录。这些新增内容保留当前会话格式；不替换或删除任何已提交的代际文件。

<a id="verification"></a>
## 验证

HEAD 与工作树的源码清单拥有相同的根结构。四个跨版本恢复验证通过两套 Session 实现保留了 user 和 todo-reconcile 消息。核心 Session 测试通过 640 项；插件记录与成员关系的专项测试通过 31 项，包含双模块副本记录回归。node node_modules/vitest/vitest.mjs run packages/todo/todo-reconcile-driver/tests 通过 10 项测试。任务路由策略测试覆盖模式选择的记录与恢复。

<a id="dev-note"></a>
## 开发备注

无。
