/**
 * Capability model for Orchestration over an OpenAI-compatible provider whose
 * catalog was investigated (Paderborn AI-Gateway). The provider's `/models`
 * endpoint exposes only model ids, so the capability facts (modalities,
 * reasoning, coding/vision/allrounder tags, context window, rate limits,
 * health) come from a curated table derived from the provider investigation,
 * not from guessing names. Context-window and rate-limit numbers are static
 * catalog defaults (routing-only, not a live quota); a live-override seam is
 * reserved for a gateway that later reports current per-model limits.
 *
 * @module @deepseek-ai/dsh-orchestration/capabilities
 */

/** Health of a catalog entry; only routeable entries are usable. */
export type CapabilityHealth = 'routeable' | 'unhealthy' | 'upcoming' | 'non-chat'

/** The discipline a sub-task is best served by. */
export type TaskDomain = 'coding' | 'reasoning' | 'vision' | 'allrounder' | 'european'

/** One input modality a model accepts. Text is universal; the rest are additive. */
export type Modality = 'text' | 'image' | 'audio' | 'video'

/**
 * One model's documented per-minute rate limits, as static catalog defaults.
 * Absent (`undefined`) means the catalog does not assert a ceiling, so the
 * model is never treated as at-limit from a static budget alone.
 */
export interface ModelRateLimits {
  /** Requests per minute the model accepts before throttling. */
  readonly rpm?: number
  /** Input+output tokens per minute the model accepts before throttling. */
  readonly tpm?: number
}

/** Strict capability facts for one provider model, from the catalog. */
export interface ModelCapability {
  /** Exact API model id as passed to the provider (dot-separated gateway id). */
  readonly id: string
  /** Human label from the catalog. */
  readonly name: string
  /** Whether the model accepts image input (vision), not image generation. */
  readonly imageInput: boolean
  /** Whether the model advertises reasoning support. */
  readonly reasoning: boolean
  /** Disciplines this model is suggested for, from the catalog's tags/applications. */
  readonly domains: readonly TaskDomain[]
  /** Every input modality the model accepts, text always included. */
  readonly modalities: readonly Modality[]
  /** Documented maximum input context window, in tokens. */
  readonly contextWindow: number
  /** Documented per-minute rate ceilings; absent when not catalogued. */
  readonly rateLimits?: ModelRateLimits
  /** Routeability for DSH today (chat-mode, reachable, healthy). */
  readonly health: CapabilityHealth
  /** Catalog / investigation note on what it is good for. */
  readonly suggested: string
}

/**
 * The Paderborn AI-Gateway capability catalog: chat-mode, healthy, callable
 * entries only. Transcribed from `paderborn-ai-gateway-models.md` (investigation
 * of 2026-10-30). Embeddings, routers, image-generation, responses-only,
 * upcoming, and unhealthy entries are excluded here because they are not
 * usable through the DSH chat pipeline or the current gateway key. The
 * media-capable Omni entry lists its catalog audio/video tags, but DSH does
 * not add audio/video transport and no attachment is forwarded by the
 * orchestration service, so a step requesting audio/video cannot actually be
 * served today; the modality list is a routing hint only.
 */
