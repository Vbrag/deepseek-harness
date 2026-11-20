/**
 * Capability model for Orchestration over an OpenAI-compatible provider whose
 * catalog was investigated (Paderborn AI-Gateway). The provider's `/models`
 * endpoint exposes only model ids, so the capability facts (modalities,
 * reasoning, coding/vision/allrounder tags, context window, rate limits,
 * health) come from a curated table. The factual columns (name, image input,
 * reasoning, context window, per-minute rate limits) are kept equal to the
 * canonical gateway catalogue in `@deepseek-ai/dsh-llm-pi-ai` (snapshot
 * 2026-11-19) and `tests/capabilities.gate.spec.ts` fails on any drift; the
 * curated columns (task domains, health, suggested use, pool membership) stay
 * local routing preferences that no gateway catalogue can supply. Rate limits
 * use the same conservative policy as the shipped route: a published range is
 * pinned to its lower bound. Exact adapter facts take precedence over these
 * hints. Static rate limits describe the catalog; queue availability and
 * dispatch admission belong to the LLM adapter's shared limiter.
 *
 * @module @deepseek-ai/dsh-orchestration/capabilities
 */

/** Health of a catalog entry; only routeable entries are usable. */
export type CapabilityHealth = 'routeable' | 'unhealthy' | 'upcoming' | 'non-chat'

/** The discipline a sub-task is best served by. */
export type TaskDomain = 'coding' | 'reasoning' | 'vision' | 'allrounder' | 'european'

/** Task specialty labels accepted by orchestration assessments and route declarations. */
export const TASK_DOMAINS: readonly TaskDomain[] = ['coding', 'reasoning', 'vision', 'allrounder', 'european']

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

/**
 * Exact gateway provider whose investigated specialty and capacity facts may
 * supplement adapter metadata. Other providers, including renamed gateway
 * routes, supply verified specialties through routeCapabilities and resolve
 * capacities through their own adapter metadata.
 */
export const POOL_PROVIDER = 'uni-paderborn'

/** Strict capability facts for one provider model, from the catalog. */
export interface ModelCapability {
  /** Exact API model id as passed to the provider (dot-separated gateway id). */
  readonly id: string
  /** Human label from the catalog. */
  readonly name: string
  /** Whether the model accepts image input (vision), not image generation. */
  readonly imageInput: boolean
  /** Whether the gateway advertises API reasoning support; separate from the reasoning task specialty. */
  readonly reasoning: boolean
  /** Verified task specialties from gateway descriptions and exact model documentation. */
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
 * entries only, transcribed from the canonical gateway catalogue
 * (`UPB_AI_Gateway_Model_Reference_2026-11-19.md`, snapshot 2026-11-19).
 * Factual columns (name, image input, reasoning, context window, rate limits)
 * are gated equal to the canonical catalogue by `tests/capabilities.gate.spec.ts`.
 * Embeddings, routers, image-generation, responses-only, upcoming, and
 * unhealthy entries are excluded here because they are not usable through the
 * DSH chat pipeline or the current gateway key. The media-capable Omni entry
 * lists its catalog audio/video tags, but DSH does not add audio/video
 * transport and no attachment is forwarded by the orchestration service.
 * Routing falls back only to catalog text/image facts; other modalities are
 * excluded until DSH can carry them.
 */
export const PADERBORN_CATALOG: readonly ModelCapability[] = [
  // Context-window and rate-limit figures come from the canonical gateway
  // catalogue (snapshot 2026-11-19): the "Max input tokens" value is the
  // context window, and a published RPM/TPM range is pinned to its lower bound
  // (the same conservative policy as the shipped route). The source catalogue
  // is authoritative; the gate in tests/capabilities.gate.spec.ts fails if any
  // factual column below drifts from it.
  { id: 'hs-de.latest-basemodel', name: 'HS-DE: Basismodel', imageInput: true, reasoning: true, domains: ['allrounder', 'reasoning', 'coding', 'vision'], modalities: ['text', 'image'], contextWindow: 262_000, rateLimits: { rpm: 10, tpm: 500_000 }, health: 'routeable', suggested: 'Free default alias for research, coding, and agent tasks; currently Qwen 3.8.' },
  { id: 'gwdg.gemma-4-31b-it', name: 'Gemma 4', imageInput: true, reasoning: false, domains: ['allrounder', 'vision'], modalities: ['text', 'image'], contextWindow: 256_000, rateLimits: { rpm: 10, tpm: 500_000 }, health: 'routeable', suggested: 'Free general assistance and image understanding.' },
  // Coding and reasoning verified 2026-11-17: https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash-0731
  { id: 'gwdg.deepseek-v4-flash-0731', name: 'DeepSeek V4 Flash 0731', imageInput: false, reasoning: true, domains: ['reasoning', 'coding', 'allrounder'], modalities: ['text'], contextWindow: 1_000_000, rateLimits: { rpm: 10, tpm: 500_000 }, health: 'routeable', suggested: 'Long-context text reasoning, coding agents, and general work.' },
  { id: 'hs-de.openai-gpt-oss-120b', name: 'OpenAI GPT OSS', imageInput: false, reasoning: false, domains: ['reasoning', 'allrounder'], modalities: ['text'], contextWindow: 128_000, rateLimits: { rpm: 100, tpm: 500_000 }, health: 'routeable', suggested: 'Free open-weight text work without the proprietary service.' },
  // Coding and reasoning verified 2026-11-17: https://huggingface.co/zai-org/GLM-5.3-Flash
  { id: 'gwdg.glm-5.3-flash', name: 'GLM 5.3 Flash', imageInput: true, reasoning: true, domains: ['coding', 'reasoning'], modalities: ['text', 'image'], contextWindow: 200_000, rateLimits: { rpm: 10, tpm: 500_000 }, health: 'routeable', suggested: 'Free coding agents, multilingual programming, terminal tasks, tool use, mathematical reasoning.' },
  { id: 'hs-de.qwen3.8-27b', name: 'Qwen 3.8', imageInput: true, reasoning: true, domains: ['reasoning', 'coding', 'vision', 'allrounder'], modalities: ['text', 'image'], contextWindow: 262_000, rateLimits: { rpm: 10, tpm: 500_000 }, health: 'routeable', suggested: 'Free research, coding, reasoning, large agent tasks; image and video input listed.' },
  { id: 'hs-de.qwen3.8-27b-no-think', name: 'Qwen 3.8 (Ohne Thinking)', imageInput: true, reasoning: false, domains: ['vision', 'allrounder'], modalities: ['text', 'image'], contextWindow: 262_000, rateLimits: { rpm: 10, tpm: 500_000 }, health: 'routeable', suggested: 'Fast direct writing and simple tasks without explicit thinking iterations.' },
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

/** Look up one model's capability facts from the catalog by id.
 * @param id - Exact gateway model id.
 * @returns Curated facts, or undefined when no entry is known.
 */
export function capabilityOf(id: string): ModelCapability | undefined {
  return PADERBORN_CATALOG.find(c => c.id === id)
}
