---
kind: upgrade-guide
description: "编排模式以带评估的普通子代理及运行中子会话内获授权的模型切换取代独立编排任务。"
---

# 编排模式使用普通子代理与自适应路由

[English](guide.md) | 中文

## 变更

编排模式通过获准模型池路由普通新建子代理。`run_orchestration`、`orchestrations.run` 和 `@deepseek-ai/dsh-tool-orchestration` 连同其独立规划、重试、超时及并发设置一并移除。默认模式保留普通委派。编排包要求 dsh `>=0.2.2-rc.3`。

本地子级可在自身持有的不可变授权内切换模型，保留 Session、inbox、历史及已完成效果。祖先可为已停止的子级排队而不唤醒它；之后在编排模式下的获授权恢复会应用该阶段。显式评估的阶段要求持久检查点。压缩之前，压力可促使选择就绪且获准的更大模型。确认的溢出、无效压缩预算、限流、配额失败、超时与反复的空输出上限响应可触发有界恢复。恢复耗尽时明确阻塞，不重启任务或已完成工具。没有授权记录的历史子级保留原始路由，直至获授权的祖先记录直接父级已保存的授权。修改模型池绝不扩大已有权限。

编排模式下每次新建本地委派都要求 `task_assessment`，包括工作流 `agent()` 调用及每次 `ralph` 调用。`outputTokens` 估计路由需求；可选 `maxTokens` 独立设置实际生成上限。配置为确切的 GLM/Qwen 路由提供 8192-token 压缩余量和摘要上限，也覆盖 Web 作用域提供方；显式 Loader 设置优先。`COMPACTION_INVALID_BUDGET` 现在拒绝已知不可行的预算。容量未知时保留普通的警告后继续行为。Session 数据保持当前格式；旧读取器会安全拒绝不支持的必需授权事件。

## 迁移

1. 使用兼容的宿主及链接插件。源码检出先执行 `pnpm run build:artifacts`，再从仓库执行 `pnpm dsh web --no-open`。
2. 移除 `tool-orchestration` 行及依赖。将其 `pool` 移至 `orchestration.config.pool`；移除 `maxConcurrency`、`maxAttemptsPerStep` 与 `workerTimeoutMs`。以普通激活请求替代 `orchestrations.run`。
3. 为普通子代理、工作流子级及 Ralph 调用提供 `task_assessment`。普通编码要求 `coding`；有帮助时使用可选的 `preferredCapabilities: ['reasoning']`。视觉编码工作要求 `coding` 与 `vision`，并包含 image 模态。用 `contextTokens` 估计完整输入；可选响应估计须为正数。需要生成上限时显式设置 `maxTokens`。按有效请求上限检查自定义压缩策略。
4. 为运行中子级指定显式阶段时，调用 `ctx.subagents.requestModelChange()` 并提供目标、评估、原因、检查点和调用方 signal。可选请求中断不会停止正在执行的工具。确认授权和路由状态已持久保存、等待或阻塞安全，且子级身份不变。关闭模式时确认普通继承；开启时确认每条所选路由满足权限、能力及有效预算。参见[路由](../../../../packages/experimental/dsh-orchestration/README.zh.md)、[工作流](../../../../packages/workflow/workflow/README.zh.md)与 [Ralph](../../../../packages/experimental/tool-ralph/README.zh.md)。
