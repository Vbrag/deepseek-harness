# Uni Paderborn AI-Gateway — DeepSeek Harness project context

This document is the **single reference for modifying the models the DeepSeek Harness uses from the University of Paderborn AI-Gateway** (`https://ai-gateway.uni-paderborn.de`). It describes where the gateway models, their limits, and their capabilities are defined or saved in this repository, how they are selected at runtime, and exactly which file to edit to add, remove, or change a model.

> **Source of truth for gateway facts.** One canonical, Git-tracked catalogue now holds every gateway fact: **`packages/llm/llm-pi-ai/src/upb-gateway-catalog.ts`** (`UPB_GATEWAY_CATALOG`, 41 identifiers, snapshot **2026-11-19**). The human-readable reference [`paderborn-ai-gateway-models.md`](paderborn-ai-gateway-models.md) mirrors that snapshot. Both gateway consumers derive from the canonical catalogue; nothing is hand-copied anymore. Read this document first for how facts are **wired into DSH**, and the catalogue file for the facts themselves.

---

## 1. Overview: the gateway route and how DSH reaches it

DSH reaches the gateway over an **OpenAI-compatible Chat Completions** endpoint at:

- **Base URL:** `https://ai-gateway.uni-paderborn.de/v1`
- **API / protocol:** `openai-completions`
- **Authentication:** a per-request API key resolved from the environment-variable reference `UPB_AI_GATEWAY_KEY` (a key created at <https://ai-gateway.uni-paderborn.de/api_hub/api-keys>), or whatever `apiKeyEnv` a route profile names.

The gateway is served by the **pi-ai multi-provider adapter** package `@deepseek-ai/dsh-llm-pi-ai`, which registers provider routes on `ctx.llm`. A gateway is a "hand-declared" route: the model list, protocol, and endpoint are supplied by the canonical catalogue plus configuration, and DSH does **not** scrape the gateway at runtime.

### There are TWO Paderborn gateway route profiles in this repo

They share the same endpoint but use **different route keys** and load through different files. Both read their factual model data from the **same canonical catalogue**:

| # | Route key | Where defined | Models | Purpose |
|---|---|---|---|---|
| 1 | `upb-ai-gateway` | [`packages/llm/llm-pi-ai/src/upb-gateway.ts`](packages/llm/llm-pi-ai/src/upb-gateway.ts) | 25 shipped chat-route models (23 chat-executable language/multimodal models including the 4 Claude `(direct)` and 3 `(Test)` listings, plus the 2 chat base-model aliases) derived from `UPB_CHAT_ROUTE_MODELS` | A ready-to-activate, exported `UPB_GATEWAY_PROFILE` any composition can mount with only the API key |
| 2 | `uni-paderborn` | [`packages/experimental/orchestration-profile/cordis.patch.yml`](packages/experimental/orchestration-profile/cordis.patch.yml) | A 25-model pool (the full chat set) plus compaction policies | The route the **Orchestration** feature actually uses (`POOL_PROVIDER` in [`packages/experimental/dsh-orchestration/src/capabilities.ts`](packages/experimental/dsh-orchestration/src/capabilities.ts)) |

> **Both routes now share the canonical catalogue.** Factual capability/budget columns (name, context window, RPM/TPM, vision) come from `upb-gateway-catalog.ts`. The orchestration route keeps only its routing **preferences** (`domains`, `health`, `suggested`, pool membership) separate. A factual change is made **once** in the catalogue and flows to both routes. See [§6](#6-modification-guide).

---

## 2. Where each gateway model is defined ("the model path")

### 2.1 The canonical catalogue — `packages/llm/llm-pi-ai/src/upb-gateway-catalog.ts`

This is the **single source of truth** for all 41 gateway identifiers: 32 numeric model rows (M01–M32), 6 routers (R01–R06), and 3 base-model aliases. Every entry is a typed `UpbGatewayEntry` carrying its published facts and source:

- `id`, `name`, `kind` (`llm`/`multimodal`/`embedding`/`image`/`router`/`alias`), `mode` (`chat`/`responses`/`embedding`/`image_generation`), `providers[]`, `regions[]`
- `maxInputTokens` / `maxOutputTokens` — preserved **separately** (no input+output sum, no relabelling of input as a "combined" window; embeddings keep `maxOutputTokens` distinct from vector dimensions)
- `tpm` / `rpm` — array in provider order, or `'none'`; a two-element array is a **range** (e.g. Qwen 3.8 `rpm: [100, 10]`)
- `maxParallel` (10 for every numeric row), `inputPrice`/`outputPrice` per 1M tokens, `free`
- `badges`, `proseCapabilities` (badges-vs-prose distinctions kept apart), `settings`, `reasoning`
- `testOnly` (DeepSeek V4.1 Flash 1017, GLM 5.3, Mistral Large 4 1T are "(Test)" entries)
- `compatStatus` (`chat-executable` vs `chat-unsupported`) + `compatReason`
- `aliasTarget`, `routedModelMap` (routers), `source` (url + snapshot date), `discrepancies` (material source disagreements, preserved verbatim)

Key exports: `UPB_GATEWAY_CATALOG`, `UPB_CHAT_MODELS` (chat-executable language/multimodal subset, 23 rows incl. the 4 Claude direct models), `UPB_CHAT_ROUTE_MODELS` (the shipped chat set: `UPB_CHAT_MODELS` plus the 2 chat base-model aliases, 25 rows), `UPB_REFERENCE_ONLY` (embedding/image/Responses/router/Responses-alias complement), `upbEntryOf(id)`, `UPB_GATEWAY_SNAPSHOT`. Re-exported from [`packages/llm/llm-pi-ai/src/index.ts`](packages/llm/llm-pi-ai/src/index.ts).

**Compatibility model.** `UPB_CHAT_MODELS` are the language/multimodal `mode: chat`, `apiInterface: chat` entries the `openai-completions` adapter can dispatch (23 rows, including the 4 directly-shipped Claude models). The shipped chat route (`UPB_GATEWAY_MODELS`) is `UPB_CHAT_ROUTE_MODELS`: `UPB_CHAT_MODELS` plus the two chat base-model aliases (`hs-de.latest-basemodel`, `anthropic.latest-basemodel`, kind `alias`, `mode: chat`, `apiInterface: chat`, `chat-executable`). Embedding, image-generation, Responses-interface (the 4 GPT-6 models, in `mode: responses`; the Responses OpenAI alias; and the routers) are kept in the catalogue (`UPB_REFERENCE_ONLY`) with an explicit `compatStatus` and reason, and are **not** shipped in the openai-completions chat route.

### 2.2 The shipped route catalog — `packages/llm/llm-pi-ai/src/upb-gateway.ts`

This module **derives** the shipped chat profile from the canonical catalogue; it no longer restates model facts by hand. Key exports:

| Export | Value / meaning |
|---|---|
| `UPB_GATEWAY_PROVIDER` | `'upb-ai-gateway'` (the route key) |
| `UPB_GATEWAY_BASE_URL` | `'https://ai-gateway.uni-paderborn.de/v1'` |
| `UPB_GATEWAY_API_KEY_ENV` | `'UPB_AI_GATEWAY_KEY'` (credential reference name) |
| `UPB_GATEWAY_MODELS` | `PiAiModelProfile[]` — the shipped chat set (`UPB_CHAT_ROUTE_MODELS`, 25 total): the 4 directly-shipped Claude models, the 3 `(Test)` chat listings, the 2 chat base-model aliases, and the free HS-DE/GWDG models, derived from `UPB_CHAT_ROUTE_MODELS` |
| `UPB_GATEWAY_REQUEST_OUTPUT_TOKENS` | `128000` — the route's per-request output cap and pacing allowance: the largest per-model share (the 1M / 128k × RPM-100 Claude models and their aliases), derived from the catalogue; the smaller free models keep their own lower `maxTokens` |
| `UPB_GATEWAY_PROFILE` | `{ apiKeyEnv, displayName: 'Uni Paderborn AI-Gateway', api: 'openai-completions', baseURL, rateLimitOutputTokens: UPB_GATEWAY_REQUEST_OUTPUT_TOKENS, models: UPB_GATEWAY_MODELS }` |

**Reshaping policy (local, documented in the file).**

- `contextWindow` ← published `maxInputTokens`. The source publishes **no combined request+response window**, so this is a capacity chosen for routing, not a verified combined budget; input and output maxima stay separate in the catalogue.
- `maxTokens` ← min(published `maxOutputTokens`, `floor(tpm / maxParallel)`), i.e. the gateway's per-minute token share, per model. For the free 500,000-TPM models that is 50,000 tokens (32,000 for EuroLLM, whose published output maximum is lower); for the 1M-input / 128k-output Claude models and the Anthropic alias (2M TPM × `maxParallel: 10`) it is 128,000. A configured `maxTokens` is also the per-request default the adapter sends, and this gateway charges a request's declared output against its per-minute budget, so shipping the published output maximum (128,000–384,000 tokens) made a single request reserve most of a 500,000-token minute and the next request was throttled with HTTP 429. The published maximum remains the model's capability in the catalogue.
- `rateLimitOutputTokens` ← the largest per-model share on the route (`128,000`), so the local pacing ledger reserves `input + cap`, which is what the gateway charges; the default of 4,096 under-reserved by two orders of magnitude and let doomed requests through. The adapter clamps each request's allowance to its own model cap (see `outputAllowance` in `packages/llm/llm-pi-ai/src/adapter.ts`), so the larger route scalar only under-reserves nothing: the 50,000-cap free models still reserve 50,000.
- `rpm`/`tpm` ← conservative pacing: a one-element array uses the published value; a **two-element range is pinned to its lower bound** (the Qwen 3.8 `10 – 100` rows pace at `10`). The source's full array stays in the catalogue.
- `input` ← `['text','image']` for `Vision`-badge chat entries.
- `testOnly` chat entries are **shipped** alongside the production chat models so the gateway's `(Test)` listings appear in pickers and are callable. None is a default (defaults come from `agent-default-model`), and their source restriction ("test use only; continued availability is not guaranteed") is preserved in the catalogue and surfaced in each model's `(Test)` name.
- `reasoningEfforts` are not forced into the shipped profile; reasoning metadata is preserved in the catalogue.

Entries are re-exported from [`packages/llm/llm-pi-ai/src/index.ts`](packages/llm/llm-pi-ai/src/index.ts), and the derivation is guarded by the test suite at [`packages/llm/llm-pi-ai/tests/upb-gateway.spec.ts`](packages/llm/llm-pi-ai/tests/upb-gateway.spec.ts) plus the structural catalogue checks at [`upb-gateway-catalog.spec.ts`](packages/llm/llm-pi-ai/tests/upb-gateway-catalog.spec.ts).

### 2.3 The route profile schema (what fields a model entry accepts)

The per-model fields above are validated by the pi-ai profile schema. The full contracts live in:

- **`PiAiModelProfile`** — [`packages/llm/llm-pi-ai/src/catalog.ts`](packages/llm/llm-pi-ai/src/catalog.ts). Fields: `id` (required), `name?`, `contextWindow?`, `maxTokens?`, `rpm?`, `tpm?`, `free?`, `pricing?` (`{input?, output?}` per 1M tokens), `input?` (`text`/`image`), `reasoningEfforts?`, `compat?`.
- **`PiAiProviderProfile`** — [`packages/llm/llm-pi-ai/src/config.ts`](packages/llm/llm-pi-ai/src/config.ts). Route-level fields: `apiKeyEnv?`, `displayName?`, `api?`, `baseURL?`, `models?`, `modelOverrides?`, `compat?`, `defaultContextWindow?`, `defaultMaxTokens?`, `defaultInput?`, `headers?`, `reasoning?`, `thinkingBudgets?`, pacing/image-budget limits (`rateLimitOutputTokens`, `maxRequestImageBytes`, `maxRequestImages`, `requestImagePixelBudget`, …), `retryPolicy?`, and **`rateLimitBudgetKey?`**.

`rateLimitBudgetKey` (added for the two-route shared quota case) is an **optional** identity used for pacing. Pacing charges are otherwise keyed by `provider\0model`, so two route keys to the same gateway model get separate ledgers. Setting the same `rateLimitBudgetKey` value (for example the shared gateway base URL) on both routes makes them charge one ledger when a deployment guarantees a genuinely shared upstream quota. It is opt-in; whether upstream sharing applies is not verifiable locally.

Route-level **fallback defaults** (used when neither a model entry nor the route signal sets a value):

| Constant | Default |
|---|---|
| `DEFAULT_CONTEXT_WINDOW` | `1_000_000` |
| `DEFAULT_MAX_TOKENS` | `128_000` |
| `DEFAULT_INPUT` | `['text']` |
| `DEFAULT_MAX_REQUEST_IMAGE_BYTES` | 20 MiB |
| `DEFAULT_MAX_REQUEST_IMAGES` | 50 |
| `DEFAULT_RATE_LIMIT_OUTPUT_TOKENS` | `4096` |

### 2.4 The Orchestration route (`uni-paderborn`) and its model catalog

The **Orchestration** feature is the alternative consumer of the gateway. It is experimental (`packages/experimental/`) and uses route key `uni-paderborn`, not `upb-ai-gateway`.

- **Pool definition** — [`packages/experimental/orchestration-profile/cordis.patch.yml`](packages/experimental/orchestration-profile/cordis.patch.yml). The `orchestration` plugin's `pool` selects the full gateway chat set — 25 models under `provider: uni-paderborn` (the same membership as `UPB_CHAT_ROUTE_MODELS`), and `compaction-basic`’s `modelPolicies` add per-model compaction budgets (`headroomTokens`/`maxTokens`) for `gwdg.glm-5.3-flash` and `hs-de.qwen3.8-27b`.
- **Capability catalog** — [`packages/experimental/dsh-orchestration/src/capabilities.ts`](packages/experimental/dsh-orchestration/src/capabilities.ts). `PADERBORN_CATALOG` is a curated table covering **all 25 shipped chat-route models** (so the orchestration pool picker has a row for every pool member). **Factual columns** (`name`, `imageInput`, `contextWindow`, `rateLimits`) are kept equal to the canonical catalogue and enforced by [`tests/capabilities.gate.spec.ts`](packages/experimental/dsh-orchestration/tests/capabilities.gate.spec.ts), which fails CI on any drift or on any chat-route model missing a curated row. The **preference columns** (`domains`, `modalities` extras, `health`, `suggested`) stay local routing choices no gateway catalogue can supply. `POOL_PROVIDER = 'uni-paderborn'`.
- **Tip of the data flow:** because a gate asserts equality against the catalogue, the orchestration factual columns cannot silently drift; the catalogue is the one place to change a factual value.

### 2.5 Route configuration at deployment time (where the running profile's models are saved)

The `llm-pi-ai` plugin is mounted dormant in the base bundle (see [`packages/bundle/base/cordis.patch.yml`](packages/bundle/base/cordis.patch.yml), row `llm-pi-ai`): it has **zero routes** until a `llm-pi-ai:` settings section supplies provider profiles; supplying them is what the web Models page does.

The three places user/deployment model configuration is persisted:

1. **Active profile patch** — `$DSH_HOME/profiles/<name>/cordis.patch.yml`. The web **Models page** (`@deepseek-ai/dsh-client-ui-settings-models`) writes `providers.<provider>…` under the `llm-pi-ai` entry id here, via the `config-editor` service.
2. **Credential store** — `$DSH_HOME/.credentials.yaml`. The API key for `apiKeyEnv` is stored here; it is never materialized into the process environment.
3. **Model selection** — the `agent-default-model` row (base bundle, default `provider: deepseek-official`, `model: deepseek-flash`). The composer's model switch writes this row in the profile patch via `ctx.agentDefaultModel.saveSelection()`.

`$DSH_HOME` = the `DSH_HOME` env var, else `~/.dsh`.

> **Layout precedence** (last write wins per row id): profile bundles → profile `cordis.patch.yml` → home patch `$DSH_HOME/cordis.patch.yml` → `--patch` CLI overlays. A deployment override of `models`/`modelOverrides` for a route **masks** the updated packaged catalogue for that route; the shipped catalogue takes effect only where no user layer supplies a conflicting `models` list.

---

## 3. Where model limits and capabilities are stored / resolved

| Layer | Location | What it holds | Persisted? |
|---|---|---|---|
| **A. Canonical catalogue** | [`upb-gateway-catalog.ts`](packages/llm/llm-pi-ai/src/upb-gateway-catalog.ts) | Every gateway fact (41 ids): input/output tokens, RPM/TPM arrays/ranges, prices, badges, mode, compat, source | On disk (source) |
| **B. Shipped chat route** | [`upb-gateway.ts`](packages/llm/llm-pi-ai/src/upb-gateway.ts) (`UPB_GATEWAY_MODELS`) | **Derived** `PiAiModelProfile[]` (chat, incl. `(Test)`) | On disk (source) |
| **C. Orchestration preferences** | [`capabilities.ts`](packages/experimental/dsh-orchestration/src/capabilities.ts) (`PADERBORN_CATALOG`) | Curated `domains`/`health`/`suggested` + factual columns gated equal to the catalogue | On disk (source) |
| **D. Reference doc** | [`paderborn-ai-gateway-models.md`](paderborn-ai-gateway-models.md) | Human-readable mirror of the snapshot | On disk (reference) |
| **E. Runtime-resolved model info** | adapter `resolveModel()` → `LlmResolvedModelInfo` (`packages/llm/llm/src/types.ts`) | The **authoritative** per-request capabilities, assembled from config + catalogue | In-memory, per call |

**The authoritative runtime representation.** `ctx.llm.resolveModelInfo(provider, model)` resolves capabilities from the adapter owning the exact route and validates them. `LlmResolvedModelInfo` ([`packages/llm/llm/src/types.ts`](packages/llm/llm/src/types.ts)) carries `context?`, `defaultMaxTokens?`, `maxOutputTokens?`, `reasoning?`, `rateLimit?`, `inputModalities?`, `systemPromptUpdate?`, `toolUpdate?`.

> A model catalog is **advisory**: routing still works for model ids not in any catalog. Catalogs mainly gate the GUI model picker and provide metadata.

### 3.1 Rate limiting / RPM–TPM pacing

- **Ledger:** `ModelRateLimiter` in [`packages/llm/llm-pi-ai/src/rate-limit.ts`](packages/llm/llm-pi-ai/src/rate-limit.ts). Rolling 60-second window, keyed by `provider\0model` **or** an explicit `rateLimitBudgetKey`. **In-memory only, not persisted.**
- **Declared output is charged:** the gateway meters each request's asked-for output (`max_tokens`, which is the model's `maxTokens` request default) against its 500,000-token minute, not only the tokens actually generated. The shipped route therefore declares, per model, the gateway-admissible cap (`min(published max output, floor(tpm / maxParallel))` — 50,000 for the free 500k-TPM models, 128,000 for the Claude models and Anthropic alias) and a route `rateLimitOutputTokens` of `128,000` (the largest share); the adapter clamps each request's allowance to its own model cap, so one request cannot reserve the whole minute and the limiter queues instead of provoking HTTP 429.
- **Scope:** shared across sessions for the same ledger key within one adapter instance; separate instances/processes are independent.
- **Dispatch:** reserves 1 request + estimated input tokens + output allowance; an estimate exceeding the whole TPM budget fails with `RATE_LIMIT_REQUEST_TOO_LARGE`; reported usage replaces the estimate (including debt).
- **Input estimation** (`packages/llm/llm/src/input-estimate.ts`): `ceil(chars/4) + images × 1000`.

### 3.2 Token meter (context-pressure measurement)

Fixed heuristics in [`packages/llm/token-meter/src/estimate.ts`](packages/llm/token-meter/src/estimate.ts) (`CHARS_PER_TOKEN = 4`). Route-priced image tokens in [`route-pricing.ts`](packages/llm/token-meter/src/route-pricing.ts); no gateway-specific numbers are stored there.

### 3.3 Model listing (`GET /models`) — DeepSeek-only, not the gateway

The dynamic `/models` listing, listing cache, and disk writes belong to the **DeepSeek** routes (`deepseek-official`, `deepseek-account`), not the Paderborn gateway. The gateway is a hand-declared route with a **static** catalogue; it does not interrogate the endpoint at runtime.

---

## 4. Files at a glance (the full "where is it saved" map)

| Path | Role for the Paderborn gateway |
|---|---|
| [`paderborn-ai-gateway-models.md`](paderborn-ai-gateway-models.md) | Human-readable reference snapshot (2026-11-19) of the gateway's 41-entry catalogue |
| [`packages/llm/llm-pi-ai/src/upb-gateway-catalog.ts`](packages/llm/llm-pi-ai/src/upb-gateway-catalog.ts) | **Canonical catalogue** — single source of truth (`UPB_GATEWAY_CATALOG`, `UPB_CHAT_MODELS`, `UPB_REFERENCE_ONLY`, `upbEntryOf`) |
| [`packages/llm/llm-pi-ai/src/upb-gateway.ts`](packages/llm/llm-pi-ai/src/upb-gateway.ts) | Shipped chat route for `upb-ai-gateway` (**derived** from the catalogue) |
| [`packages/llm/llm-pi-ai/src/catalog.ts`](packages/llm/llm-pi-ai/src/catalog.ts) | `PiAiModelProfile` schema and catalog-resolution logic |
| [`packages/llm/llm-pi-ai/src/config.ts`](packages/llm/llm-pi-ai/src/config.ts) | `PiAiProviderProfile` schema (incl. `rateLimitBudgetKey`), route defaults, `resolveProfiles` |
| [`packages/llm/llm-pi-ai/src/rate-limit.ts`](packages/llm/llm-pi-ai/src/rate-limit.ts) | RPM/TPM pacing ledger (optional shared `budgetKey`) |
| [`packages/llm/llm-pi-ai/tests/upb-gateway.spec.ts`](packages/llm/llm-pi-ai/tests/upb-gateway.spec.ts) | Behavior tests guarding the shipped route (incl. derivation policy) |
| [`packages/llm/llm-pi-ai/tests/upb-gateway-catalog.spec.ts`](packages/llm/llm-pi-ai/tests/upb-gateway-catalog.spec.ts) | Structural catalogue checks (unique ids, alias/router refs, source, partition) |
| [`packages/llm/llm-pi-ai/scripts/gen-upb-profile.ts`](packages/llm/llm-pi-ai/scripts/gen-upb-profile.ts) | Refreshes a deployment profile's chat-route `models` from the shipped catalogue (`pnpm gen-upb-profile` / `verify-upb-profile`) |
| [`packages/llm/llm-pi-ai/tests/gen-upb-profile.spec.ts`](packages/llm/llm-pi-ai/tests/gen-upb-profile.spec.ts) | Pins that derivation and the deployment-field-preserving patch edit |
| [`packages/experimental/orchestration-profile/cordis.patch.yml`](packages/experimental/orchestration-profile/cordis.patch.yml) | Orchestration pool + compaction model policies for route `uni-paderborn` |
| [`packages/experimental/dsh-orchestration/src/capabilities.ts`](packages/experimental/dsh-orchestration/src/capabilities.ts) | Curated routing preferences (`PADERBORN_CATALOG`) |
| [`packages/experimental/dsh-orchestration/tests/capabilities.gate.spec.ts`](packages/experimental/dsh-orchestration/tests/capabilities.gate.spec.ts) | Gate asserting orchestration factual columns match the catalogue |
| [`packages/llm/llm-pi-ai/src/index.ts`](packages/llm/llm-pi-ai/src/index.ts) | Re-exports the `UPB_GATEWAY_*` and catalogue symbols |
| `packages/bundle/base/cordis.patch.yml` | Mounts `llm-pi-ai` dormant + sets `agent-default-model` default |
| `$DSH_HOME/profiles/<name>/cordis.patch.yml` | **Deployment/user** provider profiles (written by the Models page; a chat route's `models` is refreshed by `gen-upb-profile`) |
| `$DSH_HOME/.credentials.yaml` | API keys resolved from `apiKeyEnv` |

---

## 5. The model-selection path (how a model is chosen at runtime)

```
base bundle: agent-default-model = { provider: deepseek-official, model: deepseek-flash }
   │  (mode bundles do not override; profile/home/--patch layers may override per row id)
   ▼  volatile Config refs, live .get()
ctx.agentDefaultModel.currentSelection()
   ▼  at Agent-creation time
AgentOptions { provider, model, reasoningEffort? }
```

- **Default model** is read via `ctx.agentDefaultModel.currentSelection()`; changes take effect on the next Agent creation.
- **Switching models in the composer** calls remote `session.selectModel`, which applies the selection and persists it as the new default via `saveSelection()`.
- **Subtask/subagent model routing** is a separate opt-in (`subagent-model-selection-settings`).

---

## 6. Modification guide — how to add, change, or remove a gateway model

### A. Change a factual gateway fact (the ONLY place for facts)
Edit the canonical catalogue **`packages/llm/llm-pi-ai/src/upb-gateway-catalog.ts`**. Every consumer (shipped route, orchestration routing facts, reference doc) follows; the tests assert:
- `[upb-gateway-catalog.spec.ts]` — ids unique/non-empty, all entries name their source, alias/router targets resolve, `UPB_CHAT_MODELS` + `UPB_REFERENCE_ONLY` partition the catalogue, chat-executable entries are chat-interface models.
- `[upb-gateway.spec.ts]` — `UPB_GATEWAY_MODELS` equals `UPB_CHAT_ROUTE_MODELS` (the shipped chat set: the chat-executable subset plus the 2 chat aliases, incl. the 4 Claude direct models and `(Test)`); context/output ceilings, the conservative RPM policy, pricing/free flags, and the `(Test)` listings are asserted shipped and callable.
- `[capabilities.gate.spec.ts]` — orchestration factual columns equal the catalogue; a drift fails CI.

To add a model with the **same endpoint interface**, add an entry to `UPB_GATEWAY_CATALOG` with `mode: 'chat'`, `apiInterface: 'chat'`, `maxInputTokens`/`maxOutputTokens`, `tpm`/`rpm`, badge-based vision, and `compatStatus: 'chat-executable'`; it appears in `UPB_CHAT_MODELS` and, through `UPB_CHAT_ROUTE_MODELS`, in `UPB_GATEWAY_MODELS` automatically (including `(Test)` chat listings). To add it to the orchestration pool you must also (a) add it to `orchestration-profile/cordis.patch.yml` `pool` and the live profile, and (b) add a curated row to `PADERBORN_CATALOG`, or the new completeness gate in `capabilities.gate.spec.ts` fails. A non-chat entry (embedding/image/Responses/router/Responses-alias) gets `compatStatus: 'chat-unsupported'` + `compatReason` and stays in `UPB_REFERENCE_ONLY` — no execution system is added for it (proportionate scope).

### B. Change the Orchestration route (`uni-paderborn`) — preferences only
- **Pool membership / compaction:** edit the `orchestration` `pool:` and `compaction-basic.modelPolicies` in [`orchestration-profile/cordis.patch.yml`](packages/experimental/orchestration-profile/cordis.patch.yml).
- **Routing preferences:** edit `domains`/`health`/`suggested`/`modalities`-extras in `PADERBORN_CATALOG`. Do **not** change the factual columns there — change the catalogue and let the gate confirm equality.

### C. Change a *deployment's* live routes (no code change)
On a running installation, edit `$DSH_HOME/profiles/<name>/cordis.patch.yml` under `llm-pi-ai.providers.<route>` (the web Models page does this) or `credentials` for the key.

**Refreshing a deployment's chat route from the catalogue.** A deployment that spells out `models` for its route masks the packaged catalogue, so a catalogue change does not reach its pickers until that list is refreshed. [`packages/llm/llm-pi-ai/scripts/gen-upb-profile.ts`](packages/llm/llm-pi-ai/scripts/gen-upb-profile.ts) does that from the shipped chat set (`UPB_GATEWAY_MODELS`, itself derived from the catalogue):

- `pnpm gen-upb-profile` writes the default `$DSH_HOME/profiles/web/cordis.patch.yml`; `--profile <path>` targets another patch and `--route <key>` another provider route (default `uni-paderborn`).
- `pnpm verify-upb-profile` is the freshness check (exit 1 when the route is stale) and `--dry-run` reports without writing.
- It replaces only `config.providers.<route>.models`, preserving the provider's deployment fields (`displayName`, `apiKeyEnv`, `api`, `baseURL`, `rateLimitOutputTokens`, `retryPolicy`), every other patch row, and every other provider route.
- The catalogue owns the model facts (`id`, `name`, `contextWindow`, `maxTokens`, `rpm`, `tpm`, `free`, `input`). Any **other** per-model key already on an entry of the same id is deployment-owned and is carried over verbatim — notably `reasoningEfforts`. Dropping it is not cosmetic: with no declared levels a model rejects the reasoning effort a session already stored (`UNSUPPORTED_REASONING_EFFORT`).
- A synced `maxTokens` is the gateway-admissible request cap per model (`min(published max output, floor(tpm / maxParallel))` — 50,000 for the free 500k-TPM models, 128,000 for the Claude models and Anthropic alias), not the published output maximum, so the sync also corrects a stale larger value. The provider block keeps its own `rateLimitOutputTokens`; a deployment on this gateway should set it to `128,000` (the largest per-model share) so the local ledger reserves what the gateway charges. It is not part of the generated list because it is a route field, not a model field; the adapter clamps each request to its own model cap.

Because it rewrites a live profile outside the repository, this generator is a deliberate operator action, not a CI artifact gate; its derivation and patch-editing behavior is pinned by [`tests/gen-upb-profile.spec.ts`](packages/llm/llm-pi-ai/tests/gen-upb-profile.spec.ts).

### D. Consistency checklist for any change
1. Change the factual value **once** in `upb-gateway-catalog.ts`.
2. Update the mirror in [`paderborn-ai-gateway-models.md`](paderborn-ai-gateway-models.md) and the catalogue snapshot date.
3. If it is an orchestration pool model, keep `orchestration-profile/cordis.patch.yml` membership and `capabilities.ts` `domains`/`suggested` accurate (the factual columns follow automatically).
4. Run `upb-gateway-catalog.spec.ts`, `upb-gateway.spec.ts`, and `capabilities.gate.spec.ts`.
5. A deployment that overrides `models` for a route masks the packaged catalogue; document the shipped catalogue for such routes as overridden.

---

## 7. Key caveats for future editors

- **One source of facts, two route keys.** `upb-ai-gateway` and `uni-paderborn` share factual data through the canonical catalogue; they keep separate routing/selection preferences.
- **Context is a chosen capacity, not a verified combined window.** The gateway publishes input and output maxima separately; no combined request+response window exists. `contextWindow` carries the input maximum under a documented local policy; the published output maximum is the model's capability, while the shipped `maxTokens` is the gateway's per-minute token share and never the maximum itself.
- **A request's declared output is a budget reservation.** This gateway meters `max_tokens` against its 500,000-token minute per key and model, so declaring the published output maximum caused HTTP 429 storms that blocked new sessions. The shipped route and the deployment sync cap each request at `min(published max output, floor(tpm / maxParallel))` (50,000 for the free 500k-TPM models, 128,000 for the Claude models and Anthropic alias) and the route sets `rateLimitOutputTokens` to `128,000` (the largest share; the adapter clamps per model); raise the route scalar plus a model's cap together if a deployment needs longer single responses, accepting fewer concurrent requests.
- **Range and unknown quotas are explicit.** A two-element RPM/TPM array is a range pinned to the conservative lower bound for pacing; the shipped chat aliases publish their own quotas and are paced like any chat model, while the Responses routers/aliases (not shipped) have no separately published quotas.
- **Test-only chat models ship but stay marked.** The three `(Test)` chat listings are part of `UPB_GATEWAY_MODELS`, the orchestration pool, and `PADERBORN_CATALOG` (they appear in pickers and are callable, per explicit product request), but none is a default and their "test use only; continued availability is not guaranteed" source restriction is preserved in the catalogue and surfaced in the `(Test)` names.
- **Catalog is advisory.** Removing a model from a catalogue does not stop a request that names it; it only removes it from pickers/metadata.
- **`rpm`/`tpm` pacing uses estimates**; provider-reported usage reconciles them. Two routes to one gateway model get separate ledgers unless both set the same `rateLimitBudgetKey`.
- **No runtime scraping.** DSH never fetches the gateway's public catalogue at startup; the catalogue is a dated, Git-tracked snapshot refreshed manually (see §8).

---

## 8. Refresh procedure and source register

**Refresh.** The catalogue is a dated snapshot (currently 2026-11-19). To bring DSH current with the gateway:
1. Fetch `https://ai-gateway.uni-paderborn.de/api_hub/api/public-models/` (and review `.../api_hub/models-info`).
2. Diff it against `UPB_GATEWAY_CATALOG`, update changed entries, bump `UPB_GATEWAY_SNAPSHOT` and `upb-gateway-catalog.spec.ts`'s expectation if needed, and mirror the changes into [`paderborn-ai-gateway-models.md`](paderborn-ai-gateway-models.md).
3. Run the three gate specs. DSH startup is unaffected while the snapshot is current; manual review catches provider/health/reasoning drift the gate cannot (badges vs prose, health status).

**Source register (discrepancies preserved in the catalogue, not "fixed").** The catalogue keeps, per entry, the gateway's own contradictions verbatim: the HS-DE basemodel alias and Anthropic alias target-fragments that no longer match the listed rows; DeepSeek V4 Flash 0731's 304B-table vs 284B prose; OpenAI GPT OSS's kiconnect-table vs GWDG/KISSKI prose; Qwen 3 Instruct's card-link to the Thinking variant and incomplete phrase; Qwen 3 Instruct 30B-A3B vs prose 30.5B/3.3B; GPT Image 1.5's prose claims about GPT Image 2 and its `openai-bilder` selector; the mixed router's "two free models" prose vs three table targets; Qwen 3 Omni's audio/video prose vs Text+Vision badges; the no-think variants keeping Reasoning badges; Qwen 3 Embedding 8B's 2.56k output-token vs 32–4096 vector-dimension measures; E5 Mistral's English-only training with a German example; and "Keine" meaning no settings listed, not no supported parameters. These are recorded facts, not aspects DSH should silently resolve.
