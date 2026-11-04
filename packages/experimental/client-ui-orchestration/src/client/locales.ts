/** Locale namespace owned by the Orchestration settings panel. */
export const NS = 'orchestration'

/** Simplified Chinese dictionary and key source. */
export const zh = {
  modeLabel: '会话模式',
  modeDefault: '默认',
  modeOrchestration: '编排',
  modePending: '从下一步生效',
  modeFailed: '无法切换模式，请重试',
  title: '编排模型池',
  subtitle: '从提供商目录中勾选用于多模型编排的模型池。',
  noneSelected: '未选择模型',
  selectedPool: '所选池将保存到主机。',
  poolHint: '保存到主机：所选模型池会写入主机设置，供编排运行使用。',
  saveFailed: '保存模型池失败，请重试。',
  badgeImage: '图像输入',
  badgeReasoning: '推理',
  badgeCoding: '编码',
  badgeVision: '视觉',
  badgeAllrounder: '通用',
  badgeEuropean: '欧洲模型',
  suggested: '用途',
  health: '状态',
  routeable: '可用',
  model: '模型',
} satisfies Record<string, string>

/** Orchestration locale key union. */
export type OrchestrationKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  modeLabel: 'Conversation mode',
  modeDefault: 'Default',
  modeOrchestration: 'Orchestration',
  modePending: 'Applies from the next step',
  modeFailed: 'Could not switch mode. Please try again.',
  title: 'Orchestration model pool',
  subtitle: 'Pick the multi-model pool for Orchestration mode from the provider catalog.',
  noneSelected: 'No model selected',
  selectedPool: 'Selected pool is saved to the Host.',
  poolHint: 'Saved to the Host: the selected pool is written to Host settings and drives Orchestration runs.',
  saveFailed: 'Could not save the model pool. Please try again.',
  badgeImage: 'Image input',
  badgeReasoning: 'Reasoning',
  badgeCoding: 'Coding',
  badgeVision: 'Vision',
  badgeAllrounder: 'All-rounder',
  badgeEuropean: 'European',
  suggested: 'Suggested use',
  health: 'Health',
  routeable: 'Routeable',
  model: 'Model',
} satisfies Record<OrchestrationKey, string>

function reusedEnglish(): Record<OrchestrationKey, string> {
  return en
}

/** Japanese dictionary: reuse English pending a native pass. */
export const ja = { ...reusedEnglish() } satisfies Record<OrchestrationKey, string>
/** Spanish dictionary: reuse English pending a native pass. */
export const es = { ...reusedEnglish() } satisfies Record<OrchestrationKey, string>
/** French dictionary: reuse English pending a native pass. */
export const fr = { ...reusedEnglish() } satisfies Record<OrchestrationKey, string>
/** German dictionary: reuse English pending a native pass. */
export const de = { ...reusedEnglish() } satisfies Record<OrchestrationKey, string>
/** Russian dictionary: reuse English pending a native pass. */
export const ru = { ...reusedEnglish() } satisfies Record<OrchestrationKey, string>
/** Portuguese dictionary: reuse English pending a native pass. */
export const pt = { ...reusedEnglish() } satisfies Record<OrchestrationKey, string>
