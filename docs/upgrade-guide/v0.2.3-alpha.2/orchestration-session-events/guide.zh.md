---
kind: upgrade-guide
description: "编排授权和路由使用旧版读取器无法解释的必需 Session 事件。"
---

# 编排 Session 事件

[English](guide.md) | 中文

## 变更

基础配置包含默认关闭的编排服务，Web 应用包含其开关。使用开关或路由的 Session 可能包含新的必需授权和路由事件。旧版读取器会拒绝这些 Session；新运行时仍可读取已有的实验性路由记录。

## 迁移

1. 在会话中启用编排前，同时升级主机及所有 Session 读取器。无法同时更新读取器时，升级前备份 Session 数据。
2. 从基于 `dsh-base` 的自定义配置补丁中删除重复插入的 `orchestration` 或 `ui-orchestration`，改为配置现有条目。优先级更高的主目录补丁和命令行覆盖可能阻止图形界面写入设置。
3. 打开会话，配置模型池，并批准需要新增的子代理路由。确认开关已启用，编排设置中显示所需模型。已有子代理保留其已记录权限。

路由说明见[服务参考](../../../../packages/subagent/orchestration/README.zh.md)，Session 兼容性见[持久化变更记录](../../../persistence-changes/README.zh.md)。
