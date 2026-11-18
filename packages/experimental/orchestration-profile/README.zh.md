---
description: "为主动启用的 Harness 配置添加普通子代理的任务感知模型选择。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-orchestration-profile

[English](README.md) | 中文

## 概述

启用编排模式可鼓励模型开展有效的并行委派，并为普通 subagent 分配适合其任务且有可用容量的模型。此可选的实验性层为基于 `dsh-base` 的配置添加模式控件和共享模型池。主代理继续使用会话所选模型。默认模式保留普通委派行为。此组合包要求兼容的主机运行时，默认配置不包含它。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在主动启用的配置中，将此组合包放在 `dsh-base` 之后。其[补丁](cordis.patch.yml)挂载带初始模型池的编排服务及可选 Web 控件。通过配置文件或编排设置面板替换服务的 `pool`。

此配置为 `uni-paderborn` 的确切路由 `gwdg.glm-5.3-flash` 与 `hs-de.qwen3.8-27b` 提供压缩默认值：`headroomTokens: 8192` 和摘要 `maxTokens: 8192`。全局补丁覆盖基础提供方；由 effect 持有的运行时插件为之后的 Web 作用域提供方补齐缺失字段。显式的顶层或确切路由 Loader 配置优先。这些摘要限制不设置工作代理的生成上限或任务评估估计。

在会话输入栏选择编排模式，或使用 `/orchestration on`；选择默认模式或使用 `/orchestration off` 可恢复普通委派。普通子代理工具携带任务评估和选定的上下文。所有必需能力必须同时满足：需要视觉验证的编码任务必须同时具备编码能力和图像理解能力。[服务参考](../dsh-orchestration/README.zh.md)定义评估字段和路由规则。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

此组合包在现有子代理运行时和工具旁插入编排服务及 Web 面板。服务通过运行时已注册的扩展提供模型路由策略。普通激活管理器负责子代理的启动、取消、结果和清理。此组合包不会添加另一套任务执行器。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [编排服务](../dsh-orchestration/README.zh.md)——模式、模型池、任务匹配与配置。
- [普通子代理工具](../../subagent/tool-subagent/README.zh.md)——委派与上下文传递。
- [Web 控件](../client-ui-orchestration/README.zh.md)——模式选择与模型池设置。

-----

<a id="model-experience"></a>
## 模型体验

### 委派路由

#### 模型所见

服务鼓励在现有限制内开展有效的并行委派，并为普通 `subagent` 调用提供路由指引；子代理工具定义任务评估与选定的图像上下文。[服务参考](../dsh-orchestration/README.zh.md#model-experience)说明具体指引。

#### Token 影响

普通主代理和子代理请求在其所选路由上消耗 Token。此组合包不会添加独立的规划请求。

#### KV Cache 影响

新建子代理拥有独立的请求历史。选择路由不会传递主代理的 KV 前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 已记录的模型权限限制路由；修改模型池只为未来会话提供权限默认值。
- 实时配额统计覆盖当前 Harness 实例，不包含共享同一凭据的其他客户端。
- Web 选择器列出 Paderborn 网关目录；其他路由需要显式配置服务。
- 此包处于实验阶段，不提供稳定性承诺。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

无。

</details>