export const PADERBORN_CATALOG: readonly ModelCapability[] = [
  // Context-window and rate-limit figures are transcribed from the gateway's
  // public-catalog snapshot (paderborn-ai-gateway-models.md, 2026-10-30): the
  // "Max input tokens" column is the context window, and the single-provider
  // TPM/RPM columns are the per-minute ceilings. Multi-provider alias entries
  // (basemodel, qwen3.8) publish paired arrays in provider order, which cannot
  // be reduced to one guaranteed ceiling, so they carry no static rate limit.
  { id: 'hs-de.latest-basemodel', name: 'HS-DE: Basismodel', imageInput: true, reasoning: true, domains: ['allrounder', 'reasoning', 'coding', 'vision'], modalities: ['text', 'image'], contextWindow: 262_000, health: 'routeable', suggested: 'Free default alias for research, coding, and agent tasks; currently Qwen 3.8.' },
  { id: 'gwdg.gemma-4-31b-it', name: 'Gemma 4', imageInput: true, reasoning: false, domains: ['allrounder', 'vision'], modalities: ['text', 'image'], contextWindow: 256_000, rateLimits: { rpm: 10, tpm: 500_000 }, health: 'routeable', suggested: 'Free general assistance and image understanding.' },
  { id: 'gwdg.deepseek-v4-flash-0731', name: 'DeepSeek V4 Flash 0731', imageInput: false, reasoning: true, domains: ['reasoning', 'allrounder'], modalities: ['text'], contextWindow: 1_000_000, rateLimits: { rpm: 10, tpm: 500_000 }, health: 'routeable', suggested: 'Long-context text reasoning and general work.' },
  { id: 'hs-de.openai-gpt-oss-120b', name: 'OpenAI GPT OSS', imageInput: false, reasoning: true, domains: ['reasoning', 'allrounder'], modalities: ['text'], contextWindow: 128_000, rateLimits: { rpm: 100, tpm: 500_000 }, health: 'routeable', suggested: 'Free open-weight text/reasoning without the proprietary service.' },
  { id: 'gwdg.glm-5.3-flash', name: 'GLM 5.3 Flash', imageInput: false, reasoning: false, domains: ['coding'], modalities: ['text'], contextWindow: 200_000, rateLimits: { rpm: 10, tpm: 500_000 }, health: 'routeable', suggested: 'Free coding agents, multilingual programming, terminal tasks, tool use, mathematical reasoning.' },
  { id: 'hs-de.qwen3.8-27b', name: 'Qwen 3.8', imageInput: true, reasoning: true, domains: ['reasoning', 'coding', 'vision', 'allrounder'], modalities: ['text', 'image'], contextWindow: 262_000, health: 'routeable', suggested: 'Free research, coding, reasoning, large agent tasks; image and video input listed.' },
  { id: 'hs-de.qwen3.8-27b-no-think', name: 'Qwen 3.8 (Ohne Thinking)', imageInput: true, reasoning: false, domains: ['vision', 'allrounder'], modalities: ['text', 'image'], contextWindow: 262_000, health: 'routeable', suggested: 'Fast direct writing and simple tasks without explicit thinking iterations.' },
  { id: 'gwdg.qwen3.6-35b-a3b-no-think', name: 'Qwen 3.6 (Ohne Thinking)', imageInput: true, reasoning: false, domains: ['vision', 'allrounder'], modalities: ['text', 'image'], contextWindow: 262_000, rateLimits: { rpm: 10, tpm: 500_000 }, health: 'routeable', suggested: 'Direct answers and quick text generation; vision listed.' },
  { id: 'gwdg.qwen3.5-397b-a17b', name: 'Qwen 3.5', imageInput: true, reasoning: true, domains: ['reasoning', 'coding', 'vision', 'allrounder'], modalities: ['text', 'image'], contextWindow: 256_000, rateLimits: { rpm: 10, tpm: 500_000 }, health: 'routeable', suggested: 'Free challenging reasoning, coding, mathematics, general tasks, and image understanding.' },
  { id: 'gwdg.qwen3.5-397b-a17b-no-think', name: 'Qwen 3.5 (Ohne Thinking)', imageInput: true, reasoning: false, domains: ['vision', 'allrounder'], modalities: ['text', 'image'], contextWindow: 256_000, rateLimits: { rpm: 10, tpm: 500_000 }, health: 'routeable', suggested: 'Direct writing and simpler tasks using Qwen 3.5 without thinking iterations.' },
  { id: 'gwdg.qwen3-30b-a3b-instruct-2507', name: 'Qwen 3 Instruct', imageInput: false, reasoning: false, domains: ['allrounder'], modalities: ['text'], contextWindow: 256_000, rateLimits: { rpm: 10, tpm: 500_000 }, health: 'routeable', suggested: 'General multilingual instruction following, text understanding, coding, math, science.' },
  { id: 'hs-de.eurollm-22b-instruct-2512', name: 'EuroLLM', imageInput: false, reasoning: false, domains: ['european', 'allrounder'], modalities: ['text'], contextWindow: 32_000, rateLimits: { rpm: 10, tpm: 500_000 }, health: 'routeable', suggested: 'Multilingual instruction-following across all 24 official EU languages.' },
  { id: 'gwdg.qwen3-coder-next', name: 'Qwen 3 Coder Next', imageInput: false, reasoning: false, domains: ['coding'], modalities: ['text'], contextWindow: 256_000, rateLimits: { rpm: 10, tpm: 500_000 }, health: 'routeable', suggested: 'Free coding agents and CLI/IDE integrations; long code context and tool calling.' },
  { id: 'gwdg.qwen3-omni-30b-a3b-instruct', name: 'Qwen 3 Omni', imageInput: true, reasoning: false, domains: ['vision', 'allrounder'], modalities: ['text', 'image', 'audio', 'video'], contextWindow: 256_000, rateLimits: { rpm: 10, tpm: 500_000 }, health: 'routeable', suggested: 'Multimodal understanding of text, images, audio, and video per catalog; gateway payload support for media input is unverified.' },
  { id: 'kiconnect.mistralai-mistral-small-4-119b-2603', name: 'Mistral Small 4', imageInput: true, reasoning: false, domains: ['allrounder', 'vision'], modalities: ['text', 'image'], contextWindow: 256_000, rateLimits: { rpm: 100, tpm: 500_000 }, health: 'routeable', suggested: 'Fast general assistance and image/tool workflows; European-developed.' },
  { id: 'gwdg.meta-llama-3.1-8b-instruct', name: 'Llama 3.1 8B Instruct', imageInput: false, reasoning: false, domains: ['allrounder'], modalities: ['text'], contextWindow: 128_000, rateLimits: { rpm: 10, tpm: 500_000 }, health: 'routeable', suggested: 'Lightweight fast general conversation, straightforward questions, basic assistance.' },
]

