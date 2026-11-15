---
kind: upgrade-guide
description: "编排模式通过普通子代理工具选择模型，并要求兼容的 Harness 运行时。"
---

# 编排为普通子代理选择模型

[English](guide.md) | 中文

## 变更

编排模式从所选模型池中为普通新建子代理分配适合任务的模型。`run_orchestration` 工具和 `@deepseek-ai/dsh-tool-orchestration` 包已移除，其独立的规划、重试、超时和并发设置也已移除。默认模式保留普通的模型继承行为。主代理在编排模式下委派任务时提供结构化的任务评估。

编排相关包要求 dsh `>=0.2.2-rc.3`。旧版已安装主机无法安全加载链接到的新插件。现有会话及其已记录的模型权限保持不变；修改模型池不会扩大已有会话的权限。

## 迁移

1. 主机和链接插件使用同一套兼容的 Harness 安装。对于源码检出，运行 `pnpm run build:artifacts` 构建，然后从仓库根目录运行 `pnpm dsh web --no-open`。
2. 从自定义配置中移除 `tool-orchestration` 条目及依赖。将 `tool-orchestration.config.pool` 移至 `orchestration.config.pool`。移除服务中的旧设置 `maxConcurrency`、`maxAttemptsPerStep` 和 `workerTimeoutMs`。
3. 保留编排服务和可选的 Web 面板。选择编排模式，通过普通子代理工具委派任务；将自定义的 `orchestrations.run` 调用替换为携带任务评估的普通子代理激活请求。
4. 确认可以打开新会话并运行第一个任务。关闭编排模式时确认普通的模型继承行为；开启时确认子代理记录的路由满足任务要求。路由配置与限制请参阅[服务参考](../../../../packages/experimental/dsh-orchestration/README.zh.md)。
