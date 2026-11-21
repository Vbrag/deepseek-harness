/**
 * Canonical, Git-tracked catalogue of the University of Paderborn AI-Gateway.
 *
 * This module is the single source of truth for the gateway's published model
 * facts. Consumers derive their own views from {@link UPB_GATEWAY_CATALOG}
 * rather than restating the same values: the shipped pi-ai chat route uses
 * {@link UPB_CHAT_MODELS}, and the orchestration router derives its factual
 * fields from `upbEntryOf`. Do not hand-copy a model's numbers into another
 * file; import and derive.
 *
 * Facts are captured from the gateway's public catalogue
 * (`https://ai-gateway.uni-paderborn.de/api_hub/models-info`, data endpoint
 * `https://ai-gateway.uni-paderborn.de/api_hub/api/public-models/`) and
 * reconciled against the dated reference
 * `UPB_AI_Gateway_Model_Reference_2026-11-19.md`. Numeric limits, prices,
 * capability badges, and settings are preserved as published. Material source
 * disagreements are retained verbatim in each entry's `discrepancies`, never
 * silently resolved.
 *
 * @module dsh-llm-pi-ai/upb-gateway-catalog
 */

/** Snapshot source for every entry in the catalogue. */
export const UPB_GATEWAY_SNAPSHOT = {
  url: 'https://ai-gateway.uni-paderborn.de/api_hub/models-info',
  date: '2026-11-19',
  timezone: 'Europe/Berlin',
} as const

/** Entry kind in the gateway catalogue. */
export type UpbEntryKind = 'llm' | 'multimodal' | 'embedding' | 'image' | 'router' | 'alias'

/** API mode the entry is served under. */
export type UpbMode = 'chat' | 'responses' | 'embedding' | 'image_generation'

/** Whether DSH's openai-completions chat adapter can execute this entry today. */
export type UpbCompatStatus = 'chat-executable' | 'chat-unsupported'

/** Interface a page example demonstrates for an entry. */
export type UpbApiInterface = 'chat' | 'responses' | 'embeddings' | 'image'

/** One gateway catalogue entry with its published facts and source URL. */
export interface UpbGatewayEntry {
  /** Exact gateway API id passed to the endpoint. */
  readonly id: string
  /** Display name from the catalogue. */
  readonly name: string
  readonly kind: UpbEntryKind
  readonly mode: UpbMode
  /** Provider label(s), e.g. ['gwdg'], ['kiconnect'], ['kiconnect','gwdg']. */
  readonly providers: readonly string[]
  /** Region label(s), typically ['HS*'] or ['USA']. */
  readonly regions: readonly string[]
  /** Published max input tokens when numerical; omitted when the page lists N/A. */
  readonly maxInputTokens?: number
  /** Published max output tokens (the source's generic column label); omitted when N/A. Not vector dimensionality for embeddings. */
  readonly maxOutputTokens?: number
  /**
   * Published TPM values. An array keeps provider order; the page does not
   * define the accounting window or which charge against it. `'none'` when the
   * page publishes no value.
   */
  readonly tpm?: readonly number[] | 'none'
  /** Published RPM values. A two-element array is a range, not a fixed quota; `'none'` when unpublished. */
  readonly rpm?: readonly number[] | 'none'
  /** Published maximum simultaneous outstanding requests. */
  readonly maxParallel?: number
  /** Published input price per 1M tokens in USD when present. */
  readonly inputPrice?: number
  /** Published output price per 1M tokens in USD when present. */
  readonly outputPrice?: number
  /** Whether the model is served at no per-token cost. */
  readonly free: boolean
  /** Capability badges from the catalogue (Text, Vision, Reasoning, Function Calling, ...). */
  readonly badges: readonly string[]
  /** Additional capabilities mentioned only in prose (e.g. audio, video), not verified. */
  readonly proseCapabilities?: readonly string[]
  /** Listed settings text, e.g. "temperature: 1; top_p: 1"; whether a default or enforced is not established. */
  readonly settings?: string
  /** Reasoning metadata only when explicitly documented. */
  readonly reasoning?: { readonly default?: string; readonly efforts?: readonly string[] }
  /** true for entries the page labels "(Test)": availability is not guaranteed. */
  readonly testOnly?: boolean
  /** Whether DSH's openai-completions chat adapter can dispatch this entry today. */
  readonly compatStatus: UpbCompatStatus
  /** Reason when {@link compatStatus} is `chat-unsupported`. */
  readonly compatReason?: string
  /** Interface demonstrated by a page example, when one is published. */
  readonly apiInterface?: UpbApiInterface
  /** For alias entries: the resolved base-model target id. */
  readonly aliasTarget?: string
  /** For router entries: routing stage to target gateway model ids. */
  readonly routedModelMap?: Readonly<Record<string, readonly string[]>>
  /** Source URL and catalogue snapshot date for the entry. */
  readonly source: { readonly url: string; readonly snapshot: string }
  /** Material source discrepancies, preserved verbatim. */
  readonly discrepancies?: readonly string[]
}

