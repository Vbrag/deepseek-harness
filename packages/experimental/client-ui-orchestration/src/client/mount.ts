/** Source-safe Orchestration settings-page browser registration: the Host pool behind the panel, mounted over Remote. */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-commands/remote'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { OrchestrationModeControl, type OrchestrationModeInjected } from './OrchestrationModeControl.tsx'
import { OrchestrationRouting } from './OrchestrationRouting.tsx'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the renderer's Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the settings shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-orchestration/remote'
import type { OrchestrationCatalog, PoolRoute } from '@deepseek-ai/dsh-orchestration/types'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { OrchestrationPanel, type OrchestrationInjected } from './OrchestrationPanel.tsx'
import { en, ja, es, fr, de, ru, pt, NS, zh, type OrchestrationKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Orchestration settings-page copy. */
    'orchestration': OrchestrationKey
  }
}

/** Required browser services: the Remote namespace, slots, and localized copy. */
export const inject = ['layout', 'locale', 'slots', 'remote']

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Read the Host pool, defaulting to empty when the read is refused.
 * @param ctx - browser Context with the mounted `remote.orchestrations` namespace.
 * @returns the current pool.
 */
async function readPool(ctx: Context): Promise<readonly PoolRoute[]> {
  const pooled = await ctx.remote.orchestrations.getPool()
  if (!pooled.ok) ctx.logger.warn(`orchestration: getPool refused: ${messageOf(pooled.error)}`)
  return pooled.ok ? pooled.value : []
}

function registerUi(ctx: Context, initial: readonly PoolRoute[], catalog: OrchestrationCatalog): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'client-ui-orchestration: dictionaries')
  let pool = initial
  const setPool = async (next: readonly PoolRoute[]): Promise<boolean> => {
    const result = await ctx.remote.orchestrations.persistPool(next)
    if (!result.ok) {
      ctx.logger.warn(`orchestration: persistPool refused: ${messageOf(result.error)}`)
      return false
    }
    if (!result.value) return false
    pool = next
    return true
  }
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'orchestration',
    order: 30,
    label: () => ctx.locale.bind(NS)('title'),
    locale: NS,
    inject: (): OrchestrationInjected => ({ pool, catalog, setPool }),
  }, OrchestrationPanel))
  ctx.slots.inject('conversation.session.panel.section', () => ctx.slots.register({
    name: 'conversation.session.panel.section',
    id: 'orchestration-routing',
    // After change requests (100) and subagents (200), before shared tasks (250) and background jobs (300).
    order: 210,
    label: () => ctx.locale.bind(NS)('routingTitle'),
    locale: NS,
  }, OrchestrationRouting))
  ctx.inject(['remote.commands'], (commandCtx) => {
    commandCtx.slots.inject('conversation.input.left', () => commandCtx.slots.register({
      name: 'conversation.input.left',
      id: 'orchestration-mode',
      order: 30,
      locale: NS,
      inject: (sessionId: SessionId): OrchestrationModeInjected => ({
        selectMode: async (active) => {
          const result = await commandCtx.remote.commands.execute(sessionId, `/orchestration ${active ? 'on' : 'off'}`, [])
          return result.ok && result.value?.result.kind === 'success'
        },
      }),
    }, OrchestrationModeControl))
  })
}

/**
 * Mount the Host's `orchestrations` Remote contribution, then register the
 * settings section that reads and writes the pool through it. The UI is
 * withdrawn before the Remote mount on both failure and success.
 * @param ctx - Client Context with the declared `inject` services available.
 * @param contribution - the generated `orchestrations` Remote contribution.
 * @returns the disposer that withdraws the section and the Remote mount.
 */
export async function mountOrchestration(ctx: Context, contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(contribution)
  const ui = ctx.inject(['remote.orchestrations', 'slots', 'locale'], async (plugin: Context) => {
    const [pool, catalog] = await Promise.all([readPool(plugin), plugin.remote.orchestrations.getCatalog()])
    if (!catalog.ok) {
      plugin.logger.warn(`orchestration: getCatalog refused: ${messageOf(catalog.error)}`)
      throw catalog.error
    }
    registerUi(plugin, pool, catalog.value)
  })
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await disposeRemote()
    throw error
  }
  return async () => {
    await ui.dispose()
    await disposeRemote()
  }
}
