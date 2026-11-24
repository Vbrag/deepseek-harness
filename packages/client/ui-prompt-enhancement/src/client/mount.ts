/** Mount the enhancement Remote and its composer and settings contributions. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-prompt-enhancement/remote'
import type { PromptEnhancementPreferenceUpdate } from '@deepseek-ai/dsh-prompt-enhancement/client'
import { EnhancementController } from './controller.ts'
import { EnhancementSettings, EnhancementToggle, PreparationDock, SteeringComparison, UserComparison } from './Components.tsx'
import { de, en, es, fr, ja, NS, pt, ru, zh } from './locales.ts'

/** Required browser services. */
export const inject = ['locale', 'slots', 'remote']

function registerUi(ctx: Context): void {
  const controller = new EnhancementController(ctx)
  const settings = {
    hooks: { settings: controller.settings },
    saveSettings: (update: PromptEnhancementPreferenceUpdate, revision?: number) => controller.save(update, revision),
    refreshSettings: () => controller.refresh(),
    readPreferences: () => controller.settings.getSnapshot().preferences,
    clearApprovals: () => controller.clearApprovals(),
    resetBilling: () => controller.resetBilling(),
  }
  ctx.effect(() => () => { controller.dispose() }, 'prompt-enhancement: dispose client interactions')
  ctx.effect(() => ctx.locale.register(NS, { en, zh, ja, es, fr, de, ru, pt }), 'prompt-enhancement: dictionaries')
  ctx.on('conversation/prepare-submission', async (request, next) => {
    const current = await next()
    return current.kind === 'cancel' ? current : controller.prepare(request, current.text)
  })
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left', id: 'prompt-enhancement', order: 40, locale: NS,
    inject: () => settings,
  }, EnhancementToggle))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'prompt-enhancement', order: 40, locale: NS,
    inject: (sessionId: SessionId) => ({ hooks: { preparation: controller.stateFor(sessionId) } }),
  }, PreparationDock))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'prompt-enhancement', order: 35,
    label: () => ctx.locale.bind(NS)('title'), locale: NS,
    inject: () => settings,
  }, EnhancementSettings))
  ctx.slots.inject('conversation.chat.user.details', () => ctx.slots.register({
    name: 'conversation.chat.user.details', id: 'prompt-enhancement', locale: NS,
  }, UserComparison))
  ctx.slots.inject('conversation.chat.steering.details', () => ctx.slots.register({
    name: 'conversation.chat.steering.details', id: 'prompt-enhancement', locale: NS,
  }, SteeringComparison))
  void controller.refresh().catch((error: unknown) => { ctx.logger.warn('prompt enhancement settings are unavailable', error) })
}

/** Mount the Remote and withdraw all contributions when its fiber is disposed.
 * @param ctx - Browser Context.
 * @param contribution - Generated Host Remote descriptor.
 * @returns Asynchronous disposer.
 */
export async function mountEnhancement(ctx: Context, contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(contribution)
  const ui = ctx.inject(['remote.promptEnhancement', 'slots', 'locale'], (plugin: Context) => { registerUi(plugin) })
  try { await ui } catch (error) { await ui.dispose(); await disposeRemote(); throw error }
  return async () => { await ui.dispose(); await disposeRemote() }
}
