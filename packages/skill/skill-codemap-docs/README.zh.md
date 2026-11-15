---
description: "内置于代码库转文档的代码地图技能包，用于将源码结构映射为 Markdown 代码地图文档。"
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-codemap-docs

[English](README.md) | 中文

## 概述

本包提供一个内置技能 `codemap-docs`，用于指导模型如何根据代码库的实际结构派生 Markdown 文档——架构代码地图、README 与 runbook 同步、分区域指南以及陈旧文档审计。它是纯指令型知识技能：不新增工具、可执行文件或运行时服务。将其与技能注册表和 `dsh-tool-skill` 一起挂载，该技能便会出现在模型的技能目录中。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

挂载本插件即可向智能体开放 `codemap-docs` 技能。它在 `ctx.skills` 上注册一个提供者，注册时读取技能描述，按需读取技能正文。

## 何时选择它

当需要从代码库的结构生成或更新文档——架构代码地图、README 摘要、分区域指南或 runbook——时使用此技能。它与本仓库自身的文档编写与布局约定配合使用但不取代它们；此技能提供从代码派生的工作流程。

### 挂载与配置

将插件与技能注册表一起加载；它依赖 `ctx.skills`。它不需要任何配置。

```yaml
- name: '@deepseek-ai/dsh-skill'
- name: '@deepseek-ai/dsh-skill-codemap-docs'
```

### 可观察行为

技能 `codemap-docs` 以其描述出现在面向模型的目录中，加载后返回完整的 Markdown 正文。销毁插件会注销提供者并从目录中移除该候选。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现内部细节——点击展开</summary>

该提供者沿用了 `skill-office` 的内置提供者结构，但只针对一个纯指令技能：`SKILL_NAMES` 保存唯一技能名，`apply()` 解析资源的 YAML frontmatter 以读取描述，并注册一个 `get()` 从 `assets/codemap-docs/SKILL.md` 原样返回正文的 `SkillProvider`。不解析配置、可执行文件或运行时资源——正文是纯 Markdown 指南。

技能注册表所述的优先级、作用域和调用权限适用于每个技能。该提供者不注册任何工具；加载的技能结果通过通用技能加载器记录。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 资源注册与原样技能正文。 |

| [`assets/`](assets/) | 内置的 `codemap-docs` 技能。 |

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

- **仅限指令**——该技能提供工作流程，但不提供可执行的代码地图生成器；它依赖项目自身的读取与搜索工具。
- **按约定限定于项目**——该 README/技能描述了通用工作流程，并将布局和行文规则交由仓库的文档约定处理。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

此技能的参考材料来自 `everything-claude-code` 项目中的 `doc-updater` 智能体和 `update-codemaps` 命令；在此处将其改编为纯指令式工作流程，通过本仓库自身的读取、搜索和文档约定工具运行，而非外部 CLI 生成器。

</details>
