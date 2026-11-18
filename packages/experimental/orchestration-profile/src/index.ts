/**
 * @deepseek-ai/dsh-orchestration-profile — experimental Orchestration Mode profile bundle.
 * The profile patch configures global compaction and installs defaults for
 * later agent-scoped compaction providers, preserving explicit configuration.
 * @module @deepseek-ai/dsh-orchestration-profile
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'
import type { BasicCompactionConfig, ModelCompactPolicyConfig } from '@deepseek-ai/dsh-compaction-basic'

export const name = 'orchestration-compaction-defaults'

/** Default exact-route budgets applied to scoped basic-compaction providers. */
export interface Config {
  /** Missing per-route fields inherit these values; explicit route and top-level fields take priority. */
  modelPolicies?: Pick<ModelCompactPolicyConfig, 'provider' | 'model' | 'headroomTokens' | 'maxTokens'>[]
}

/** Validated profile-owned budget defaults; omission supplies no overrides. */
export const Config: z<Config> = z.object({
  modelPolicies: z.array(z.object({
    provider: z.string().required(),
    model: z.string().required(),
    headroomTokens: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER),
    maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
  })),
})

/**
 * Supply profile defaults to later compaction instances, including Web agent scopes.
 * @param ctx - profile owner; disposing it removes the configuration listener.
 * @param config - default budgets whose explicit consumer overrides are preserved.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const defaults = config.modelPolicies ?? []
  const keys = defaults.map(policy => JSON.stringify([policy.provider, policy.model]))
  if (new Set(keys).size !== keys.length) throw new Error('compaction defaults must not repeat an exact provider/model')
  ctx.on('internal/config', (fiber, next) => {
    const raw: unknown = next()
    if (fiber.runtime?.callback !== BasicCompactionEngine) return raw
    const explicit: BasicCompactionConfig = BasicCompactionEngine.Config(raw as BasicCompactionConfig)
    const modelPolicies = (explicit.modelPolicies ?? []).map(policy => ({ ...policy }))
    for (const policy of defaults) {
      const index = modelPolicies.findIndex(candidate => candidate.provider === policy.provider && candidate.model === policy.model)
      const merged = {
        ...policy,
        ...explicit.headroomTokens === undefined ? {} : { headroomTokens: explicit.headroomTokens },
        ...explicit.maxTokens === undefined ? {} : { maxTokens: explicit.maxTokens },
        ...index === -1 ? {} : modelPolicies[index],
      }
      if (index === -1) modelPolicies.push(merged)
      else modelPolicies[index] = merged
    }
    return { ...explicit, modelPolicies }
  }, { global: true })
}
