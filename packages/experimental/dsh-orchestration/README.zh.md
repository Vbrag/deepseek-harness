---
description: "在实验性编排模式下，为普通子代理委派选择具备所需能力且可用的模型。"
kind: "package-reference"
---

# @deepseek-ai/dsh-orchestration

[English](README.md) | 中文

## 概述

编排模式鼓励有效的并行委派，并为新建本地 subagent 及其后续已评估阶段选择模型。父代理通过普通子代理工具评估任务；本服务检查所有必需能力、预期输入模态和上下文余量，再在获准模型池中符合要求的路由之间平衡分配。执行、取消、结果交付和清理由普通子代理运行时负责。本实验性包不承诺稳定性。

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

主会话使用会话中选定的模型，即使该模型不在子代理模型池中。用户之后选择的模型从下一步骤生效。子代理的选择必须符合已记录的子代理模型授权。保存其他模型池会更改候选路由，但不会扩大现有子代理的授权；没有已记录授权的历史 Session 仅允许其父级路由。

### 任务评估

编排模式下，每次新建本地委派都必须提供 task_assessment。requiredCapabilities 列出所有必需专长：coding、reasoning、vision、allrounder 或 european。preferredCapabilities 列出可选优势。不支持的必需或偏好标签，以及 text/image 之外的模态，会在检查路由前抛出 ORCHESTRATION_INVALID_ASSESSMENT，供调用方纠正拼写错误。模型必须满足每项必需专长；推理能力不能代替编程能力。

普通实现任务要求 coding。推理有帮助时，将 reasoning 加入 preferredCapabilities；只有任务确实需要该能力时，才将其列为必需项。可选偏好不会排除其他符合要求的空闲路由。

contextTokens 估算工作代理所需的完整输入，包括它稍后读取的文件。requiredModalities 列出整个任务需要的输入；即使初始提示只有文本，浏览器或计算机截图任务也应包含 image。outputTokens 可选地估计响应 token 数，与生成上限独立。

### 配置

pool 字段列出精确的 provider/model 路由。routeCapabilities 为精确路由提供经过验证的专长，并替换精选专长列表；空列表清除这些专长。重复的精确路由声明会被拒绝。设置客户端通过 getCatalog 读取模型池选择目录——它按提供方分组投影实时 LLM 注册表，使选择器与编辑器可选择模型一致；已知的 uni-paderborn 路由携带精选专长作为标注。

对于 uni-paderborn，精选专长包含 gwdg.deepseek-v4-flash-0731 的 coding 和 gwdg.glm-5.3-flash 的 reasoning，已于 2026-11-17 根据 [DeepSeek 模型卡](https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash-0731)和 [GLM 模型卡](https://huggingface.co/zai-org/GLM-5.3-Flash)验证。任务专长描述适用性，独立于网关用于标明 API 支持情况的 reasoning 标志。已记录权限、精确 routeCapabilities 覆盖、传输设置及容量限制仍然适用。选择影响新建委派，包括全新 Ralph Round；运行中的工作代理仅通过获授权的阶段或恢复准入切换路由。

contextOverheadTokens 默认为 8192 个令牌，用于子代理指令、工具及请求包装。输入估算取 contextTokens 与初始提示文本及图像估算的较大值，再增加此余量。实际内联图像即使未在评估中声明，也要求图像能力。评估省略 outputTokens 时，outputReserveTokens 默认为 4096；有效的显式或适配器默认生成上限也参与上下文与压缩准入。两项余量均是经过验证的部署设置。输入估算与输出余量之和必须适合模型的总上下文容量。路由保留子代理的实际输出上限；普通请求准备和提供方限制仍然适用。

defaultToOrchestrator 默认为 false，仅为尚未记录选择的 Session 写入初始模式。配置档设置保存 `userPool` 和 `userPoolConfigured`；显式空池禁用路由，未设置覆盖时继承 `pool`。`getPoolSettingsState` 提供修订号，`persistPool` 拒绝过期或失败的写入，并报告有效选择。

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-orchestration)记录所有可接受设置。

### 选择与失败

服务先取模型池与已记录授权的交集，再检查严格任务能力、预期模态和上下文容量。已知的最大输出容量还必须覆盖响应余量；未知输出容量不增加额外限制。当前传输只接受文本和图像。精确适配器元数据优先于精选网关资料：明确仅支持文本的路由不能执行图像任务。精选资料仅适用于已知网关提供方；其他提供方即使使用相同模型 id，也需要自己的经验证专长声明及容量元数据。

