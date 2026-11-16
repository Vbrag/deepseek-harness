---
kind: upgrade-guide
description: "Base profile 在根轮次完成时维护 PROJECT_CONTEXT.md，并在项目长期指令之前加载它。"
---

# 跨聊天维护项目上下文

[English](guide.md) | 中文

## 变更

Base profile 启用 `@deepseek-ai/dsh-project-context`。普通主 Agent 轮次结束前，Agent 通过正常模型步骤与 `project_context_update` 评估项目知识。规范根文件默认为 `PROJECT_CONTEXT.md`；指令加载器在项目 `AGENTS.md` 和 `CLAUDE.md` 之前读取它，并沿用既有字节预算。用户全局与作用域指令的选择方式不变。

项目知识记录目标、当前与已完成工作、决策、验证及后续步骤。长期规则仍具有优先权。写入方保留规范文件托管区域以外的其他文本，并为首个可用根指令候选添加带标记的指针。明确观察过的重复 Markdown 指南在记录原文后可变为转发存根；受保护的长期规则、生成文件、归档与作用域指令不会被整合。

这是同一轮次内的维护阶段，没有独立的固定轮数限制。普通权限、取消、规划限制、任务继续与目标预算仍然适用。其待更新、更新中、已更新、无需更改、已延后或失败的 Web 状态独立于任务完成。必需的 `project-context/*` 记录与 `project-context` 消息来源要求兼容的 Session 读取方。

## 迁移

1. 一起升级关联的宿主与客户端包。保留 Session 存储，并使用兼容读取方打开包含这些记录的会话。
2. 自定义组合需同时挂载 project-context 服务、`@deepseek-ai/dsh-agent-instructions`、能够确认写入的 Session 持久化提供方，以及 Agent 的普通文件系统与工具服务。随附 base profile 已包含此服务。
3. 保留默认文件名，或在写入方与加载器上设置相同的 `projectContextFileName`。它必须是不同于长期指令候选的可移植根 Markdown 文件名；加载器缺失、被禁用或不匹配会阻止维护。选择禁用指令加载时，也需禁用 `project-context` 配置行。
4. 简洁复查当前项目知识。整合指南时保留独有事实；转发链接保留可发现性，持久原文支持恢复。不要将长期指令批量替换为任务历史。
5. 验证普通完成轮次报告已更新或无需更改，新聊天在长期规则之前加载当前知识。中断应保留已延后或失败状态，不能静默完成任务。发布限制与失败恢复见[包参考](../../../../packages/context/project-context/README.zh.md)。
