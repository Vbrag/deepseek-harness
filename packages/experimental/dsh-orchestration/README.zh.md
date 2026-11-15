---
description: "在实验性编排模式下，为普通子代理委派选择具备所需能力且可用的模型。"
kind: "package-reference"
---

# @deepseek-ai/dsh-orchestration

[English](README.md) | 中文

## 概述

编排模式为每次普通的新建本地子代理委派选择模型。父代理通过普通子代理工具评估任务；本服务检查所有必需能力、预期输入模态和上下文余量，再从获准模型池中选择可用路由。执行、取消、结果交付和清理由普通子代理运行时负责。本实验性包不承诺稳定性。

## 目录

- [使用本包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

将本服务与 LLM、子代理、代理、Session 投影及系统提示服务一同挂载。它注册普通子代理模型路由器和模型池设置 Remote 命名空间，不增加任务规划请求或独立编排工具。

### Session 模式与授权

在对话输入区选择编排模式，或执行 /orchestration on。执行 /orchestration off 可保留普通的父代理路由继承，以及获准的显式或已配置子代理模型选择。轮次之间的选择立即生效；轮次内的选择持久记录，并在下一个被接受、非空且未取消的步骤生效。重启及插件替换均保留待生效选择。

所选模式记录在每个 Session 中。新建本地子代理继承委派获准时捕获的父代理模式，后续委派链也如此；子代理启动期间改变父代理不会改变已捕获模式。分叉和外部提供方保留原有路由行为。

每次选择都必须满足父代理已记录的子模型授权。配置模型池为新建根 Session 提供默认值。保存另一模型池会改变默认值和路由候选项，但不会扩大现有 Session 的权限；未记录授权的历史 Session 只允许父代理路由。

### 任务评估

编排模式下，每次新建本地委派都必须提供 task_assessment。requiredCapabilities 列出所有必需专长：coding、reasoning、vision、allrounder 或 european。preferredCapabilities 列出可选优势。不支持的必需或偏好标签，以及 text/image 之外的模态，会在检查路由前抛出 ORCHESTRATION_INVALID_ASSESSMENT，供调用方纠正拼写错误。模型必须满足每项必需专长；推理能力不能代替编程能力。

contextTokens 估算工作代理所需的完整输入，包括它稍后读取的文件。requiredModalities 列出整个任务需要的输入；即使初始提示只有文本，浏览器或计算机截图任务也应包含 image。outputTokens 可选地提供预期响应余量。

### 配置

pool 字段列出精确的 provider/model 路由。routeCapabilities 为精确路由提供经过验证的专长，并替换精选专长列表；空列表清除这些专长。重复的精确路由声明会被拒绝。设置客户端通过 getCatalog 读取精选网关选项，不直接导入 Host 数据。

contextOverheadTokens 默认为 8192 个令牌，用于子代理指令、工具及请求包装。输入估算取 contextTokens 与初始提示文本及图像估算的较大值，再增加此余量。实际内联图像即使未在评估中声明，也要求图像能力。评估省略 outputTokens 时，outputReserveTokens 默认为 4096；更大的显式子代理输出上限会增加上下文余量。两项余量均是经过验证的部署设置。输入估算与输出余量之和必须适合模型的总上下文容量。路由保留子代理的实际输出上限；普通请求准备和提供方限制仍然适用。

defaultToOrchestrator 默认为 false，仅为尚未记录选择的 Session 写入初始模式。getPool、setPool 和 persistPool 提供模型池选择。persistPool 先在内存应用选择，再尝试保存至配置档；设置写入被拒绝时会产生警告，并在当前进程中保留内存选择。

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-orchestration)记录所有可接受设置。

### 选择与失败

服务先取模型池与已记录授权的交集，再检查严格任务能力、预期模态和上下文容量。已知的最大输出容量还必须覆盖响应余量；未知输出容量不增加额外限制。当前传输只接受文本和图像。精确适配器元数据优先于精选网关资料：明确仅支持文本的路由不能执行图像任务。精选资料仅适用于已知网关提供方；其他提供方即使使用相同模型 id，也需要自己的经验证专长声明及容量元数据。