本地子级可通过 `requestModelChange()` 接受显式评估的阶段与持久检查点。可恢复的子代理请求失败可选择另一条符合要求的路由，而不会重复已完成的工具。主会话保持选定路由：可以对同一模型进行有界恢复，无法恢复的失败会记录阻塞状态，直至用户重试或选择其他模型。普通提供方重试策略可以委托压缩；无界 `always` 重试策略在主会话首次失败时停止。计费额度耗尽会屏蔽共享该预算的路由；无法确认计费独立性时采取保守处理，已知免费路由仍可使用。账户修复后可在设置面板清除已观察到的计费失败。`maxAutomaticReassignments` 默认每次子代理恢复过程 2 次；恢复耗尽时在交接服务可用时保存交接。

运行中的请求本身接近 TPM 限制且启用自动压缩时，当前路由先尝试压缩，再考虑重新分配。无法缩减的超大子代理请求随后可选择另一条符合要求的路由；主会话在所选路由上保持阻塞。普通共享队列等待继续遵循原有可用性策略。

容量为 ready 或 unknown 的胜任路由依次按活跃分配、已确认就绪状态、偏好能力、最近分配时间及稳定模型池顺序排序。预留与活动轮次计入跨 Session 负载。被限流路由不会阻塞另一条符合要求的路由。所有胜任路由均忙时，准入可取消地等待，并最多每 `availabilityPollMs` 毫秒（默认 1000）重新检查共享队列。模型或凭据已知不可用的路由会被排除；意外的元数据失败仍会显示。

服务检查 LLM 适配器的共享队列可用性；实际发送准入及请求和令牌计量仍由适配器负责。不报告可用性的适配器返回 unknown，与 ready 路由一同参与选择。空闲的未知容量路由优先于有负载的就绪路由；分配负载相同时，已确认就绪的路由优先。重新分配延续同一子级 Session，不重启任务或重放已完成工具。

-----

<a id="understand-the-implementation"></a>
## 实现说明

服务向 SubagentRuntime 注册选择器，返回子代理选项、记录捕获模式的设置回调和幂等分配释放回调。运行时验证最终授权，并负责启动回滚及子代理清理后的分配释放。编排服务不保留工作代理 Promise 或子代理执行循环。

orchestration 投影折叠已应用模式、持久待生效请求及历史命令结算。恢复语义改变时，状态版本随之改变。信息性路由记录包含任务评估、所选路由、令牌余量、选择原因、符合要求的路由数、所选负载与就绪状态，以及模型池中其他路由的排除原因和容量信息。保留的历史记录可能不含诊断字段。这些记录不进入模型历史。

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

已记录的 `orchestration-phase` 上下文说明 `reassign_subagent`、阶段评估、检查点、显式生成上限和仅针对请求的中断。自动恢复可在配置模型池和适用权限内切换本地子代理的模型；主会话保持会话中选定的模型。启用模式会添加已记录指导，让模型在用户指令和现有委派限制内优先委派可有效并行的工作。小型或顺序工作由父代理直接处理；路由不会增加规划请求。

##### 编排运行时指导

```markdown
Orchestration mode is active. Proactively identify independent work that can make useful progress in parallel. When the available subagent tools and delegation limits allow it, prefer delegating bounded tasks with clear goals and expected results without waiting for the user to request delegation. Start independent delegations early and continue useful work yourself when possible. Respect the user's instructions, delegation depth, and active-child limits. Handle work directly when it is small, sequential, or delegation would add overhead without useful parallel progress. For every fresh local child, supply task_assessment with requiredCapabilities (coding, reasoning, vision, allrounder, european), contextTokens for expected input including files the child will read, and requiredModalities for inputs needed throughout the task. Require coding for ordinary implementation tasks. Prefer reasoning when it would help; require it only when the task specifically needs that capability. Include image for screenshots the child may capture later. Use preferredCapabilities for optional strengths and outputTokens for the expected response allowance. Every required capability must be supported; reasoning alone does not establish coding ability. Model selection automatically considers the allowed pool, capabilities, live load, and request/token queue availability.
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
- 重新分配要求已有的本地子级、已保存授权及持久准入。已停止目标仅排队阶段，由另一条获授权消息恢复；任务要求和已完成工具效果保持完整。
- 委派指导表达的是偏好，不保证模型发现每个可并行的机会。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文，显式地不具有权威性。

#### 晋升

晋升需要根据[实验性子树规则](../AGENTS.md)审核公共行为、限制、真实组合验证证据、发布载荷、运行时使用方和稳定所有权。

</details>
