---
description: "内置的持续学习技能包，用于从会话中提取可复用的模式。"
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-continuous-learning

[English](README.md) | 中文

## 摘要

本包提供一个内置技能 `continuous-learning`，用于指导模型如何从已完成或进行中的会话中提取可复用知识——反复出现的错误解决、用户纠正、变通方案、调试技巧和项目约定——并以持久、可记录的形式保存下来。它是纯指令型知识技能：不新增工具、可执行文件或运行时服务。将其与技能注册表和 `dsh-tool-skill` 一起挂载，该技能便会与其他内置技能一同出现在模型技能目录中。

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

挂载本插件即可向智能体开放 `continuous-learning` 技能。它在 `ctx.skills` 上注册一个提供者，注册时读取技能描述，按需读取技能正文。

## 何时选择它

当任务是捕捉已完成会话中的知识——来之不易的错误解决、反复出现的用户纠正、变通方案、调试技巧或项目约定——并将其转化为可供未来会话使用的持久、可记录指南时，使用此技能。它提供提取工作流以及"持久、可记录、一事一户"的纪律；它并不取代仓库自身关于在何处记录学习的 Agent 笔记与技能约定。

### 挂载与配置

将插件与技能注册表一起加载；它依赖 `ctx.skills`。它不需要任何配置。

```yaml
- name: '@deepseek-ai/dsh-skill'
- name: '@deepseek-ai/dsh-skill-continuous-learning'
```

### 可观察行为

技能 `continuous-learning` 以其描述出现在面向模型的目录中，加载后返回完整的 Markdown 正文。销毁插件会注销提供者并从目录中移除该候选。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现内部细节——点击展开</summary>

该提供者沿用了 `skill-office` 的内置提供者结构，但只针对一个纯指令技能：`SKILL_NAMES` 保存唯一技能名，`apply()` 解析资源的 YAML frontmatter 以读取描述，并注册一个 `get()` 从 `assets/continuous-learning/SKILL.md` 原样返回正文的 `SkillProvider`。不解析配置、可执行文件或运行时资源——正文是纯 Markdown 指南。

技能注册表所述的优先级、作用域和调用权限适用于每个技能。该提供者不注册任何工具；加载的技能结果通过通用技能加载器记录。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 资源注册与原样技能正文。 |

| [`assets/`](assets/) | 内置的 `continuous-learning` 技能。 |

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

- **仅限指令**——该技能仅提供指南，不提供可执行辅助工具；后续可将其与代码片段或自动笔记整理器配对。
- **依赖仓库笔记约定**——它依赖仓库的 Agent 笔记与技能规则来确定学习内容存储位置，因此行为会随目标仓库的分类法而变化。

<a id="dev-note"></a>
### 开发者说明

<details>
<summary>维护者的工作上下文——点击展开</summary>

此技能的参考材料来自 `everything-claude-code` 项目中的 `continuous-learning` 技能；在此处将其改编为纯指令、可记录、模型可见的指南，并与仓库的 Agent 笔记约定交叉链接，而非逐字复制。

</details>