const SRC = `${UPB_GATEWAY_SNAPSHOT.url} (${UPB_GATEWAY_SNAPSHOT.date}, ${UPB_GATEWAY_SNAPSHOT.timezone})`

/** Catalogue entry serving the chat interface that DSH's openai-completions adapter can dispatch. */
function isChatExecutable(entry: UpbGatewayEntry): boolean {
  return (entry.kind === 'llm' || entry.kind === 'multimodal')
    && entry.mode === 'chat'
    && entry.compatStatus === 'chat-executable'
    && entry.apiInterface === 'chat'
}

/**
 * The complete gateway catalogue: 32 numeric model rows, 6 routers, and 3
 * base-model aliases (41 distinct identifiers), snapshot 2026-11-19.
 */
export const UPB_GATEWAY_CATALOG: readonly UpbGatewayEntry[] = [
  // --- Base-model aliases (3) ---
  {
    id: 'hs-de.latest-basemodel',
    name: 'HS-DE: Basismodel',
    kind: 'alias',
    mode: 'chat',
    providers: ['kiconnect', 'gwdg'],
    regions: ['HS*'],
    maxInputTokens: 262000,
    maxOutputTokens: 262000,
    tpm: [500000, 500000],
    rpm: [100, 10],
    maxParallel: 10,
    free: true,
    badges: ['Text', 'Vision', 'Reasoning', 'Function Calling'],
    settings: 'temperature: 1; top_p: 0.95',
    reasoning: { default: 'high', efforts: ['low', 'medium', 'high', 'xhigh'] },
    compatStatus: 'chat-executable',
    apiInterface: 'chat',
    aliasTarget: 'hs-de.qwen3.8-27b',
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
    discrepancies: ['Alias target fragment #table-gwdg.qwen3.8-27b is stale; the equivalent listed row uses hs-de.qwen3.8-27b'],
  },
  {
    id: 'openai.latest-basemodel',
    name: 'OpenAI Basismodel (GPT-6 Luna High Reasoning)',
    kind: 'alias',
    mode: 'responses',
    providers: ['openai'],
    regions: ['USA'],
    maxInputTokens: 922000,
    maxOutputTokens: 128000,
    tpm: [2000000],
    rpm: [100],
    maxParallel: 10,
    free: false,
    inputPrice: 0.1,
    outputPrice: 0.5,
    badges: ['Text', 'Vision', 'Reasoning', 'Function Calling'],
    settings: 'Keine',
    reasoning: { default: 'medium', efforts: ['none', 'low', 'medium', 'high'] },
    compatStatus: 'chat-unsupported',
    compatReason: 'responses interface; not dispatchable through the openai-completions chat route',
    apiInterface: 'responses',
    aliasTarget: 'openai.gpt-6-luna',
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
  },
  {
    id: 'anthropic.latest-basemodel',
    name: 'Anthropic Basismodel (Claude Sonnet 5.5)',
    kind: 'alias',
    mode: 'chat',
    providers: ['anthropic'],
    regions: ['USA'],
    maxInputTokens: 1000000,
    maxOutputTokens: 128000,
    tpm: [2000000],
    rpm: [100],
    maxParallel: 10,
    free: false,
    inputPrice: 2,
    outputPrice: 10,
    badges: ['Text', 'Vision', 'Reasoning', 'Function Calling'],
    settings: 'Keine',
    compatStatus: 'chat-executable',
    apiInterface: 'chat',
    aliasTarget: 'anthropic.claude-sonnet-5-5',
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
    discrepancies: ['Alias target fragment #table-azure_ai.claude-sonnet-5-5 is stale; the equivalent listed row uses anthropic.claude-sonnet-5-5'],
  },

  // --- Direct Anthropic models (M01-M04): chat interface, paid, shipped ---
  {
    id: 'anthropic.claude-fable-5-2',
    name: 'Claude Fable 5.2',
    kind: 'multimodal',
    mode: 'chat',
    providers: ['anthropic'],
    regions: ['USA'],
    maxInputTokens: 1000000,
    maxOutputTokens: 128000,
    tpm: [2000000],
    rpm: [100],
    maxParallel: 10,
    free: false,
    inputPrice: 8,
    outputPrice: 40,
    badges: ['Text', 'Vision', 'Reasoning', 'Function Calling'],
    settings: 'Keine',
    compatStatus: 'chat-executable',
    apiInterface: 'chat',
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
  },
  {
    id: 'anthropic.claude-opus-5-5',
    name: 'Claude Opus 5.5',
    kind: 'multimodal',
    mode: 'chat',
    providers: ['anthropic'],
    regions: ['USA'],
    maxInputTokens: 1000000,
    maxOutputTokens: 128000,
    tpm: [2000000],
    rpm: [100],
    maxParallel: 10,
    free: false,
    inputPrice: 4,
    outputPrice: 20,
    badges: ['Text', 'Vision', 'Reasoning', 'Function Calling'],
    settings: 'Keine',
    compatStatus: 'chat-executable',
    apiInterface: 'chat',
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
  },
  {
    id: 'anthropic.claude-sonnet-5-5',
    name: 'Claude Sonnet 5.5',
    kind: 'multimodal',
    mode: 'chat',
    providers: ['anthropic'],
    regions: ['USA'],
    maxInputTokens: 1000000,
    maxOutputTokens: 128000,
    tpm: [2000000],
    rpm: [100],
    maxParallel: 10,
    free: false,
    inputPrice: 2,
    outputPrice: 10,
    badges: ['Text', 'Vision', 'Reasoning', 'Function Calling'],
    settings: 'Keine',
    compatStatus: 'chat-executable',
    apiInterface: 'chat',
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
  },
  {
    id: 'anthropic.claude-haiku-5-5',
    name: 'Claude Haiku 5.5',
    kind: 'multimodal',
    mode: 'chat',
    providers: ['anthropic'],
    regions: ['USA'],
    maxInputTokens: 1000000,
    maxOutputTokens: 128000,
    tpm: [2000000],
    rpm: [100],
    maxParallel: 10,
    free: false,
    inputPrice: 0.1,
    outputPrice: 0.5,
    badges: ['Text', 'Vision', 'Reasoning', 'Function Calling'],
    settings: 'Keine',
    compatStatus: 'chat-executable',
    apiInterface: 'chat',
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
  },

  // --- Direct OpenAI GPT models (M05-M08): responses interface ---
  {
    id: 'openai.gpt-6-astra',
    name: 'GPT-6 Astra',
    kind: 'multimodal',
    mode: 'responses',
    providers: ['openai'],
    regions: ['USA'],
    maxInputTokens: 922000,
    maxOutputTokens: 128000,
    tpm: [2000000],
    rpm: [100],
    maxParallel: 10,
    free: false,
    inputPrice: 10,
    outputPrice: 50,
    badges: ['Text', 'Vision', 'Reasoning', 'Function Calling'],
    settings: 'Keine',
    reasoning: { default: 'medium', efforts: ['none', 'low', 'medium', 'high'] },
    compatStatus: 'chat-unsupported',
    compatReason: 'responses interface; not dispatchable through the openai-completions chat route',
    apiInterface: 'responses',
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
  },
  {
    id: 'openai.gpt-6.1-sol',
    name: 'GPT-6.1 Sol',
    kind: 'multimodal',
    mode: 'responses',
    providers: ['openai'],
    regions: ['USA'],
    maxInputTokens: 922000,
    maxOutputTokens: 128000,
    tpm: [2000000],
    rpm: [100],
    maxParallel: 10,
    free: false,
    inputPrice: 2,
    outputPrice: 10,
    badges: ['Text', 'Vision', 'Reasoning', 'Function Calling'],
    settings: 'Keine',
    reasoning: { default: 'medium', efforts: ['none', 'low', 'medium', 'high'] },
    compatStatus: 'chat-unsupported',
    compatReason: 'responses interface; not dispatchable through the openai-completions chat route',
    apiInterface: 'responses',
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
  },
  {
    id: 'openai.gpt-6.1-terra',
    name: 'GPT-6.1 Terra',
    kind: 'multimodal',
    mode: 'responses',
    providers: ['openai'],
    regions: ['USA'],
    maxInputTokens: 922000,
    maxOutputTokens: 128000,
    tpm: [2000000],
    rpm: [100],
    maxParallel: 10,
    free: false,
    inputPrice: 1,
    outputPrice: 5,
    badges: ['Text', 'Vision', 'Reasoning', 'Function Calling'],
    settings: 'Keine',
    reasoning: { default: 'medium', efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] },
    compatStatus: 'chat-unsupported',
    compatReason: 'responses interface; not dispatchable through the openai-completions chat route',
    apiInterface: 'responses',
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
  },
  {
    id: 'openai.gpt-6-luna',
    name: 'GPT-6 Luna',
    kind: 'multimodal',
    mode: 'responses',
    providers: ['openai'],
    regions: ['USA'],
    maxInputTokens: 922000,
    maxOutputTokens: 128000,
    tpm: [2000000],
    rpm: [100],
    maxParallel: 10,
    free: false,
    inputPrice: 0.1,
    outputPrice: 0.5,
    badges: ['Text', 'Vision', 'Reasoning', 'Function Calling'],
    settings: 'Keine',
    reasoning: { default: 'medium', efforts: ['none', 'low', 'medium', 'high'] },
    compatStatus: 'chat-unsupported',
    compatReason: 'responses interface; not dispatchable through the openai-completions chat route',
    apiInterface: 'responses',
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
  },

  // --- Image model (M09) ---
  {
    id: 'openai.gpt-image-1.5',
    name: 'GPT Image 1.5 (Bildgenerierung/-bearbeitung)',
    kind: 'image',
    mode: 'image_generation',
    providers: ['openai'],
    regions: ['USA'],
    tpm: [2000000],
    rpm: [100],
    maxParallel: 10,
    free: false,
    inputPrice: 5,
    outputPrice: 10,
    badges: ['Text', 'Vision'],
    settings: 'Keine',
    compatStatus: 'chat-unsupported',
    compatReason: 'image_generation mode; no image execution system added',
    apiInterface: 'image',
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
    discrepancies: [
      'No published per-model API example on the card',
      'AI-Chat selector uses openai-bilder, not the API id openai.gpt-image-1.5',
      'Prose includes claims specifically about GPT Image 2; do not assign them to this 1.5 entry',
    ],
  },

  // --- Free chat-executable HS*/GWDG/kiconnect models (M10-M28) ---
  {
    id: 'gwdg.deepseek-v4.1-flash-1017',
    name: 'DeepSeek V4.1 Flash 1017 (Test)',
    kind: 'multimodal',
    mode: 'chat',
    providers: ['gwdg'],
    regions: ['HS*'],
    maxInputTokens: 1000000,
    maxOutputTokens: 256000,
    tpm: [500000],
    rpm: [10],
    maxParallel: 10,
    free: true,
    badges: ['Text', 'Vision', 'Reasoning', 'Function Calling'],
    settings: 'temperature: 1; top_p: 1',
    testOnly: true,
    compatStatus: 'chat-executable',
    apiInterface: 'chat',
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
    discrepancies: ['Source restriction: test use only; continued availability is not guaranteed'],
  },
  {
    id: 'gwdg.glm-5.3',
    name: 'GLM 5.3 (Test)',
    kind: 'llm',
    mode: 'chat',
    providers: ['gwdg'],
    regions: ['HS*'],
    maxInputTokens: 1000000,
    maxOutputTokens: 128000,
    tpm: [500000],
    rpm: [10],
    maxParallel: 10,
    free: true,
    badges: ['Text', 'Reasoning', 'Function Calling'],
    settings: 'temperature: 1; top_p: 0.95',
    testOnly: true,
    compatStatus: 'chat-executable',
    apiInterface: 'chat',
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
    discrepancies: ['Source restriction: test use only; continued availability is not guaranteed'],
  },
  {
    id: 'gwdg.mistral-large-4-1t-a52b',
    name: 'Mistral Large 4 1T A52B (Test)',
    kind: 'multimodal',
    mode: 'chat',
    providers: ['gwdg'],
    regions: ['HS*'],
    maxInputTokens: 1000000,
    maxOutputTokens: 128000,
    tpm: [500000],
    rpm: [10],
    maxParallel: 10,
    free: true,
    badges: ['Text', 'Vision', 'Function Calling'],
    proseCapabilities: ['Reasoning (prose only)'],
    settings: 'temperature: 1; top_p: 0.95',
    testOnly: true,
    compatStatus: 'chat-executable',
    apiInterface: 'chat',
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
    discrepancies: ['Source restriction: test use only; continued availability is not guaranteed'],
  },
  {
    id: 'gwdg.gemma-4-31b-it',
    name: 'Gemma 4',
    kind: 'multimodal',
    mode: 'chat',
    providers: ['gwdg'],
    regions: ['HS*'],
    maxInputTokens: 256000,
    maxOutputTokens: 256000,
    tpm: [500000],
    rpm: [10],
    maxParallel: 10,
    free: true,
    badges: ['Text', 'Vision', 'Function Calling'],
    settings: 'Keine',
    compatStatus: 'chat-executable',
    apiInterface: 'chat',
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
  },
  {
    id: 'gwdg.deepseek-v4-flash-0731',
    name: 'DeepSeek V4 Flash 0731',
    kind: 'llm',
    mode: 'chat',
    providers: ['gwdg'],
    regions: ['HS*'],
    maxInputTokens: 1000000,
    maxOutputTokens: 384000,
    tpm: [500000],
    rpm: [10],
    maxParallel: 10,
    free: true,
    badges: ['Text', 'Reasoning', 'Function Calling'],
    settings: 'temperature: 1; top_p: 1',
    reasoning: { default: 'none', efforts: ['none', 'high', 'max'] },
    compatStatus: 'chat-executable',
    apiInterface: 'chat',
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
    discrepancies: ['Table lists 304B parameters; description lists 284B total / 13B active (unresolved)'],
  },
  {
    id: 'hs-de.openai-gpt-oss-120b',
    name: 'OpenAI GPT OSS',
    kind: 'llm',
    mode: 'chat',
    providers: ['kiconnect'],
    regions: ['HS*'],
    maxInputTokens: 128000,
    maxOutputTokens: 128000,
    tpm: [500000],
    rpm: [100],
    maxParallel: 10,
    free: true,
    badges: ['Text', 'Function Calling'],
    settings: 'Keine',
    compatStatus: 'chat-executable',
    apiInterface: 'chat',
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
    discrepancies: ['Table provider is kiconnect; description refers to GWDG/KISSKI hosting'],
  },
  {
    id: 'gwdg.glm-5.3-flash',
    name: 'GLM 5.3 Flash',
    kind: 'multimodal',
    mode: 'chat',
    providers: ['gwdg'],
    regions: ['HS*'],
    maxInputTokens: 200000,
    maxOutputTokens: 200000,
    tpm: [500000],
    rpm: [10],
    maxParallel: 10,
    free: true,
    badges: ['Text', 'Vision', 'Reasoning', 'Function Calling'],
    settings: 'temperature: 1; top_p: 0.95',
    reasoning: { default: 'high', efforts: ['low', 'high', 'max'] },
    compatStatus: 'chat-executable',
    apiInterface: 'chat',
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
  },
  {
    id: 'hs-de.qwen3.8-27b',
    name: 'Qwen 3.8',
    kind: 'multimodal',
    mode: 'chat',
    providers: ['kiconnect', 'gwdg'],
    regions: ['HS*'],
    maxInputTokens: 262000,
    maxOutputTokens: 262000,
    tpm: [500000, 500000],
    rpm: [100, 10],
    maxParallel: 10,
    free: true,
    badges: ['Text', 'Vision', 'Reasoning', 'Function Calling'],
    settings: 'temperature: 1; top_p: 0.95',
    reasoning: { default: 'high', efforts: ['low', 'medium', 'high', 'xhigh'] },
    compatStatus: 'chat-executable',
    apiInterface: 'chat',
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
    discrepancies: ['RPM cell shows a range 10 - 100; the page does not assign range endpoints to particular providers'],
  },
  {
    id: 'hs-de.qwen3.8-27b-no-think',
    name: 'Qwen 3.8 (Ohne Thinking)',
    kind: 'multimodal',
    mode: 'chat',
    providers: ['kiconnect', 'gwdg'],
    regions: ['HS*'],
    maxInputTokens: 262000,
    maxOutputTokens: 262000,
    tpm: [500000, 500000],
    rpm: [100, 10],
    maxParallel: 10,
    free: true,
    badges: ['Text', 'Vision', 'Reasoning', 'Function Calling'],
    settings: 'temperature: 0.7; top_p: 0.8',
    compatStatus: 'chat-executable',
    apiInterface: 'chat',
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
    discrepancies: [
      'Retains a Reasoning badge despite the no-thinking description',
      'RPM cell shows a range 10 - 100; the page does not assign range endpoints to particular providers',
    ],
  },
  {
    id: 'gwdg.qwen3.6-35b-a3b',
    name: 'Qwen 3.6',
    kind: 'multimodal',
    mode: 'chat',
    providers: ['gwdg'],
    regions: ['HS*'],
    maxInputTokens: 262000,
    maxOutputTokens: 262000,
    tpm: [500000],
    rpm: [10],
    maxParallel: 10,
    free: true,
    badges: ['Text', 'Vision', 'Reasoning', 'Function Calling'],
    settings: 'temperature: 1; top_p: 0.95',
    compatStatus: 'chat-executable',
    apiInterface: 'chat',
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
    discrepancies: ['Live catalogue health_status is unhealthy'],
  },
  {
    id: 'gwdg.qwen3.6-35b-a3b-no-think',
    name: 'Qwen 3.6 (Ohne Thinking)',
    kind: 'multimodal',
    mode: 'chat',
    providers: ['gwdg'],
    regions: ['HS*'],
    maxInputTokens: 262000,
    maxOutputTokens: 262000,
    tpm: [500000],
    rpm: [10],
    maxParallel: 10,
    free: true,
    badges: ['Text', 'Vision', 'Reasoning', 'Function Calling'],
    settings: 'temperature: 1; top_p: 0.95',
    compatStatus: 'chat-executable',
    apiInterface: 'chat',
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
    discrepancies: ['Retains a Reasoning badge despite the no-thinking description'],
  },
  {
    id: 'gwdg.qwen3.5-397b-a17b',
    name: 'Qwen 3.5',
    kind: 'multimodal',
    mode: 'chat',
    providers: ['gwdg'],
    regions: ['HS*'],
    maxInputTokens: 256000,
    maxOutputTokens: 256000,
    tpm: [500000],
    rpm: [10],
    maxParallel: 10,
    free: true,
    badges: ['Text', 'Vision', 'Function Calling'],
    proseCapabilities: ['Reasoning (prose only)'],
    settings: 'temperature: 0.6; top_p: 0.95',
    compatStatus: 'chat-executable',
    apiInterface: 'chat',
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
    discrepancies: ['Discusses reasoning in prose without a Reasoning table badge'],
  },
  {
    id: 'gwdg.qwen3.5-397b-a17b-no-think',
    name: 'Qwen 3.5 (Ohne Thinking)',
    kind: 'multimodal',
    mode: 'chat',
    providers: ['gwdg'],
    regions: ['HS*'],
    maxInputTokens: 256000,
    maxOutputTokens: 256000,
    tpm: [500000],
    rpm: [10],
    maxParallel: 10,
    free: true,
    badges: ['Text', 'Vision', 'Function Calling'],
    settings: 'temperature: 0.6; top_p: 0.95',
    compatStatus: 'chat-executable',
    apiInterface: 'chat',
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
  },
  {
    id: 'gwdg.qwen3-30b-a3b-instruct-2507',
    name: 'Qwen 3 Instruct',
    kind: 'llm',
    mode: 'chat',
    providers: ['gwdg'],
    regions: ['HS*'],
    maxInputTokens: 256000,
    maxOutputTokens: 256000,
    tpm: [500000],
    rpm: [10],
    maxParallel: 10,
    free: true,
    badges: ['Text', 'Function Calling'],
    settings: 'Keine',
    compatStatus: 'chat-executable',
    apiInterface: 'chat',
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
    discrepancies: [
      'HF model card link points to the Thinking-2507 variant, not the instruct variant',
      'Prose contains an incomplete "-Modus" phrase; not reconstructed',
    ],
  },
  {
    id: 'hs-de.eurollm-22b-instruct-2512',
    name: 'EuroLLM',
    kind: 'llm',
    mode: 'chat',
    providers: ['gwdg'],
    regions: ['HS*'],
    maxInputTokens: 32000,
    maxOutputTokens: 32000,
    tpm: [500000],
    rpm: [10],
    maxParallel: 10,
    free: true,
    badges: ['Text'],
    settings: 'Keine',
    compatStatus: 'chat-executable',
    apiInterface: 'chat',
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
  },
  {
    id: 'gwdg.qwen3-coder-next',
    name: 'Qwen 3 Coder Next',
    kind: 'llm',
    mode: 'chat',
    providers: ['gwdg'],
    regions: ['HS*'],
    maxInputTokens: 256000,
    maxOutputTokens: 256000,
    tpm: [500000],
    rpm: [10],
    maxParallel: 10,
    free: true,
    badges: ['Text', 'Function Calling'],
    settings: 'Keine',
    compatStatus: 'chat-executable',
    apiInterface: 'chat',
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
  },
  {
    id: 'gwdg.qwen3-omni-30b-a3b-instruct',
    name: 'Qwen 3 Omni',
    kind: 'multimodal',
    mode: 'chat',
    providers: ['gwdg'],
    regions: ['HS*'],
    maxInputTokens: 256000,
    maxOutputTokens: 256000,
    tpm: [500000],
    rpm: [10],
    maxParallel: 10,
    free: true,
    badges: ['Text', 'Vision'],
    proseCapabilities: ['audio', 'video (prose only; not established as transmittable by the text/image schema)'],
    settings: 'Keine',
    compatStatus: 'chat-executable',
    apiInterface: 'chat',
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
    discrepancies: ['Prose describes audio/video; table badges are Text and Vision; no multimodal endpoint demonstrated'],
  },
  {
    id: 'kiconnect.mistralai-mistral-small-4-119b-2603',
    name: 'Mistral Small 4',
    kind: 'multimodal',
    mode: 'chat',
    providers: ['kiconnect'],
    regions: ['HS*'],
    maxInputTokens: 256000,
    maxOutputTokens: 256000,
    tpm: [500000],
    rpm: [100],
    maxParallel: 10,
    free: true,
    badges: ['Text', 'Vision', 'Function Calling'],
    settings: 'Keine',
    compatStatus: 'chat-executable',
    apiInterface: 'chat',
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
  },
  {
    id: 'gwdg.meta-llama-3.1-8b-instruct',
    name: 'Llama 3.1 8B Instruct',
    kind: 'llm',
    mode: 'chat',
    providers: ['gwdg'],
    regions: ['HS*'],
    maxInputTokens: 128000,
    maxOutputTokens: 128000,
    tpm: [500000],
    rpm: [10],
    maxParallel: 10,
    free: true,
    badges: ['Text', 'Function Calling'],
    settings: 'Keine',
    compatStatus: 'chat-executable',
    apiInterface: 'chat',
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
  },

  // --- Embedding models (M29-M32): embedding mode, reference only ---
  {
    id: 'kiconnect.qwen3-embedding-8b',
    name: 'Qwen 3 Embedding 8B',
    kind: 'embedding',
    mode: 'embedding',
    providers: ['kiconnect'],
    regions: ['HS*'],
    maxInputTokens: 32000,
    maxOutputTokens: 2560,
    tpm: [500000],
    rpm: [100],
    maxParallel: 10,
    free: true,
    badges: ['Text'],
    proseCapabilities: ['>100 languages', 'user-selectable vector dimensions 32-4096'],
    settings: 'Keine',
    compatStatus: 'chat-unsupported',
    compatReason: 'embedding mode; no embedding execution system added',
    apiInterface: 'embeddings',
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
    discrepancies: ['Max Output Tokens cell 2.56k; description allows 32-4096 vector dimensions; the two measures are distinct and unresolved'],
  },
  {
    id: 'gwdg.qwen3-embedding-4b',
    name: 'Qwen 3 Embedding 4B',
    kind: 'embedding',
    mode: 'embedding',
    providers: ['gwdg'],
    regions: ['HS*'],
    maxInputTokens: 32000,
    maxOutputTokens: 2560,
    tpm: [500000],
    rpm: [10],
    maxParallel: 10,
    free: true,
    badges: ['Text'],
    proseCapabilities: ['>100 languages', 'vector dimensions 32-2560'],
    settings: 'Keine',
    compatStatus: 'chat-unsupported',
    compatReason: 'embedding mode; no embedding execution system added',
    apiInterface: 'embeddings',
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
  },
  {
    id: 'hs-de.e5-mistral-7b-instruct',
    name: 'E5 Mistral Instruct',
    kind: 'embedding',
    mode: 'embedding',
    providers: ['kiconnect', 'gwdg'],
    regions: ['HS*'],
    maxInputTokens: 4096,
    maxOutputTokens: 4096,
    tpm: [500000, 500000],
    rpm: [100, 100],
    maxParallel: 10,
    free: true,
    badges: ['Text'],
    proseCapabilities: ['English-only training', '4096 vector dimensions'],
    settings: 'Keine',
    compatStatus: 'chat-unsupported',
    compatReason: 'embedding mode; no embedding execution system added',
    apiInterface: 'embeddings',
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
    discrepancies: ['Card says English-only training while the supplied example uses German text; not a quality validation'],
  },
  {
    id: 'gwdg.multilingual-e5-large-instruct',
    name: 'Multilingual E5 Large Instruct',
    kind: 'embedding',
    mode: 'embedding',
    providers: ['gwdg'],
    regions: ['HS*'],
    maxInputTokens: 1024,
    maxOutputTokens: 1024,
    tpm: [500000],
    rpm: [10],
    maxParallel: 10,
    free: true,
    badges: ['Text'],
    proseCapabilities: ['94 languages', '1024 vector dimensions'],
    settings: 'Keine',
    compatStatus: 'chat-unsupported',
    compatReason: 'embedding mode; no embedding execution system added',
    apiInterface: 'embeddings',
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
  },

  // --- Routing models (R01-R06) ---
  {
    id: 'hs-de.complexity-router',
    name: 'HS-DE: Complexity-Routing',
    kind: 'router',
    mode: 'responses',
    providers: ['kiconnect'],
    regions: ['HS*'],
    tpm: [500000],
    rpm: [100],
    maxParallel: 10,
    free: true,
    badges: [],
    settings: 'Keine',
    compatStatus: 'chat-unsupported',
    compatReason: 'responses interface; router not dispatched through the openai-completions chat route',
    apiInterface: 'responses',
    routedModelMap: {
      SIMPLE: ['gwdg.meta-llama-3.1-8b-instruct', 'gwdg.qwen3-30b-a3b-instruct-2507', 'kiconnect.mistralai-mistral-small-4-119b-2603'],
      MEDIUM: ['hs-de.openai-gpt-oss-120b'],
      COMPLEX: ['gwdg.gemma-4-31b-it'],
      REASONING: ['hs-de.qwen3.8-27b', 'gwdg.glm-5.3-flash'],
    },
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
  },
  {
    id: 'hs-de.moeve-router',
    name: 'HS-DE: MÖVE-Routing',
    kind: 'router',
    mode: 'responses',
    providers: ['hs-de'],
    regions: ['HS*'],
    tpm: [500000],
    rpm: [100],
    maxParallel: 10,
    free: true,
    badges: [],
    settings: 'Keine',
    compatStatus: 'chat-unsupported',
    compatReason: 'responses interface; router not dispatched through the openai-completions chat route',
    apiInterface: 'responses',
    routedModelMap: {
      SIMPLE: ['kiconnect.mistralai-mistral-small-4-119b-2603'],
      MEDIUM: ['gwdg.gemma-4-31b-it', 'hs-de.openai-gpt-oss-120b', 'gwdg.qwen3.6-35b-a3b-no-think'],
      COMPLEX: ['gwdg.gemma-4-31b-it', 'hs-de.openai-gpt-oss-120b', 'gwdg.qwen3.6-35b-a3b'],
      REASONING: ['gwdg.gemma-4-31b-it', 'hs-de.qwen3.8-27b'],
    },
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
  },
  {
    id: 'gwdg.qwen-complexity-router',
    name: 'GWDG: Qwen-Complexity-Routing',
    kind: 'router',
    mode: 'chat',
    providers: ['gwdg'],
    regions: ['HS*'],
    tpm: [500000],
    rpm: [10],
    maxParallel: 10,
    free: true,
    badges: [],
    settings: 'Keine',
    compatStatus: 'chat-unsupported',
    compatReason: 'router entry; not a shipped chat model in the adapter',
    apiInterface: 'chat',
    routedModelMap: {
      SIMPLE: ['gwdg.qwen3-30b-a3b-instruct-2507'],
      MEDIUM: ['gwdg.qwen3.5-397b-a17b-no-think'],
      COMPLEX: ['gwdg.qwen3.5-397b-a17b'],
      REASONING: ['hs-de.qwen3.8-27b'],
    },
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
  },
  {
    id: 'openai.complexity-router',
    name: 'OpenAI Cost-Complexity-Routing',
    kind: 'router',
    mode: 'responses',
    providers: ['openai'],
    regions: ['USA'],
    tpm: [2000000],
    rpm: [100],
    maxParallel: 10,
    free: false,
    badges: [],
    settings: 'Keine',
    compatStatus: 'chat-unsupported',
    compatReason: 'responses interface; router not dispatched through the openai-completions chat route',
    apiInterface: 'responses',
    routedModelMap: {
      SIMPLE: ['openai.gpt-6-luna'],
      MEDIUM: ['openai.gpt-6-luna'],
      COMPLEX: ['openai.gpt-6-luna'],
      REASONING: ['openai.gpt-6.1-sol'],
    },
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
  },
  {
    id: 'anthropic.complexity-router',
    name: 'Anthropic Cost-Complexity-Routing',
    kind: 'router',
    mode: 'responses',
    providers: ['anthropic'],
    regions: ['USA'],
    tpm: [2000000],
    rpm: [100],
    maxParallel: 10,
    free: false,
    badges: [],
    settings: 'Keine',
    compatStatus: 'chat-unsupported',
    compatReason: 'responses interface; router not dispatched through the openai-completions chat route',
    apiInterface: 'responses',
    routedModelMap: {
      SIMPLE: ['anthropic.claude-haiku-5-5'],
      MEDIUM: ['anthropic.claude-sonnet-5-5'],
      COMPLEX: ['anthropic.claude-opus-5-5'],
      REASONING: ['anthropic.claude-fable-5-2'],
    },
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
  },
  {
    id: 'mixed.complexity-router',
    name: 'Mixed Cost-Complexity-Routing',
    kind: 'router',
    mode: 'responses',
    providers: ['mixed'],
    regions: ['HS*', 'USA'],
    tpm: [2000000],
    rpm: [100],
    maxParallel: 10,
    free: false,
    badges: [],
    settings: 'Keine',
    compatStatus: 'chat-unsupported',
    compatReason: 'responses interface; router not dispatched through the openai-completions chat route',
    apiInterface: 'responses',
    routedModelMap: {
      SIMPLE: ['hs-de.openai-gpt-oss-120b'],
      MEDIUM: ['hs-de.qwen3.8-27b', 'gwdg.gemma-4-31b-it'],
      COMPLEX: ['openai.gpt-6-luna'],
      REASONING: ['openai.gpt-6-luna'],
    },
    source: { url: SRC, snapshot: UPB_GATEWAY_SNAPSHOT.date },
    discrepancies: ['Prose says two free models; the detailed table lists three distinct free targets'],
  },
]

