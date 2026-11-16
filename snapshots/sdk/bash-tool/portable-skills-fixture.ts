/** Preserve the recorded cross-platform skill catalog without replacing Windows sandbox behavior. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-skill'

export const name = 'portable-sdk-snapshot-skills'
export const inject = ['skills']

/**
 * Exclude the platform-only diagnostic from this fixture's model and human catalogs.
 * @param ctx - the real skill registry of the SDK composition.
 */
export function apply(ctx: Context): void {
  ctx.skills.register({
    name: 'diagnose-windows-sandbox-acl', description: 'Excluded platform-specific fixture diagnostic.',
    content: 'This diagnostic is excluded from the portable SDK snapshot catalog.',
    invocation: { modelInvocable: false, userInvocable: false },
  })
}
