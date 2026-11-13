/**
 * Uni Paderborn AI-Gateway: a ready-to-use openai-completions route and its
 * chat model catalog, with the gateway's per-model request/token budgets.
 *
 * The gateway exposes OpenAI-compatible endpoints over HTTPS at
 * `https://ai-gateway.uni-paderborn.de/v1`. It publishes a public model
 * catalog (`/api_hub/api/public-models/`) whose entries carry a `mode`
 * (`chat` / `responses` / `embedding` / `image_generation`) and per-model rate
 * caps. Only `chat`-mode models can be dispatched through this adapter (it
 * streams chat requests only), so this catalog ships the chat-capable models
 * with their declared `rpm` / `tpm` budgets. Declaring `rpm` / `tpm` activates
 * DSH's proactive pacing on those models, so concurrent chats sharing the
 * route never exceed the gateway's per-model caps.
 *
 * References for the rate budgets (from the live public catalog at
 * `https://ai-gateway.uni-paderborn.de/api_hub/api/public-models/` on
 * 2026-11-11):
 * - GWDG-hosted models: 10 RPM, TPM 500 000.
 * - kiconnect-hosted models: 100 RPM, TPM 500 000.
 * - All models: maxParallel 10.
 *
 * @module dsh-llm-pi-ai/upb-gateway
 */
import type { PiAiModelProfile, PiAiProviderProfile } from './config.ts'

/** Route key for the Uni Paderborn AI-Gateway provider. */
export const UPB_GATEWAY_PROVIDER = 'upb-ai-gateway'

/** API root of the Uni Paderborn AI-Gateway. */
export const UPB_GATEWAY_BASE_URL = 'https://ai-gateway.uni-paderborn.de/v1'

/** Credential reference (environment-variable name) for the gateway API key. */
export const UPB_GATEWAY_API_KEY_ENV = 'UPB_AI_GATEWAY_KEY'

/** Rolling-minute token budget served by the German-hosted gateway models. */
const UPB_GWDG_TPM = 500_000
/** Rolling-minute token budget served by the kiconnect-hosted gateway models. */
const UPB_KICONNECT_TPM = 500_000
/** GWDG-hosted chat models allow 10 requests per minute. */
const UPB_GWDG_RPM = 10
/** kiconnect-hosted chat models allow 100 requests per minute. */
const UPB_KICONNECT_RPM = 100

/** Vision-capable chat models accept text and images. */
const VISION: PiAiModelProfile['input'] = ['text', 'image']

/**
 * The Uni Paderborn AI-Gateway's chat-capable models, with their declared
 * `rpm` / `tpm` budgets and known capacities. These are the ids sent to the
 * gateway's `/v1/chat/completions` endpoint on this route. The shipped
 * {@link UPB_GATEWAY_PROFILE} references this exact array, so the two stay a
 * single source of truth.
 */
export const UPB_GATEWAY_MODELS: PiAiModelProfile[] = [
  { id: 'gwdg.deepseek-v4-flash-0731', name: 'DeepSeek V4 Flash 0731', contextWindow: 1_000_000, maxTokens: 384_000, rpm: UPB_GWDG_RPM, tpm: UPB_GWDG_TPM, free: true },
  { id: 'gwdg.gemma-4-31b-it', name: 'Gemma 4 31B', contextWindow: 256_000, maxTokens: 256_000, rpm: UPB_GWDG_RPM, tpm: UPB_GWDG_TPM, free: true, input: VISION },
  { id: 'gwdg.glm-5.3-flash', name: 'GLM 5.3 Flash', contextWindow: 200_000, maxTokens: 200_000, rpm: UPB_GWDG_RPM, tpm: UPB_GWDG_TPM, free: true },
  { id: 'hs-de.qwen3.8-27b', name: 'Qwen 3.8 27B', contextWindow: 262_000, maxTokens: 262_000, rpm: UPB_GWDG_RPM, tpm: UPB_GWDG_TPM, free: true, input: VISION },
  { id: 'hs-de.qwen3.8-27b-no-think', name: 'Qwen 3.8 27B (No-Think)', contextWindow: 262_000, maxTokens: 262_000, rpm: UPB_GWDG_RPM, tpm: UPB_GWDG_TPM, free: true, input: VISION },
  { id: 'gwdg.qwen3.6-35b-a3b', name: 'Qwen 3.6 35B A3B', contextWindow: 262_000, maxTokens: 262_000, rpm: UPB_GWDG_RPM, tpm: UPB_GWDG_TPM, free: true, input: VISION },
  { id: 'gwdg.qwen3.6-35b-a3b-no-think', name: 'Qwen 3.6 35B A3B (No-Think)', contextWindow: 262_000, maxTokens: 262_000, rpm: UPB_GWDG_RPM, tpm: UPB_GWDG_TPM, free: true, input: VISION },
  { id: 'gwdg.qwen3.5-397b-a17b', name: 'Qwen 3.5 397B A17B', contextWindow: 256_000, maxTokens: 256_000, rpm: UPB_GWDG_RPM, tpm: UPB_GWDG_TPM, free: true, input: VISION },
  { id: 'gwdg.qwen3.5-397b-a17b-no-think', name: 'Qwen 3.5 397B A17B (No-Think)', contextWindow: 256_000, maxTokens: 256_000, rpm: UPB_GWDG_RPM, tpm: UPB_GWDG_TPM, free: true, input: VISION },
  { id: 'gwdg.qwen3-30b-a3b-instruct-2507', name: 'Qwen 3 Instruct 30B A3B', contextWindow: 256_000, maxTokens: 256_000, rpm: UPB_GWDG_RPM, tpm: UPB_GWDG_TPM, free: true },
  { id: 'gwdg.qwen3-coder-next', name: 'Qwen 3 Coder Next', contextWindow: 256_000, maxTokens: 256_000, rpm: UPB_GWDG_RPM, tpm: UPB_GWDG_TPM, free: true },
  { id: 'gwdg.qwen3-omni-30b-a3b-instruct', name: 'Qwen 3 Omni 30B A3B', contextWindow: 256_000, maxTokens: 256_000, rpm: UPB_GWDG_RPM, tpm: UPB_GWDG_TPM, free: true, input: VISION },
  { id: 'hs-de.eurollm-22b-instruct-2512', name: 'EuroLLM 22B Instruct', contextWindow: 32_000, maxTokens: 32_000, rpm: UPB_GWDG_RPM, tpm: UPB_GWDG_TPM, free: true },
  { id: 'kiconnect.mistralai-mistral-small-4-119b-2603', name: 'Mistral Small 4 119B', contextWindow: 256_000, maxTokens: 256_000, rpm: UPB_KICONNECT_RPM, tpm: UPB_KICONNECT_TPM, free: true, input: VISION },
  { id: 'gwdg.meta-llama-3.1-8b-instruct', name: 'Llama 3.1 8B Instruct', contextWindow: 128_000, maxTokens: 128_000, rpm: UPB_GWDG_RPM, tpm: UPB_GWDG_TPM, free: true },
  { id: 'hs-de.openai-gpt-oss-120b', name: 'OpenAI GPT OSS 120B', contextWindow: 128_000, maxTokens: 128_000, rpm: UPB_KICONNECT_RPM, tpm: UPB_KICONNECT_TPM, free: true },
]

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
  models: UPB_GATEWAY_MODELS,
}