/** Look up one model's capability facts from the catalog by id. */
export function capabilityOf(id: string): ModelCapability | undefined {
  return PADERBORN_CATALOG.find(c => c.id === id)
}

/** Whether every required input modality is served by the model. */
export function coversModalities(capability: ModelCapability, required: readonly Modality[]): boolean {
  return required.every(m => capability.modalities.includes(m))
}

/** Whether the model's documented context window fits the required input tokens. */
export function fitsContext(capability: ModelCapability, tokens: number): boolean {
  return capability.contextWindow >= tokens
}

/** Whether one model's rpm/tpm ceiling leaves the field clear for one more attempt. */
export function underRateBudget(
  capability: ModelCapability,
  usedRpm: number,
  usedTpm: number,
  attemptTpm: number,
): boolean {
  const { rpm, tpm } = capability.rateLimits ?? {}
  if (rpm !== undefined && usedRpm + 1 > rpm) return false
  if (tpm !== undefined && usedTpm + attemptTpm > tpm) return false
  return true
}

/** The disciplines a model can serve, as a set for similarity comparison. */
function domainMask(capability: ModelCapability): ReadonlySet<TaskDomain> {
  return new Set(capability.domains)
}

/**
 * Similarity between one model's capabilities and a task domain.
 * A model that explicitly serves the domain scores the highest; otherwise
 * the model's breadth (number of overlapping general disciplines) breaks ties.
 * @returns Score; higher is a better match for the domain.
 */
export function domainScore(capability: ModelCapability, domain: TaskDomain): number {
  if (domain === 'vision') {
    return capability.imageInput ? 2 + (capability.domains.includes('vision') ? 1 : 0) : 0
  }
  const mask = domainMask(capability)
  if (mask.has(domain)) return 2
  // Partial credit for serving the target through a closely related discipline.
  if (domain === 'coding' && mask.has('reasoning')) return 1
  return 0
}

/**
 * Similarity between two models' capability sets, for failover: a replacement
 * whose domains overlap the failed model's the most is preferred.
 * @param a - failed model's capabilities.
 * @param b - candidate replacement's capabilities.
 * @returns Overlap count of shared domains, modality agreement, plus image-input agreement.
 */
export function capabilitySimilarity(a: ModelCapability, b: ModelCapability): number {
  const shared = [...a.domains].filter(d => b.domains.includes(d)).length
  const imageAgreement = a.imageInput === b.imageInput ? 1 : 0
  const modalityAgreement = a.modalities.filter(m => b.modalities.includes(m)).length
  return shared + imageAgreement + modalityAgreement
}

/** A model route is unusable for one selection round. */
export interface ExcludedRoute {
  /** Exact model id excluded from this round. */
  readonly model: string
  /** Human reason, for diagnostics. */
  readonly reason: string
}

/**
 * Route one required list of capabilities to the best candidate that is
 * routeable, not already tried, not excluded (rate-limited or otherwise
 * unavailable), capable of every required modality, and large enough for the
 * required context tokens.
 * @param candidates - the selected pool's capabilities (already resolved).
 * @param tried - models already attempted for this step.
 * @param domains - required domains.
 * @param options - modality, context, and budget constraints on routing.
 * @returns The best-matching model, or undefined when none remains.
 */
export function bestCapabilityMatch(
  candidates: readonly ModelCapability[],
  tried: readonly string[],
  domains: readonly TaskDomain[],
  options: {
    readonly requiredModalities?: readonly Modality[]
    readonly contextTokens?: number
    readonly unavailable?: readonly string[]
    readonly budget?: Record<string, { attempts: number; tokens: number }>
  } = {},
): ModelCapability | undefined {
  const triedSet = new Set(tried)
  const unavailableSet = new Set(options.unavailable ?? [])
  const usable = candidates.filter((c) => {
    if (c.health !== 'routeable' || triedSet.has(c.id) || unavailableSet.has(c.id)) return false
    if (options.requiredModalities !== undefined && !coversModalities(c, options.requiredModalities)) return false
    if (options.contextTokens !== undefined && !fitsContext(c, options.contextTokens)) return false
    const usage = options.budget?.[c.id] ?? { attempts: 0, tokens: 0 }
    if (usage.attempts > 0 && c.rateLimits?.rpm !== undefined && usage.attempts >= c.rateLimits.rpm) return false
    return true
  })
  if (usable.length === 0) return undefined
  if (domains.length === 0) {
    // No requirement: prefer the broadest routeable model as a default.
    return [...usable].sort((a, b) => b.domains.length - a.domains.length)[0]
  }
  const scoring = usable.map(candidate => ({
    candidate,
    score: domains.reduce((sum, d) => sum + domainScore(candidate, d), 0),
  }))
  scoring.sort((a, b) => b.score - a.score)
  const top = scoring[0]
  /* v8 ignore next -- reachable only if scoring were empty, which the earlier usable-empty return already prevents. */
  if (top === undefined) return undefined
  return top.score === 0 ? undefined : top.candidate
}