/**
 * The catalogue entries DSH's openai-completions chat adapter can dispatch
 * today: language or multimodal models served over the chat interface.
 */
export const UPB_CHAT_MODELS: readonly UpbGatewayEntry[] =
  UPB_GATEWAY_CATALOG.filter(isChatExecutable)

/** Every catalogue entry the chat adapter cannot dispatch, retained for reference. */
export const UPB_REFERENCE_ONLY: readonly UpbGatewayEntry[] =
  UPB_GATEWAY_CATALOG.filter(entry => !isChatExecutable(entry))

/**
 * Whether the chat route can dispatch this entry: its page example uses the
 * chat interface, and it is a language, multimodal, or base-model alias entry.
 * The routers are excluded by kind even when their example is a chat call,
 * because their routing decision belongs to the gateway and this deployment
 * exposes them over the Responses route instead.
 * @param entry - any catalogue entry.
 * @returns whether the openai-completions chat route ships the entry.
 */
function isChatRouteEntry(entry: UpbGatewayEntry): boolean {
  return (entry.kind === 'llm' || entry.kind === 'multimodal' || entry.kind === 'alias')
    && entry.apiInterface === 'chat'
    && entry.compatStatus === 'chat-executable'
}

/**
 * The catalogue entries the chat (`openai-completions`) route ships, in
 * catalogue order: every chat-interface language, multimodal, and alias entry —
 * the free HS-DE and GWDG models, the `(Test)` listings, the paid direct
 * Anthropic models, and the two chat base-model aliases.
 *
 * The Responses-interface entries (the OpenAI models, the OpenAI alias, and the
 * routers) and the four embedding models and the image-generation model are not
 * here: a deployment that offers them routes them separately, because they do
 * not share this route's wire protocol or do not answer with text.
 */
export const UPB_CHAT_ROUTE_MODELS: readonly UpbGatewayEntry[] =
  UPB_GATEWAY_CATALOG.filter(isChatRouteEntry)

/** Look up one catalogue entry by its exact gateway API id.
 * @param id - Exact gateway model id.
 * @returns The matching entry, or undefined when unknown.
 */
export function upbEntryOf(id: string): UpbGatewayEntry | undefined {
  return UPB_GATEWAY_CATALOG.find(entry => entry.id === id)
}
