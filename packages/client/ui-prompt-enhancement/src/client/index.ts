/** Browser face for prompt enhancement. */
import type { Context } from '@deepseek-ai/cordis'
import enhancementRemote from '@deepseek-ai/dsh-prompt-enhancement/remote'
import { mountEnhancement } from './mount.ts'

export { inject } from './mount.ts'

/** @param ctx - Browser Context. @returns Disposer for the Remote and UI. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  return await mountEnhancement(ctx, enhancementRemote)
}
