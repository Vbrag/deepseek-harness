/**
 * Uni Paderborn AI-Gateway: a ready-to-use openai-completions route derived
 * from the canonical gateway catalogue.
 *
 * The gateway exposes OpenAI-compatible endpoints over HTTPS at
 * `https://ai-gateway.uni-paderborn.de/v1`. The shipped model set, budgets, and
 * capabilities come from {@link UPB_GATEWAY_CATALOG} (single source of truth);
 * this module only reshapes catalogue facts into the pi-ai profile model. It
 * ships the chat-capable models, including the gateways `(Test)` listings,
 * through {@link UPB_GATEWAY_MODELS}; the source-restricted test entries are
 * shipped so they appear in pickers and are callable, but none is a default.
 *
 * Declaring `rpm` / `tpm` activates DSH's proactive pacing on those models, so
 * concurrent chats sharing the route never exceed the gateway's per-model caps.
 * Pacing values are a conservative local policy: a published RPM range (the
 * Qwen 3.8 `10 - 100` rows) is pinned to its lower bound, and the published
 * single value is used where the page lists one; the source's range is retained
 * in the catalogue. The full inventory (embedding, image, responses-mode,
 * router, alias entries) stays in the catalogue as reference and is not
 * dispatched here. The `(Test)` chat listings (`testOnly`) are shipped with the
 * production chat models; their source restriction is preserved in the
 * catalogue and surfaced in the model name, but the harness does not otherwise
 * special-case them here.
 *
 * Requests are sized to the gateway's own admission arithmetic. The gateway
 * charges each request's declared output cap against its per-minute token
 * budget, so shipping the published maximum output (128,000–384,000 tokens) as
 * the model's `maxTokens` would make every request reserve most of the
 * 500,000-token minute on its own and the next request would be throttled with
 * HTTP 429. A model's `maxTokens` is also the per-request default DSH asks for
 * (see {@link PiAiModelProfile.maxTokens}), so the shipped value is the
 * published maximum output lowered to the gateway's per-minute share
 * (`tpm / maxParallel`, 50,000 tokens) and the route's pacing allowance
 * reserves the same amount that the gateway charges.
 *
 * @module dsh-llm-pi-ai/upb-gateway
 */
import type { PiAiModelProfile, PiAiProviderProfile } from './config.ts'
import { UPB_CHAT_MODELS, type UpbGatewayEntry } from './upb-gateway-catalog.ts'

/** Route key for the Uni Paderborn AI-Gateway provider. */
export const UPB_GATEWAY_PROVIDER = 'upb-ai-gateway'

/** API root of the Uni Paderborn AI-Gateway. */
export const UPB_GATEWAY_BASE_URL = 'https://ai-gateway.uni-paderborn.de/v1'

/** Credential reference (environment-variable name) for the gateway API key. */
export const UPB_GATEWAY_API_KEY_ENV = 'UPB_AI_GATEWAY_KEY'

/** Vision-capable chat models accept text and images. */
const VISION: PiAiModelProfile['input'] = ['text', 'image']

/**
 * The single pacing scalar for a published quota, from a conservative local
 * policy. A one-element array uses the published value; a two-element range
 * (the Qwen 3.8 rows) is pinned to its lower bound; unpublished quotas pace
 * nothing. The source's full array and its uncertainty stay in the catalogue.
 */
function pacedValue(quota: readonly number[] | 'none' | undefined): number | undefined {
  if (quota === undefined || quota === 'none' || quota.length === 0) return undefined
  return Math.min(...quota)
}

/** A catalogue entry publishing both ceilings this route has to size. */
type ShippedEntry = UpbGatewayEntry & { maxInputTokens: number; maxOutputTokens: number }

/**
 * Whether a chat-executable entry publishes the input and output ceilings this
 * route needs. An entry without them is refused rather than sized from a
 * fallback.
 * @param entry - any chat-executable catalogue entry.
 * @returns whether both ceilings are published numbers.
 */
