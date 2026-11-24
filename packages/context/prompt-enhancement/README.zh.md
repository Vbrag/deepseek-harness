---
description: "使用有界项目与 Session 上下文执行一次提示词增强。"
kind: "package-reference"
---

# @deepseek-ai/dsh-prompt-enhancement

[English](README.md) | 中文

## 概述

`dsh-prompt-enhancement` 为用户提示词准备有界的辅助模型请求。调用方负责同意、展示与提交；本服务记录完整模型请求和结果，不启动 Agent 轮次。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

对一个提交标识调用一次 `ctx.promptEnhancement.enhance(agent, request, signal)`。请求提供原文、附件引用、所选提供方和模型，以及捕获的端点标识（`expectedEgress`，未知时为 `null`）。持久请求记录先于发送；中断记录会阻止自动重复发送。服务返回增强文本、因长度跳过、失败代码、取消或中断结果。跳过或失败时由调用方决定是否提交原文。

服务读取有界指令预览和相关的近期用户、助手文本，不发送附件内容或可识别的凭据。凭据检测不能识别所有秘密。调用方必须在调用前取得必要的提供方同意并执行授权检查。

即使用户在提交前取消，增强事件仍属于 Session 历史。有权读取历史的人员可以看到记录的提示词、所选上下文和响应。实时对比投影仅在提交后发布条目。

配置保存的 `maxPromptWords` 和 `maxPromptCharacters` 默认值分别为 100 和 2000。显示的提示词以及包含展开引用的序列化提示词都必须符合限制。词按 Unicode 词语片段计算，字符按 Unicode 码点计算。附件名称和所选上下文不计入这两项限制。较长提示词会在查询提供方、收集上下文或记录请求之前跳过。

其他配置默认值为 `maxInputBytes: 65536`、`maxContextBytes: 32768`、`maxOutputTokens: 4096`、`maxStreamBytes: 262144`、`timeoutMs: 30000`。这些限制仅适用于辅助请求，与 Agent 的模型和输出限制独立。`enabled` 默认值为 false；`mode` 默认值为 `automatic`，`provider` 与 `model` 为空时使用 Session 模型。

<a id="understand-the-implementation"></a>
## 理解实现

[服务](src/index.ts)校验所选路由，在发送前持久化请求并记录结果。其[投影](src/projection.ts)阻止已记录的提交自动再次发送。浏览器[控件](../../client/ui-prompt-enhancement/README.zh.md)负责配置设置、提供方授权和审核。

<a id="further-exploration"></a>
## 进一步探索

- [指令加载器](../agent-instructions/README.zh.md)
- [Session 投影](../../session/session-projection/README.zh.md)

<a id="model-experience"></a>
## 模型体验

### 辅助请求

#### 模型看到的内容

模型收到增强指令，以及包含 `original`、`context` 和 `attachments` 字段的 JSON 用户输入。上下文是数据，不是指令来源。

#### Token 影响

启用后的每次尝试最多消耗一次额外模型请求及其有界输出。原始提示词不会为适配预算而截断。

#### KV Cache 影响

辅助请求不改变主对话的请求前缀。辅助调用的缓存复用取决于所选提供方。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 尽管会验证字面内容，模型生成的文本仍可能改变含义；调用方应提供审核。
- 上下文选择与凭据检测是启发式方法，不能确定语义相关性或识别所有秘密。
- Session 无法成功执行持久检查点时不会发送增强请求。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