可用且胜任的路由按任务偏好优势、跨 Session 实时子代理工作量、最久未分配顺序及模型池顺序排序。实时负载读取活跃或有排队输入的子代理轮次，插件替换后也如此；空闲且可继续的子代理不增加负载。未发布分配在发布或回滚前计入负载。被限流的路由不会阻塞另一条可用且胜任的路由。所有胜任路由都忙碌时，委派准入会以可取消方式等待，最多每 availabilityPollMs 毫秒（默认 1000）重新检查共享队列，使提前返还的容量能在滚动窗口估算到期前恢复工作。缺少评估、无法获取路由元数据或不存在胜任且获准路由时，会在子代理启动前抛出结构化 OrchestrationError。单次请求估算超过每分钟令牌容量的路由会被排除。

服务检查 LLM 适配器的共享队列可用性；实际发送准入及请求和令牌计量仍由适配器负责。不报告可用性的适配器返回 unknown，仅在没有胜任路由报告可用容量时才参与选择。等待已知被限流路由之前会先考虑未知容量。失败或拒绝任务的工作代理不会自动换模型重放。

-----

<a id="understand-the-implementation"></a>
## 实现说明

服务向 SubagentRuntime 注册选择器，返回子代理选项、记录捕获模式的设置回调和幂等分配释放回调。运行时验证最终授权，并负责启动回滚及子代理清理后的分配释放。编排服务不保留工作代理 Promise 或子代理执行循环。

orchestration 投影折叠已应用模式、持久待生效请求及历史命令结算。恢复语义改变时，状态版本随之改变。路由决策在信息性插件记录中保存任务评估、所选精确路由、令牌余量和选择原因。这些记录不进入模型历史。

-----

<a id="further-exploration"></a>
## 进一步探索

- [子代理运行时](../../../docs/subsystems/subagent.zh.md)负责普通委派及模型选择授权。
- [LLM 运行时](../../../docs/subsystems/llm-streaming.zh.md)负责精确模型元数据及请求发送。
- [实验性包](../AGENTS.md)定义隔离和转正要求。

-----

<a id="model-experience"></a>
## 模型体验

### 按任务委派

#### 模型看到什么

启用模式会增加以下关于 `task_assessment` 的已记录运行时指导。父代理通过普通推理和普通子代理工具分解工作，不会发送额外规划请求。

##### 编排运行时指导

```markdown
Orchestration mode is active. Delegate independent tasks through the normal subagent tools. For every fresh local child, supply task_assessment with requiredCapabilities (coding, reasoning, vision, allrounder, european), contextTokens for expected input including files the child will read, and requiredModalities for inputs needed throughout the task. Include image for screenshots the child may capture later. Use preferredCapabilities for optional strengths and outputTokens for the expected response allowance. Every required capability must be supported; reasoning alone does not establish coding ability. Model selection automatically considers the allowed pool, capabilities, live load, and request/token queue availability.
```

#### 令牌影响

路由只检查元数据和队列，不调用模型。每个被选中的子代理通过普通子代理执行消耗令牌。配置的上下文及输出余量预留路由空间；实际请求保留普通适配器计量。

#### KV Cache 影响

每个新建子代理拥有普通的独立历史。路由不改写父代理历史或重放已完成的子代理工作。运行时模式指导遵循普通的已记录上下文更新。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 任务要求及未来上下文由父代理估算；服务无法推断父代理省略的文件或工具生成图像。
- 可用性检查仅供参考，不预留提供方容量。发送前其他请求可能消耗容量；发送时仍以共享限流器为准。
- 精选专长仅覆盖一个网关。其他提供方需要经过验证的路由声明；未知模态或上下文不能证明路由适合任务。
- 模型在新建本地子代理启动前选择，不迁移活跃工作代理、不重跑失败的副作用，也不在另一模型上恢复放弃的工作。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文，显式地不具有权威性。

#### 晋升

晋升需要根据[实验性子树规则](../AGENTS.md)审核公共行为、限制、真实组合验证证据、发布载荷、运行时使用方和稳定所有权。

</details>
