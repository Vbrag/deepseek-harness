---
description: "内置式的评估驱动开发技能，用于定义并运行能力评估与回归评估。"
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-eval-harness

[English](README.md) | 中文

## 摘要

本包提供一个内置技能 `eval-harness`，用于指导模型实践评估驱动开发（EDD）：在实现前定义预期行为、在开发过程中持续运行能力评估与回归评估、使用代码、模型或人工评估器进行评分，并对照基线跟踪 pass@k 与 pass^k 指标。它是纯指令型知识技能——不新增工具、可执行文件或运行时服务。将其与技能注册表和 `dsh-tool-skill` 一起挂载，该技能便会与其他内置技能一同出现在模型技能目录中。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办工作](#known-limitations-and-deferred-work)
- [开发者说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

挂载本插件即可向智能体开放 `eval-harness` 技能。它在 `ctx.skills` 上注册一个提供者，注册时读取技能描述，按需读取技能正文。

## 何时选择它

当任务得益于在实现前定义成功标准时——规划功能、验证某项变更是否达成预期、针对基线运行回归评估，或确认重构保留了原有行为——使用此技能。它与本仓库自身的门禁选择指南配合使用但不取代它：此技能提供评估驱动的框架以及 pass@k / pass^k 纪律，而仓库的审查与测试指南负责挑选覆盖该差异的具体检查。

### 挂载与配置

将插件与技能注册表一起加载；它依赖 `ctx.skills`。它不需要任何配置。

```yaml
- name: '@deepseek-ai/dsh-skill'
- name: '@deepseek-ai/dsh-skill-eval-harness'
```

### 可观察行为

技能 `eval-harness` 以其描述出现在面向模型的目录中，加载后返回完整的 Markdown 正文。销毁插件会注销提供者并从目录中移除该候选。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现内部细节——点击展开</summary>

该提供者沿用了 `skill-office` 的内置提供者结构，但只针对一个纯指令技能：`SKILL_NAMES` 保存唯一技能名，`apply()` 解析资源的 YAML frontmatter 以读取描述，并注册一个 `get()` 从 `assets/eval-harness/SKILL.md` 原样返回正文的 `SkillProvider`。不解析配置、可执行文件或运行时资源——正文是纯 Markdown 指南。

技能注册表所述的优先级、作用域和调用权限适用于每个技能。该提供者不注册任何工具；加载的技能结果通过通用技能加载器记录。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 资源注册与原样技能正文。 |

| [`assets/`](assets/) | 内置的 `eval-harness` 技能。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [技能注册表](../skill/README.zh.md) — 发现与优先级。
- [技能工具](../tool-skill/README.zh.md) — 模型目录与已加载正文。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过 `dsh-tool-skill`，它将技能的名称与描述渲染到初始目录中，并通过 `skill(name)` 返回完整的指令正文。

#### KV 缓存效应

技能正文在加载时会追加到历史记录中；它不会改变工具声明。正文的目标是保持与其他内置编写技能相当程度的令牌预算。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

- **仅限指令**——该技能仅提供定义、工作流与评分指南，不提供可执行的评估运行器或评分框架；后续可将其与可复用的评估脚手架或接入辅助工具配对。
- **门禁接入由调用方负责**——该技能告知模型应将机械式评估器接入哪些仓库门禁，但并未提供仓库的具体门禁命令或 CI 配置。

<a id="dev-note"></a>
### 开发者说明

<details>
<summary>维护者的工作上下文——点击展开</summary>

此技能的参考材料来自 `everything-claude-code` 项目中的 `eval-harness` 技能；在此处将其改编为纯指令、感知门禁的形式，并与仓库的门禁选择与测试指南交叉链接，而非逐字复制。

</details>
