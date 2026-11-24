/** Prompt enhancement interface copy. */
export const NS = 'promptEnhancement'

export const en = {
  title: 'Prompt enhancement',
  toggle: 'Enhance prompts',
  description: 'Improve prompts with a separate model request before sending them. Relevant instructions and recent conversation text may be included.',
  privacy: 'Attempts may save the original prompt, selected context and response in session history, even when cancelled. Anyone who can read that history can see them.',
  mode: 'Before sending',
  automatic: 'Send automatically',
  review: 'Review and edit',
  model: 'Enhancement model',
  sessionModel: 'Use the current session model',
  dedicated: 'Choose a model',
  save: 'Save settings',
  refresh: 'Reload settings',
  saveFailed: 'Settings could not be saved. Check the active profile and try again.',
  saveStale: 'Settings changed elsewhere. Reload them and review your choices before saving.',
  saved: 'Settings saved.',
  loadFailed: 'Settings are unavailable. Reopen the panel or reconnect.',
  revoke: 'Clear provider approvals',
  revoked: 'Provider approvals cleared.',
  revokeFailed: 'Provider approvals could not be cleared. Try again.',
  resetBilling: 'Retry billing-restricted models',
  billingReset: 'Billing-restricted models can be tried again.',
  billingResetFailed: 'Billing state could not be reset. Try again.',
  consentTitle: 'Send context to another provider?',
  consentBody: 'The prompt, attachment names, relevant project instructions and recent conversation text may be sent to {provider} using {model}.',
  endpoint: 'Endpoint: {endpoint}',
  endpointUnknown: 'The provider did not report an endpoint.',
  consentUnknown: 'This provider has no stable endpoint identity. Approval applies only to this submission.',
  consentKnown: 'This approval is saved for this provider endpoint in the active profile.',
  approve: 'Allow and enhance',
  original: 'Use original',
  cancel: 'Cancel submission',
  enhancing: 'Enhancing your prompt…',
  reviewTitle: 'Review the enhanced prompt',
  reviewHelp: 'Edit the text that will be sent, or use your original.',
  accept: 'Send this prompt',
  originalLabel: 'Original prompt',
  enhancedLabel: 'Enhanced prompt',
  submittedOriginal: 'Original submitted',
  submittedEdited: 'Edited prompt submitted',
  noticeSensitive: 'Enhancement was skipped because the prompt or an attachment name may contain a credential. The original will be used.',
  noticeBilling: 'Enhancement was unavailable because the model’s billing budget is exhausted. The original will be used.',
  noticeTimeout: 'Enhancement took too long. The original will be used.',
  noticeCatalog: 'The application’s session catalog needs updating before enhancement can be used. The original will be used.',
  noticeFailed: 'Enhancement was unavailable. The original will be used; check the selected model and try again.',
  dismiss: 'Dismiss',
} as const

export type PromptEnhancementKey = keyof typeof en

export const zh: Record<PromptEnhancementKey, string> = {
  title: '提示词增强', toggle: '增强提示词',
  description: '发送前使用单独的模型请求改进提示词，可能包含相关项目说明和最近的对话文本。',
  privacy: '即使取消提交，增强尝试也可能将原始提示词、所选上下文和响应保存在会话历史中。有权读取历史的人员均可查看。',
  mode: '发送前', automatic: '自动发送', review: '审核和编辑', model: '增强模型',
  sessionModel: '使用当前会话模型', dedicated: '选择模型', save: '保存设置', refresh: '重新加载设置',
  saveFailed: '无法保存设置。请检查当前配置并重试。', saveStale: '设置已在其他位置更改。请重新加载并检查选择。',
  saved: '设置已保存。', loadFailed: '设置不可用。请重新打开或重新连接。', revoke: '清除提供商授权',
  revoked: '已清除提供商授权。', revokeFailed: '无法清除提供商授权，请重试。', consentTitle: '向其他提供商发送上下文？',
  resetBilling: '重试受计费限制的模型', billingReset: '可以再次尝试受计费限制的模型。', billingResetFailed: '无法重置计费状态，请重试。',
  consentBody: '提示词、附件名称、相关项目说明和最近的对话文本可能会通过 {model} 发送给 {provider}。',
  endpoint: '端点：{endpoint}', endpointUnknown: '提供方未报告端点。',
  consentUnknown: '此提供商没有稳定的端点标识，本次授权仅适用于此提交。',
  consentKnown: '此授权将保存在当前配置中并适用于该提供商端点。', approve: '允许并增强', original: '使用原文',
  cancel: '取消提交', enhancing: '正在增强提示词…', reviewTitle: '审核增强后的提示词',
  reviewHelp: '编辑要发送的文本，或使用原文。', accept: '发送此提示词', originalLabel: '原始提示词',
  enhancedLabel: '增强后的提示词', submittedOriginal: '已发送原文', submittedEdited: '已发送编辑后的提示词',
  noticeSensitive: '提示词或附件名称可能包含凭据，已跳过增强并将使用原文。',
  noticeBilling: '模型的计费预算已用尽，无法增强，将使用原文。', noticeTimeout: '增强耗时过长，将使用原文。',
  noticeCatalog: '使用增强功能前需要更新应用的会话目录，将使用原文。',
  noticeFailed: '增强不可用，将使用原文。请检查所选模型后重试。', dismiss: '关闭',
}

// English is the fallback for locales without translated feature copy.
export const ja = en
export const es = en
export const fr = en
export const de = en
export const ru = en
export const pt = en
