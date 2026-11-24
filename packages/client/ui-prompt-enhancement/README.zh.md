---
description: "提示词增强的输入栏和设置控件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-prompt-enhancement

[English](README.md) | 中文

## 概述

此浏览器插件展示提示词增强开关、模型与审核设置、提供方授权，以及已接收提示词上方的对比。宿主的[prompt-enhancement 服务](../../context/prompt-enhancement/README.zh.md)负责请求、校验和 Session 记录。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

输入栏开关默认关闭，并将状态保存在当前配置中。可在设置中选择自动提交或审核、选择已注册的模型以及调整提示词长度限制。默认限制为 100 个词和 2000 个 Unicode 字符。较长提示词会按原样发送并显示提示。审核允许编辑建议文本或使用原文。取消会保留输入草稿。命令、空提交、只有附件的提交和直接子级聊天不会调用增强。

增强尝试可能在提交前将原始提示词、所选上下文和响应记录到 Session 历史中，即使取消也是如此。有权读取该历史的人员可以查看这些记录。

当专用路由使用不同的提供方端点时，输入栏会在发送上下文前请求授权。稳定端点的授权保存在配置中；没有稳定标识的端点每次提交都需要授权。可在设置中清除已保存的授权。增强失败时使用原文并显示提示。

<a id="understand-the-implementation"></a>
## 理解实现

[控制器](src/client/controller.ts)协调已冻结的输入栏提交、取消和配置设置。[挂载模块](src/client/mount.ts)将它连接到 Conversation 和 Chat slot。

<a id="further-exploration"></a>
## 进一步探索

- [对话输入](../ui-conversation/README.zh.md)
- [Chat](../ui-chat/README.zh.md)

<a id="model-experience"></a>
## 模型体验

### 辅助请求

#### 模型看到的内容

浏览器将原始提示词和附件名称发送给宿主；它不会将附件内容发送给增强模型。宿主提供的有界 `context` 见其[包参考](../../context/prompt-enhancement/README.zh.md)。

#### Token 影响

启用的尝试最多增加一次有界模型请求。

#### KV Cache 影响

辅助请求不改变主对话前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 高亮标记变更范围，多个独立编辑之间未改变的词也可能被包含。
- 模型生成的改写可能改变含义；审核模式允许用户在提交前编辑。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