function hasPublishedCeilings(entry: UpbGatewayEntry): entry is ShippedEntry {
  return entry.maxInputTokens !== undefined && entry.maxOutputTokens !== undefined
}

/**
 * The per-request output cap this gateway admits for one model: the published
 * output maximum lowered to the model's share of the gateway's per-minute token
 * budget (`tpm / maxParallel`). A model that publishes no per-minute budget or
 * no simultaneous-request ceiling keeps its published output maximum.
 * @param entry - a catalogue entry with both published ceilings.
 * @returns the output cap in tokens, never above the published maximum.
 */
function requestOutputCap(entry: ShippedEntry): number {
  const tpm = pacedValue(entry.tpm)
  const parallel = entry.maxParallel
  if (tpm === undefined || parallel === undefined || parallel <= 0) return entry.maxOutputTokens
  return Math.min(entry.maxOutputTokens, Math.floor(tpm / parallel))
}

/** The chat-executable catalogue entries this route ships, in catalogue order. */
const SHIPPED_ENTRIES: readonly ShippedEntry[] = UPB_CHAT_MODELS.filter(hasPublishedCeilings)

/**
 * The Uni Paderborn AI-Gateway's shipped chat models, derived from
 * {@link UPB_CHAT_MODELS}: every chat-executable entry, including the `(Test)`
 * listings flagged `testOnly`. Capability and budget facts come from the
 * canonical catalogue; only the scalar reshaping below is local. None of these
 * entries is a default; the model used by default is chosen by the
 * `agent-default-model` configuration layer, not by this route.
 */
export const UPB_GATEWAY_MODELS: PiAiModelProfile[] = SHIPPED_ENTRIES.map((entry) => {
  const vision = entry.badges.includes('Vision')
  const rpm = pacedValue(entry.rpm)
  const tpm = pacedValue(entry.tpm)
  return {
    id: entry.id,
    name: entry.name,
    // Local policy: the published max-input value is carried as the scalar
    // context capacity. The source publishes no combined-request+response
    // window, so this is a capacity chosen for routing, not a verified
    // combined budget; both limits stay separately in the catalogue.
    contextWindow: entry.maxInputTokens,
    // A configured `maxTokens` is the per-request output default DSH sends, so
    // the shipped value is the gateway-admissible cap rather than the published
    // maximum output, which stays in the catalogue as the model's capability.
    maxTokens: requestOutputCap(entry),
    ...rpm === undefined ? {} : { rpm },
    ...tpm === undefined ? {} : { tpm },
    ...vision ? { input: VISION } : {},
  }
})

/**
 * Output-token allowance for proactive pacing on the shipped route: the largest
 * per-request cap the shipped models publish. `ModelRateLimiter` reserves
 * `input + allowance` for a request, which is what the gateway charges, so a
 * request waits for the rolling-minute budget instead of being throttled.
 */
export const UPB_GATEWAY_REQUEST_OUTPUT_TOKENS = SHIPPED_ENTRIES.reduce(
  (max, entry) => Math.max(max, requestOutputCap(entry)), 0)

/**
 * A ready-to-use openai-completions route for the Uni Paderborn AI-Gateway.
 * Activate it with only the API key exported as `UPB_AI_GATEWAY_KEY`
 * (equivalently `UPB_GATEWAY_API_KEY_ENV`).
 */
export const UPB_GATEWAY_PROFILE: PiAiProviderProfile = {
  apiKeyEnv: UPB_GATEWAY_API_KEY_ENV,
  displayName: 'Uni Paderborn AI-Gateway',
  api: 'openai-completions',
  baseURL: UPB_GATEWAY_BASE_URL,
  ...UPB_GATEWAY_REQUEST_OUTPUT_TOKENS === 0
    ? {}
    : { rateLimitOutputTokens: UPB_GATEWAY_REQUEST_OUTPUT_TOKENS },
  models: UPB_GATEWAY_MODELS,
}
