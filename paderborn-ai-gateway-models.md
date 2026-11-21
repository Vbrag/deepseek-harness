# Paderborn AI-Gateway model reference

> **Superseded snapshot.** This document is the **30 October 2026** snapshot of the gateway's public catalog (35 entries) and is kept for its detailed human-readable tables, model→endpoint mappings, and usage examples. The **operative** gateway facts now live in the canonical, Git-tracked catalogue **`packages/llm/llm-pi-ai/src/upb-gateway-catalog.ts`** (snapshot **19 November 2026**, all 41 identifiers), which the DSH shipped route and orchestration routing read from. Update the catalogue first, then mirror factual changes into this reference. See [`paderborn-ai-gateway-dsh-context.md`](paderborn-ai-gateway-dsh-context.md) for the wiring and refresh procedure. Where the two snapshots differ, the 19 November catalogue wins; e.g. the Claude models below are marked "Upcoming" in this 30 October snapshot but are listed as available paid entries in the 19 November catalogue.
>
> **Output maxima are capabilities, not request sizes.** The gateway meters a request's declared `max_tokens` against its per-minute token budget (500,000 tokens per key and model), so the DSH shipped route asks for at most `min(published max output, floor(tpm / maxParallel))` per model — 50,000 for the free 500k-TPM models, 128,000 for the Claude models and Anthropic alias (2M TPM) — even where the table below publishes a larger output maximum. The published maximum stays recorded in the canonical catalogue.

Snapshot: **30 October 2026 (Europe/Berlin)**. Scope: all **35 public catalog entries** returned by the data endpoint used by the requested page: 2 base aliases, 24 individual text/multimodal/image entries, 4 embedding models, and 5 routers.

Source page: [Model information](<https://ai-gateway.uni-paderborn.de/api_hub/models-info>). Source data: [Public model catalog](<https://ai-gateway.uni-paderborn.de/api_hub/api/public-models/>). Usage templates were read from the page’s [application bundle](<https://ai-gateway.uni-paderborn.de/api_hub/static/assets/index-GDlPlZI-.js>).

The page is a JavaScript application; its initial HTML does not contain the model tables. This reference uses the same public data and example-template logic as the page. Model claims are reported from that catalog, not independently benchmarked or verified against vendor documentation. Suggested applications are interpretations of the listed capabilities, not measured rankings. No authenticated model calls were made.

## Contents

- [How to read the tables](#how-to-read-the-tables)
- [Model comparison](#model-comparison)
- [Prices, token limits, and availability](#prices-token-limits-and-availability)
- [Reasoning, settings, and model details](#reasoning-settings-and-model-details)
- [Router destinations](#router-destinations)
- [How to call every model](#how-to-call-every-model)
- [Python usage examples](#python-usage-examples)
- [Catalog descriptions and source links](#catalog-descriptions-and-source-links)
- [Important caveats and inconsistencies](#important-caveats-and-inconsistencies)
- [Further gateway documentation](#further-gateway-documentation)

## How to read the tables

| Term | Meaning |
| --- | --- |
| API model ID | Exact case-sensitive value for the request’s model parameter, as used by the page’s examples. Keep the dot-separated gateway ID; do not replace it with the slash-separated backend ID. |
| chat / responses / embedding | Use Chat Completions / Responses / Embeddings respectively. The gateway supports multiple modes; do not send every entry to the same API method. |
| Image input | Understanding images, not generating images. Only the image_generation entry is explicitly listed for image output. |
| Tools / web search | Listed capability, not an automatic action. Tools, permissions, payloads, and an execution loop may be needed. The basic examples below do not enable tools or browsing. |
| No explicit feature flags | The catalog has an empty features array; it does not prove the underlying model lacks every advanced capability. |
| Reasoning | Model thinking support or settings. No-think variants request direct answers even when inherited feature flags still say reasoning. |
| HS* | Region label used for German higher-education infrastructure in this catalog; preserved as supplied. It is not a legal approval for sensitive data. |
| B / A | Billions of total parameters / billions of activated parameters for MoE entries. Values are catalog values and sometimes rounded or inconsistent. |
| TPM / RPM | Tokens per minute / requests per minute. Arrays retain provider order; they must not be added together as a guaranteed quota. |
| Not specified | Missing or null data, not unlimited capacity or confirmed availability. |
| Upcoming | The catalog explicitly labels the entry Upcoming. Listing does not establish that it can already be called. |

## Model comparison

### Base-model aliases

| Model | Exact API model ID | API mode | Explicit capability flags | What it is good for / how to choose |
| --- | --- | --- | --- | --- |
| HS-DE: Basismodel | `hs-de.latest-basemodel` | `chat` | Image input; Reasoning; Tool/function calling | Free default alias for research, coding, and agent tasks; currently points to Qwen 3.8. The alias can change. |
| GPT-6 Luna (High Reasoning) | `openai.latest-basemodel` | `responses` | Image input; Web search; Reasoning; Tool/function calling | Low-cost default OpenAI alias for focused, high-volume tasks; currently Luna, labeled High Reasoning. The alias can change. |

### Individual text, multimodal, and image models

| Model | Exact API model ID | API mode | Explicit capability flags | What it is good for / how to choose |
| --- | --- | --- | --- | --- |
| Claude Opus 5.5 (Upcoming) | `anthropic.claude-opus-5-5` | `chat` | Image input; Reasoning; Tool/function calling | Long-running coding agents and knowledge work. Listed as Upcoming: do not assume access is enabled. |
| Claude Sonnet 5.5 (Upcoming) | `anthropic.claude-sonnet-5-5` | `chat` | Image input; Reasoning; Tool/function calling | Balanced speed and intelligence for general assistance and coding (suggested use). Listed as Upcoming. |
| Claude Haiku 5.5 (Upcoming) | `anthropic.claude-haiku-5-5` | `chat` | Image input; Reasoning; Tool/function calling | High-volume classification, routing, extraction, and subagents; latency-sensitive tasks. Listed as Upcoming. |
| GPT-6 Astra | `openai.gpt-6-astra` | `responses` | Image input; Web search; Reasoning; Tool/function calling | Most demanding end-to-end reasoning, coding, computer-use workflows, research, and document creation, according to the catalog. |
| GPT-6.1 Sol | `openai.gpt-6.1-sol` | `responses` | Image input; Web search; Reasoning; Tool/function calling | Complex coding and professional work at lower cost than Astra; compare quality on your own tasks. |
| GPT-6.1 Terra | `openai.gpt-6.1-terra` | `responses` | Image input; Web search; Reasoning; Tool/function calling | Visual work: match product photos to catalogs, interpret technical drawings, work with application screens; writing and editing. |
| GPT-6 Luna | `openai.gpt-6-luna` | `responses` | Image input; Web search; Reasoning; Tool/function calling | Focused, high-volume work where token cost matters; suggested uses include extraction, classification, and short transformations. |
| GPT Image 1.5 (Bildgenerierung/-bearbeitung) | `openai.gpt-image-1.5` | `image_generation` | Image input | Generate and edit images; not a text-chat model. Catalog description also discusses Image 2, but this entry is specifically Image 1.5. |
| Gemma 4 | `gwdg.gemma-4-31b-it` | `chat` | Image input; Tool/function calling | Free general assistance and image understanding, hosted by GWDG rather than Google. |
| DeepSeek V4 Flash 0731 | `gwdg.deepseek-v4-flash-0731` | `chat` | Reasoning; Tool/function calling | Free long-context text reasoning and general work; higher-effort reasoning. Catalog cautions that deepest knowledge and complex agents lag top models. |
| OpenAI GPT OSS | `hs-de.openai-gpt-oss-120b` | `chat` | No explicit feature flags | Free open-weight OpenAI-family text/reasoning tasks without sending requests to the proprietary OpenAI service; hosting information is inconsistent. |
| GLM 5.3 Flash | `gwdg.glm-5.3-flash` | `chat` | Tool/function calling | Free coding agents, multilingual programming, terminal tasks, tool use, and mathematical reasoning. Browser use needs application-supplied tools. |
| Qwen 3.8 | `hs-de.qwen3.8-27b` | `chat` | Image input; Reasoning; Tool/function calling | Free research, coding, reasoning, and large agent tasks; image input and video-input tag are listed. |
| Qwen 3.8 (Ohne Thinking) | `hs-de.qwen3.8-27b-no-think` | `chat` | Image input; Reasoning; Tool/function calling | Fast direct writing and simple tasks without explicit thinking iterations; image input and video-input tag are listed. |
| Qwen 3.6 | `gwdg.qwen3.6-35b-a3b` | `chat` | Image input; Reasoning; Tool/function calling | Efficient free coding and agent workflows with vision; snapshot marks this entry unhealthy. |
| Qwen 3.6 (Ohne Thinking) | `gwdg.qwen3.6-35b-a3b-no-think` | `chat` | Image input; Reasoning; Tool/function calling | Direct answers and quick text generation without thinking iterations; vision is listed. |
| Qwen 3.5 | `gwdg.qwen3.5-397b-a17b` | `chat` | Image input; Tool/function calling | Free challenging reasoning, coding, mathematics, general tasks, and image understanding. |
| Qwen 3.5 (Ohne Thinking) | `gwdg.qwen3.5-397b-a17b-no-think` | `chat` | Image input; Tool/function calling | Direct writing and simpler tasks using the Qwen 3.5 family without thinking iterations; vision is listed. |
| Qwen 3 Instruct | `gwdg.qwen3-30b-a3b-instruct-2507` | `chat` | No explicit feature flags | General multilingual instruction following, text understanding, coding, mathematics, and science. Explicit API feature flags are empty. |
| EuroLLM | `hs-de.eurollm-22b-instruct-2512` | `chat` | Tool/function calling | Multilingual instruction-following and chat across all 24 official EU languages; a useful candidate for EU-language text workflows. |
| Qwen 3 Coder Next | `gwdg.qwen3-coder-next` | `chat` | Tool/function calling | Free coding agents and CLI/IDE integrations; long code context and tool calling. |
| Qwen 3 Omni | `gwdg.qwen3-omni-30b-a3b-instruct` | `chat` | Image input | Multimodal understanding of text, images, audio, and video per description; 119 text languages and 19 speech-input languages. Gateway payload support needs checking. |
| Mistral Small 4 | `kiconnect.mistralai-mistral-small-4-119b-2603` | `chat` | Image input; Tool/function calling | Fast free general assistance and image/tool workflows (suggested use from flags and tags); European-developed model, hosted through kiconnect. |
| Llama 3.1 8B Instruct | `gwdg.meta-llama-3.1-8b-instruct` | `chat` | No explicit feature flags | Lightweight fast general conversation, straightforward questions, and basic assistance. |

### Automatic routers

| Model | Exact API model ID | API mode | Explicit capability flags | What it is good for / how to choose |
| --- | --- | --- | --- | --- |
| HS-DE: Complexity-Routing | `hs-de.complexity-router` | `responses` | No explicit feature flags | Automatically select suitable available models in German university computing centers according to request complexity. |
| HS-DE: MÖVE-Routing | `hs-de.moeve-router` | `responses` | No explicit feature flags | Automatic selection restricted to models evaluated highly by MÖVE for public-administration use; not a blanket compliance certification. |
| GWDG: Qwen-Complexity-Routing | `gwdg.qwen-complexity-router` | `chat` | No explicit feature flags | Automatic complexity-based selection within the Qwen family. |
| OpenAI: Cost-Complexity-Routing | `openai.complexity-router` | `responses` | No explicit feature flags | Automatic OpenAI model and reasoning-effort selection by complexity; paid downstream models despite zero router price fields. |
| Mixed: Cost-Complexity-Routing | `mixed.complexity-router` | `responses` | No explicit feature flags | Mix free university models for simpler work with paid OpenAI models for complex work; do not use when requests must stay within university infrastructure. |

### Embedding models — API only

| Model | Exact API model ID | API mode | Explicit capability flags | What it is good for / how to choose |
| --- | --- | --- | --- | --- |
| Qwen 3 Embedding 8B | `kiconnect.qwen3-embedding-8b` | `embedding` | No explicit feature flags | Multilingual semantic search, retrieval/RAG, clustering, and similarity (suggested applications); over 100 languages, 32–4,096 dimensions, 36 layers. |
| Qwen 3 Embedding 4B | `gwdg.qwen3-embedding-4b` | `embedding` | No explicit feature flags | Multilingual semantic search, retrieval/RAG, clustering, and similarity (suggested applications); over 100 languages, 32–2,560 dimensions, 36 layers. |
| E5 Mistral Instruct | `hs-de.e5-mistral-7b-instruct` | `embedding` | No explicit feature flags | English semantic search and retrieval/RAG (suggested applications); catalog says English-only training, 4,096 dimensions, 32 layers. |
| Multilingual E5 Large Instruct | `gwdg.multilingual-e5-large-instruct` | `embedding` | No explicit feature flags | Multilingual short-text search, similarity, and retrieval/RAG (suggested applications); 94 languages, 1,024 dimensions, 24 layers. |

## Prices, token limits, and availability

Prices are the catalog’s per-token values multiplied by 1,000,000, expressed as USD per million tokens. Router zeroes are configuration values, **not a promise of free downstream inference**. Image token rates are not a complete per-image quote. Maximum input and output are separate reported fields, not a guarantee that both fit simultaneously. Embedding output fields are preserved literally; they are not chat completion lengths and may differ from vector dimensions. Health is a momentary public status, not a service-level guarantee.

| API model ID | Input $/1M | Output $/1M | Max input tokens | Max output field | Provider(s) | Region(s), raw | TPM, provider order | RPM, provider order | Max parallel | Health / status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `hs-de.latest-basemodel` | 0 | 0 | 262,000 | 262,000 | kiconnect, gwdg | `["HS*","HS*"]` | `[500000,500000]` | `[100,10]` | 10 | Not specified |
| `openai.latest-basemodel` | 0.1 | 0.5 | 922,000 | 128,000 | openai | `["USA"]` | `[2000000]` | `[100]` | 10 | Not specified |
| `anthropic.claude-opus-5-5` | 4 | 20 | 1,000,000 | 128,000 | anthropic | `[["USA"]]` | `[null]` | `[null]` | 10 | Upcoming; health not specified |
| `anthropic.claude-sonnet-5-5` | 2 | 10 | 1,000,000 | 128,000 | anthropic | `[["USA"]]` | `[null]` | `[null]` | 10 | Upcoming; health not specified |
| `anthropic.claude-haiku-5-5` | 0.1 | 0.5 | 1,000,000 | 128,000 | anthropic | `[["USA"]]` | `[null]` | `[null]` | 10 | Upcoming; health not specified |
| `openai.gpt-6-astra` | 10 | 50 | 922,000 | 128,000 | openai | `["USA"]` | `[2000000]` | `[100]` | 10 | Not specified |
| `openai.gpt-6.1-sol` | 2 | 10 | 922,000 | 128,000 | openai | `["USA"]` | `[2000000]` | `[100]` | 10 | Not specified |
| `openai.gpt-6.1-terra` | 1 | 5 | 922,000 | 128,000 | openai | `["USA"]` | `[2000000]` | `[100]` | 10 | Not specified |
| `openai.gpt-6-luna` | 0.1 | 0.5 | 922,000 | 128,000 | openai | `["USA"]` | `[2000000]` | `[100]` | 10 | Not specified |
| `openai.gpt-image-1.5` | 5 | 10 | Not specified | Not specified | openai | `["USA"]` | `[2000000]` | `[100]` | 10 | Not specified |
| `gwdg.gemma-4-31b-it` | 0 | 0 | 256,000 | 256,000 | gwdg | `["HS*"]` | `[500000]` | `[10]` | 10 | Not specified |
| `gwdg.deepseek-v4-flash-0731` | 0 | 0 | 1,000,000 | 384,000 | gwdg | `["HS*"]` | `[500000]` | `[10]` | 10 | Not specified |
| `hs-de.openai-gpt-oss-120b` | 0 | 0 | 128,000 | 128,000 | kiconnect | `["HS*"]` | `[500000]` | `[100]` | 10 | Not specified |
| `gwdg.glm-5.3-flash` | 0 | 0 | 200,000 | 200,000 | gwdg | `["HS*"]` | `[500000]` | `[10]` | 10 | Not specified |
| `hs-de.qwen3.8-27b` | 0 | 0 | 262,000 | 262,000 | kiconnect, gwdg | `["HS*","HS*"]` | `[500000,500000]` | `[100,10]` | 10 | Not specified |
| `hs-de.qwen3.8-27b-no-think` | 0 | 0 | 262,000 | 262,000 | kiconnect, gwdg | `["HS*","HS*"]` | `[500000,500000]` | `[100,10]` | 10 | Not specified |
| `gwdg.qwen3.6-35b-a3b` | 0 | 0 | 262,000 | 262,000 | gwdg | `["HS*"]` | `[500000]` | `[10]` | 10 | unhealthy |
| `gwdg.qwen3.6-35b-a3b-no-think` | 0 | 0 | 262,000 | 262,000 | gwdg | `["HS*"]` | `[500000]` | `[10]` | 10 | healthy |
| `gwdg.qwen3.5-397b-a17b` | 0 | 0 | 256,000 | 256,000 | gwdg | `["HS*"]` | `[500000]` | `[10]` | 10 | Not specified |
| `gwdg.qwen3.5-397b-a17b-no-think` | 0 | 0 | 256,000 | 256,000 | gwdg | `["HS*"]` | `[500000]` | `[10]` | 10 | Not specified |
| `gwdg.qwen3-30b-a3b-instruct-2507` | 0 | 0 | 256,000 | 256,000 | gwdg | `["HS*"]` | `[500000]` | `[10]` | 10 | healthy |
| `hs-de.eurollm-22b-instruct-2512` | 0 | 0 | 32,000 | 32,000 | gwdg | `["HS*"]` | `[500000]` | `[10]` | 10 | Not specified |
| `gwdg.qwen3-coder-next` | 0 | 0 | 256,000 | 256,000 | gwdg | `["HS*"]` | `[500000]` | `[10]` | 10 | Not specified |
| `gwdg.qwen3-omni-30b-a3b-instruct` | 0 | 0 | 256,000 | 256,000 | gwdg | `["HS*"]` | `[500000]` | `[10]` | 10 | healthy |
| `kiconnect.mistralai-mistral-small-4-119b-2603` | 0 | 0 | 256,000 | 256,000 | kiconnect | `["HS*"]` | `[500000]` | `[100]` | 10 | healthy |
| `gwdg.meta-llama-3.1-8b-instruct` | 0 | 0 | 128,000 | 128,000 | gwdg | `["HS*"]` | `[500000]` | `[10]` | 10 | healthy |
| `hs-de.complexity-router` | 0 | 0 | Not specified | Not specified | hs-de | `[[]]` | `[500000]` | `[100]` | 10 | Not specified |
| `hs-de.moeve-router` | 0 | 0 | Not specified | Not specified | hs-de | `[[]]` | `[500000]` | `[100]` | 10 | Not specified |
| `gwdg.qwen-complexity-router` | 0 | 0 | Not specified | Not specified | gwdg | `[["HS*"]]` | `[500000]` | `[10]` | 10 | Not specified |
| `openai.complexity-router` | 0 | 0 | Not specified | Not specified | openai | `[["USA"]]` | `[2000000]` | `[100]` | 10 | Not specified |
| `mixed.complexity-router` | 0 | 0 | Not specified | Not specified | mixed | `[[]]` | `[2000000]` | `[100]` | 10 | Not specified |
| `kiconnect.qwen3-embedding-8b` | 0 | 0 | 32,000 | 2,560 | kiconnect | `[["HS*"]]` | `[500000]` | `[100]` | 10 | Not specified |
| `gwdg.qwen3-embedding-4b` | 0 | 0 | 32,000 | 2,560 | gwdg | `[["HS*"]]` | `[500000]` | `[10]` | 10 | healthy |
| `hs-de.e5-mistral-7b-instruct` | 0 | 0 | 4,096 | 4,096 | kiconnect, gwdg | `[["HS*"]]` | `[500000,500000]` | `[100,100]` | 10 | Not specified |
| `gwdg.multilingual-e5-large-instruct` | 0 | 0 | 1,024 | 1,024 | gwdg | `[["HS*"]]` | `[500000]` | `[10]` | 10 | healthy |

## Reasoning, settings, and model details

Reasoning levels and defaults below come from structured metadata. Descriptions sometimes disagree; see the caveats. Boolean true/false values are recorded literally and are **not** instructions to pass a boolean as reasoning_effort. Config values are published gateway/model settings, not mandatory arguments to copy into every request. An empty config object means no values were published. Backend identifiers and UI-only aliases are informational, not replacements for API model IDs. Knowledge dates are the source’s labels; some are release dates rather than actual training cutoffs.

| API model ID | Parameters | Knowledge / release label, verbatim | Reasoning default / supported metadata values | Published config | Tags, verbatim | Backend identifier | Other metadata |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `hs-de.latest-basemodel` | 27B | Anfang 2026 | Default: `"high"`; supported: `["low","medium","high","xhigh"]` | `{"temperature":1,"top_p":0.95}` | None published | `gwdg/qwen3.8-27b` | Base model: Qwen 3.8; [Icon](<https://ai-gateway.uni-paderborn.de/static/provider_icons/qwen.png>) |
| `openai.latest-basemodel` | Not specified | Mai 2026 | Not specified | `{}` | None published | `openai/gpt-6-luna` | [Icon](<https://ai-gateway.uni-paderborn.de/static/provider_icons/openai.svg>) |
| `anthropic.claude-opus-5-5` | Not specified | Juni 2026 | Not specified | `{}` | None published | `azure_ai/claude-opus-5-5` | Metadata provider: anthropic; [Icon](<https://ai-gateway.uni-paderborn.de/static/provider_icons/anthrophic.webp>) |
| `anthropic.claude-sonnet-5-5` | Not specified | Juni 2026 | Not specified | `{}` | None published | `azure_ai/claude-sonnet-5-5` | Metadata provider: anthropic; [Icon](<https://ai-gateway.uni-paderborn.de/static/provider_icons/anthrophic.webp>) |
| `anthropic.claude-haiku-5-5` | Not specified | Juni 2026 | Not specified | `{}` | None published | `azure_ai/claude-haiku-5-5` | Metadata provider: anthropic; [Icon](<https://ai-gateway.uni-paderborn.de/static/provider_icons/anthrophic.webp>) |
| `openai.gpt-6-astra` | Not specified | April 2026 | Default: `"medium"`; supported: `["none","low","medium","high"]` | `{}` | `agentic`, `reasoning` | `openai/gpt-6-astra` | [Icon](<https://ai-gateway.uni-paderborn.de/static/provider_icons/openai.svg>) |
| `openai.gpt-6.1-sol` | Not specified | April 2026 | Default: `"medium"`; supported: `["none","low","medium","high"]` | `{}` | `agentic`, `reasoning` | `openai/gpt-6.1-sol` | [Icon](<https://ai-gateway.uni-paderborn.de/static/provider_icons/openai.svg>) |
| `openai.gpt-6.1-terra` | Not specified | Juni 2026 | Default: `"medium"`; supported: `["none","low","medium","high","xhigh","max"]` | `{}` | `agentic`, `reasoning` | `openai/gpt-6.1-terra` | [Icon](<https://ai-gateway.uni-paderborn.de/static/provider_icons/openai.svg>) |
| `openai.gpt-6-luna` | Not specified | Mai 2026 | Default: `"medium"`; supported: `["none","low","medium","high"]` | `{}` | `agentic`, `reasoning` | `openai/gpt-6-luna` | [Icon](<https://ai-gateway.uni-paderborn.de/static/provider_icons/openai.svg>) |
| `openai.gpt-image-1.5` | Not specified | nicht angegeben | Not specified | `{}` | `vision`, `image-output` | `openai/gpt-image-1.5` | AI-Chat UI alias: `openai-bilder`; [Icon](<https://ai-gateway.uni-paderborn.de/static/provider_icons/openai.svg>) |
| `gwdg.gemma-4-31b-it` | 31B | Ende 2024/Anfang 2025 | Not specified | `{}` | `free`, `allrounder`, `vision` | `gwdg/gemma-4-31b-it` | [Icon](<https://ai-gateway.uni-paderborn.de/static/provider_icons/google.png>) |
| `gwdg.deepseek-v4-flash-0731` | 304B | Februar 2026 | Default: `"none"`; supported: `["none","high","max"]` | `{"temperature":1,"top_p":1}` | `free`, `allrounder` | `gwdg/deepseek-v4-flash-0731` | [Icon](<https://ai-gateway.uni-paderborn.de/static/provider_icons/deepseek.jpg>) |
| `hs-de.openai-gpt-oss-120b` | 120B | Juni 2024 | Default: `"medium"`; supported: `["low","medium","high"]` | `{}` | `free`, `reasoning` | `kiconnect/openai-gpt-oss-120b` | [Icon](<https://ai-gateway.uni-paderborn.de/static/provider_icons/openai.svg>) |
| `gwdg.glm-5.3-flash` | 320B A18B | August 2026 (veröffentlicht) | Default: `"high"`; supported: `["low","high","max"]` | `{"temperature":1,"top_p":0.95}` | `free`, `agentic`, `coding` | `gwdg/glm-5.3-flash` | [Icon](<https://ai-gateway.uni-paderborn.de/static/provider_icons/zai.png>) |
| `hs-de.qwen3.8-27b` | 27B | Anfang 2026 | Default: `"high"`; supported: `["low","medium","high","xhigh"]` | `{"temperature":1,"top_p":0.95}` | `free`, `reasoning`, `vision`, `video-input`, `agentic` | `gwdg/qwen3.8-27b` | [Icon](<https://ai-gateway.uni-paderborn.de/static/provider_icons/qwen.png>) |
| `hs-de.qwen3.8-27b-no-think` | 27B | August 2026 (veröffentlicht) | Not specified | `{"temperature":0.7,"top_p":0.8}` | `free`, `allrounder`, `schnell`, `vision`, `video-input`, `agentic` | `gwdg/qwen3.8-27b` | [Icon](<https://ai-gateway.uni-paderborn.de/static/provider_icons/qwen.png>) |
| `gwdg.qwen3.6-35b-a3b` | 35B A3B | August 2026 (veröffentlicht) | Default: `true`; supported: `[true,false]` | `{"temperature":1,"top_p":0.95}` | `free`, `reasoning`, `vision`, `schnell` | `gwdg/qwen3.6-35b-a3b` | [Icon](<https://ai-gateway.uni-paderborn.de/static/provider_icons/qwen.png>) |
| `gwdg.qwen3.6-35b-a3b-no-think` | 35B A3B | Anfang 2026 | Not specified | `{"temperature":1,"top_p":0.95}` | `free`, `schnell`, `vision` | `gwdg/qwen3.6-35b-a3b` | [Icon](<https://ai-gateway.uni-paderborn.de/static/provider_icons/qwen.png>) |
| `gwdg.qwen3.5-397b-a17b` | 397B A17B | April 2025 | Default: `true`; supported: `[true,false]` | `{"temperature":0.6,"top_p":0.95}` | `free`, `reasoning`, `vision` | `gwdg/qwen3.5-397b-a17b` | [Icon](<https://ai-gateway.uni-paderborn.de/static/provider_icons/qwen.png>) |
| `gwdg.qwen3.5-397b-a17b-no-think` | 397B A17B | April 2025 | Not specified | `{"temperature":0.6,"top_p":0.95}` | `free`, `schnell`, `vision` | `gwdg/qwen3.5-397b-a17b` | [Icon](<https://ai-gateway.uni-paderborn.de/static/provider_icons/qwen.png>) |
| `gwdg.qwen3-30b-a3b-instruct-2507` | 30B A3B | April 2025 | Not specified | `{}` | `free`, `allrounder` | `gwdg/qwen3-30b-a3b-instruct-2507` | [Icon](<https://ai-gateway.uni-paderborn.de/static/provider_icons/qwen.png>) |
| `hs-de.eurollm-22b-instruct-2512` | 22B | Projektstart 10.2022 - 10.2025 (veröffentlicht) | Not specified | `{}` | `free`, `mulilingual`, `european`, `instruct` | `gwdg/eurollm-22b-instruct-2512` | [Icon](<https://ai-gateway.uni-paderborn.de/static/provider_icons/utter.png>) |
| `gwdg.qwen3-coder-next` | 80B A3B | Februar 2026 | Default: `"medium"`; supported: `["low","medium","xhigh"]` | `{}` | `free`, `coding` | `gwdg/qwen3-coder-next` | [Icon](<https://ai-gateway.uni-paderborn.de/static/provider_icons/qwen.png>) |
| `gwdg.qwen3-omni-30b-a3b-instruct` | 30B A3B | September 2025 (veröffentlicht) | Not specified | `{}` | `free`, `audio-input`, `vision` | `gwdg/qwen3-omni-30b-a3b-instruct` | [Icon](<https://ai-gateway.uni-paderborn.de/static/provider_icons/qwen.png>) |
| `kiconnect.mistralai-mistral-small-4-119b-2603` | 119B A6B | März 2026 | Not specified | `{}` | `free`, `schnell` | `kiconnect/mistralai-mistral-small-4-119b-2603` | [Icon](<https://ai-gateway.uni-paderborn.de/static/provider_icons/mistralai.png>) |
| `gwdg.meta-llama-3.1-8b-instruct` | 8B | Dezember 2023 | Not specified | `{}` | `free`, `schnell` | `gwdg/meta-llama-3.1-8b-instruct` | [Icon](<https://ai-gateway.uni-paderborn.de/static/provider_icons/meta.png>) |
| `hs-de.complexity-router` | Not specified | Not specified | Not specified | `{}` | `auto-routing` | `auto_router/complexity_router` | Metadata provider: hs-de |
| `hs-de.moeve-router` | Not specified | Not specified | Not specified | `{}` | `auto-routing` | `auto_router/complexity_router` | Metadata provider: hs-de |
| `gwdg.qwen-complexity-router` | Not specified | Not specified | Not specified | `{}` | `auto-routing` | `auto_router/complexity_router` | Metadata provider: gwdg; [Icon](<https://ai-gateway.uni-paderborn.de/static/provider_icons/qwen.png>) |
| `openai.complexity-router` | Not specified | Not specified | Not specified | `{}` | `auto-routing` | `auto_router/complexity_router` | Metadata provider: openai; [Icon](<https://ai-gateway.uni-paderborn.de/static/provider_icons/openai.svg>) |
| `mixed.complexity-router` | Not specified | Not specified | Not specified | `{}` | `auto-routing` | `auto_router/complexity_router` | Metadata provider: mixed |
| `kiconnect.qwen3-embedding-8b` | 8B | Juni 2025 (veröffentlicht) | Not specified | `{}` | `free`, `embedding` | `openai/qwen-qwen3-embedding-8b` | Metadata provider: kiconnect; [Icon](<https://ai-gateway.uni-paderborn.de/static/provider_icons/qwen.png>) |
| `gwdg.qwen3-embedding-4b` | 4B | Juni 2025 (veröffentlicht) | Not specified | `{}` | `free`, `embedding` | `openai/qwen3-embedding-4b` | Metadata provider: gwdg; [Icon](<https://ai-gateway.uni-paderborn.de/static/provider_icons/qwen.png>) |
| `hs-de.e5-mistral-7b-instruct` | 7B | Januar 2024 (veröffentlicht) | Not specified | `{}` | `free`, `embedding` | `openai/e5-mistral-7b-instruct` | Metadata provider: kiconnect; [Icon](<https://ai-gateway.uni-paderborn.de/static/provider_icons/mistralai.png>) |
| `gwdg.multilingual-e5-large-instruct` | 0.6B | Mitte 2023 (veröffentlicht) | Not specified | `{}` | `free`, `embedding` | `openai/multilingual-e5-large-instruct` | Metadata provider: gwdg |

## Router destinations

These are the published routing maps, not a guarantee of fallback order, equal traffic shares, or that internal destination IDs are directly callable. Call the router ID in the first column. Features and context limits can vary with its selected destination.

| Router API ID | SIMPLE | MEDIUM | COMPLEX | REASONING |
| --- | --- | --- | --- | --- |
| `hs-de.complexity-router` | `gwdg.meta-llama-3.1-8b-instruct`<br>`gwdg.qwen3-30b-a3b-instruct-2507`<br>`kiconnect.mistralai-mistral-small-4-119b-2603` | `hs-de.openai-gpt-oss-120b` | `gwdg.gemma-4-31b-it` | `hs-de.qwen3.8-27b`<br>`gwdg.glm-5.3-flash` |
| `hs-de.moeve-router` | `kiconnect.mistralai-mistral-small-4-119b-2603` | `gwdg.gemma-4-31b-it`<br>`hs-de.openai-gpt-oss-120b`<br>`gwdg.qwen3.6-35b-a3b-no-think` | `gwdg.gemma-4-31b-it`<br>`hs-de.openai-gpt-oss-120b`<br>`gwdg.qwen3.6-35b-a3b` | `gwdg.gemma-4-31b-it`<br>`hs-de.qwen3.8-27b` |
| `gwdg.qwen-complexity-router` | `gwdg.qwen3-30b-a3b-instruct-2507` | `gwdg.qwen3.5-397b-a17b-no-think` | `gwdg.qwen3.5-397b-a17b` | `hs-de.qwen3.8-27b` |
| `openai.complexity-router` | `openai.gpt-6-luna-medium` | `openai.gpt-6-luna-high` | `openai.gpt-6-luna-max` | `openai.gpt-6.1-sol-xhigh`<br>`openai.gpt-6.1-sol-max` |
| `mixed.complexity-router` | `hs-de.openai-gpt-oss-120b` | `hs-de.qwen3.8-27b`<br>`gwdg.gemma-4-31b-it` | `openai.gpt-6-luna-medium` | `openai.gpt-6-luna-max` |

## How to call every model

Run the shared Python setup below first. Each row is a complete SDK expression with the exact model ID. Chat, Responses, and Embeddings follow the page’s API-example template modes; prompts are shortened here. The image call is an **inferred OpenAI SDK example**, because the page does not offer an API-example button for image_generation. Neither these expressions nor optional parameters were tested with an API key.

| API model ID | Python call using the shared client |
| --- | --- |
| `hs-de.latest-basemodel` | `client.chat.completions.create(model="hs-de.latest-basemodel", messages=[{"role":"user","content":"Hello"}])` |
| `openai.latest-basemodel` | `client.responses.create(model="openai.latest-basemodel", input="Hello")` |
| `anthropic.claude-opus-5-5` | `client.chat.completions.create(model="anthropic.claude-opus-5-5", messages=[{"role":"user","content":"Hello"}])` |
| `anthropic.claude-sonnet-5-5` | `client.chat.completions.create(model="anthropic.claude-sonnet-5-5", messages=[{"role":"user","content":"Hello"}])` |
| `anthropic.claude-haiku-5-5` | `client.chat.completions.create(model="anthropic.claude-haiku-5-5", messages=[{"role":"user","content":"Hello"}])` |
| `openai.gpt-6-astra` | `client.responses.create(model="openai.gpt-6-astra", input="Hello")` |
| `openai.gpt-6.1-sol` | `client.responses.create(model="openai.gpt-6.1-sol", input="Hello")` |
| `openai.gpt-6.1-terra` | `client.responses.create(model="openai.gpt-6.1-terra", input="Hello")` |
| `openai.gpt-6-luna` | `client.responses.create(model="openai.gpt-6-luna", input="Hello")` |
| `openai.gpt-image-1.5` | `client.images.generate(model="openai.gpt-image-1.5", prompt="A university library")` |
| `gwdg.gemma-4-31b-it` | `client.chat.completions.create(model="gwdg.gemma-4-31b-it", messages=[{"role":"user","content":"Hello"}])` |
| `gwdg.deepseek-v4-flash-0731` | `client.chat.completions.create(model="gwdg.deepseek-v4-flash-0731", messages=[{"role":"user","content":"Hello"}])` |
| `hs-de.openai-gpt-oss-120b` | `client.chat.completions.create(model="hs-de.openai-gpt-oss-120b", messages=[{"role":"user","content":"Hello"}])` |
| `gwdg.glm-5.3-flash` | `client.chat.completions.create(model="gwdg.glm-5.3-flash", messages=[{"role":"user","content":"Hello"}])` |
| `hs-de.qwen3.8-27b` | `client.chat.completions.create(model="hs-de.qwen3.8-27b", messages=[{"role":"user","content":"Hello"}])` |
| `hs-de.qwen3.8-27b-no-think` | `client.chat.completions.create(model="hs-de.qwen3.8-27b-no-think", messages=[{"role":"user","content":"Hello"}])` |
| `gwdg.qwen3.6-35b-a3b` | `client.chat.completions.create(model="gwdg.qwen3.6-35b-a3b", messages=[{"role":"user","content":"Hello"}])` |
| `gwdg.qwen3.6-35b-a3b-no-think` | `client.chat.completions.create(model="gwdg.qwen3.6-35b-a3b-no-think", messages=[{"role":"user","content":"Hello"}])` |
| `gwdg.qwen3.5-397b-a17b` | `client.chat.completions.create(model="gwdg.qwen3.5-397b-a17b", messages=[{"role":"user","content":"Hello"}])` |
| `gwdg.qwen3.5-397b-a17b-no-think` | `client.chat.completions.create(model="gwdg.qwen3.5-397b-a17b-no-think", messages=[{"role":"user","content":"Hello"}])` |
| `gwdg.qwen3-30b-a3b-instruct-2507` | `client.chat.completions.create(model="gwdg.qwen3-30b-a3b-instruct-2507", messages=[{"role":"user","content":"Hello"}])` |
| `hs-de.eurollm-22b-instruct-2512` | `client.chat.completions.create(model="hs-de.eurollm-22b-instruct-2512", messages=[{"role":"user","content":"Hello"}])` |
| `gwdg.qwen3-coder-next` | `client.chat.completions.create(model="gwdg.qwen3-coder-next", messages=[{"role":"user","content":"Hello"}])` |
| `gwdg.qwen3-omni-30b-a3b-instruct` | `client.chat.completions.create(model="gwdg.qwen3-omni-30b-a3b-instruct", messages=[{"role":"user","content":"Hello"}])` |
| `kiconnect.mistralai-mistral-small-4-119b-2603` | `client.chat.completions.create(model="kiconnect.mistralai-mistral-small-4-119b-2603", messages=[{"role":"user","content":"Hello"}])` |
| `gwdg.meta-llama-3.1-8b-instruct` | `client.chat.completions.create(model="gwdg.meta-llama-3.1-8b-instruct", messages=[{"role":"user","content":"Hello"}])` |
| `hs-de.complexity-router` | `client.responses.create(model="hs-de.complexity-router", input="Hello")` |
| `hs-de.moeve-router` | `client.responses.create(model="hs-de.moeve-router", input="Hello")` |
| `gwdg.qwen-complexity-router` | `client.chat.completions.create(model="gwdg.qwen-complexity-router", messages=[{"role":"user","content":"Hello"}])` |
| `openai.complexity-router` | `client.responses.create(model="openai.complexity-router", input="Hello")` |
| `mixed.complexity-router` | `client.responses.create(model="mixed.complexity-router", input="Hello")` |
| `kiconnect.qwen3-embedding-8b` | `client.embeddings.create(model="kiconnect.qwen3-embedding-8b", input="Text to embed")` |
| `gwdg.qwen3-embedding-4b` | `client.embeddings.create(model="gwdg.qwen3-embedding-4b", input="Text to embed")` |
| `hs-de.e5-mistral-7b-instruct` | `client.embeddings.create(model="hs-de.e5-mistral-7b-instruct", input="Text to embed")` |
| `gwdg.multilingual-e5-large-instruct` | `client.embeddings.create(model="gwdg.multilingual-e5-large-instruct", input="Text to embed")` |

## Python usage examples

### Shared setup

Create a gateway API key through [My API keys](<https://ai-gateway.uni-paderborn.de/api_hub/api-keys>). Use a current OpenAI Python SDK; the page’s examples also use python-dotenv.

```shell
python -m pip install --upgrade openai python-dotenv
```

Put these values in a local .env file; never commit or share your key:

```dotenv
API_BASE=https://ai-gateway.uni-paderborn.de/v1
API_KEY=YOUR_PADERBORN_GATEWAY_API_KEY
```

```python
import os
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(
    api_key=os.environ["API_KEY"],
    base_url=os.environ["API_BASE"],
)
```

### Chat Completions — chat entries

The page chooses developer for model IDs beginning with openai and system otherwise. Among this snapshot’s chat entries, the latter applies. The user-only expressions in the call table do not need that role distinction.

```python
API_CHAT_MODEL = "hs-de.qwen3.8-27b"
role = "developer" if API_CHAT_MODEL.startswith("openai") else "system"
completion = client.chat.completions.create(
    model=API_CHAT_MODEL,
    messages=[
        {"role": role, "content": "You are a helpful assistant."},
        {"role": "user", "content": "Explain three good uses of Python for AI."},
    ],
)
print(completion.choices[0].message.content)
```

### Responses — responses entries, including most routers

```python
API_CHAT_MODEL = "openai.gpt-6.1-sol"
response = client.responses.create(
    model=API_CHAT_MODEL,
    input="Review this Python function and suggest improvements: def add(a, b): return a+b",
)
print(response.output_text)
```

The page prints response.output instead; output_text is the SDK convenience accessor for text. A router example changes only the model parameter to, for example, hs-de.complexity-router. The exception is gwdg.qwen-complexity-router, whose published mode is chat.

### Embeddings — vectors rather than generated answers

```python
EMBEDDING_MODEL = "kiconnect.qwen3-embedding-8b"
result = client.embeddings.create(
    model=EMBEDDING_MODEL,
    input="A sample passage for semantic search.",
)
vector = result.data[0].embedding
print("Dimensions:", len(vector))
```

For retrieval, embed documents and queries with the same model and compatible dimensions, then compare vectors in your retrieval system. Use the model-card instructions for task prefixes and optional dimension settings; these are not established by the page’s basic example. Rebuild or migrate your index before switching embedding models.

### Image generation — inferred, not supplied by the page

```python
image_result = client.images.generate(
    model="openai.gpt-image-1.5",
    prompt="An architectural illustration of a university library, no text.",
)
print(image_result.data[0])
```

The mode suggests the OpenAI-compatible image-generation method, but gateway endpoint support, edit payloads, output encoding, and pricing require confirmation. The catalog’s AI-Chat alias openai-bilder is not the API model ID.

### Optional reasoning settings

For a Responses model with published support, the standard SDK syntax is:

```python
response = client.responses.create(
    model="openai.gpt-6.1-terra",
    reasoning={"effort": "medium"},
    input="Work through a difficult planning problem and give the final plan.",
)
print(response.output_text)
```

For compatible Chat Completions backends, the standard field is reasoning_effort="high". The page does not demonstrate it, and gateway translation varies by backend. Check support before using it, especially for boolean reasoning metadata. Choosing a listed no-think ID is the page’s clearest way to select its direct-answer variants.

## Catalog descriptions and source links

Original descriptions are preserved below, including German wording, qualifications, and source inconsistencies. Links are those published by the catalog; their destinations were not independently validated. This table supplements the English task guidance rather than making new vendor claims.

| API model ID | Original catalog description (verbatim) | Published sources |
| --- | --- | --- |
| `hs-de.latest-basemodel` | Qwen 3.8 liefert im Vergleich zu seinen Vorgängern erhebliche Fortschritte in den Bereichen Forschung, Programmierung und groß angelegte Agentic-Aufgaben. Das Modell lässt sich auf unterschiedliche Reasoning-Levels (Low, Medium und XHigh) einstellen, damit man optimal die notwendigen Ressourcen für die jeweilige Aufgabe ausnutzen kann. | [Hugging Face Model Card](<https://huggingface.co/Qwen/Qwen3.8-27B-FP8>)<br>[Qwen Blog](<https://qwenlm.github.io/blog/qwen3/>) |
| `openai.latest-basemodel` | GPT-6 Luna ist OpenAIs effizientestes Modell für fokussierte, hochvolumige Aufgaben. Für den Parameter „reasoning.effort“ stehen die Stufen „none“, „low“, „medium“ (Standard), „high“, „xhigh“ und „max“ zur Verfügung. | [OpenAI Model Card](<https://developers.openai.com/api/docs/models/gpt-6-luna>)<br>[OpenAI Ankündigung](<https://openai.com/index/introducing-gpt-6-sol-and-luna/>) |
| `anthropic.claude-opus-5-5` | Claude Opus 5.5 is built for long-running agentic coding and knowledge work, priced at $4 / $20 USD per million input / output tokens. | [Anthropic Model Card](<https://platform.claude.com/docs/en/models/opus-5-5/overview>)<br>[Anthropic Ankündigung](<https://www.anthropic.com/claude-opus-5-5>) |
| `anthropic.claude-sonnet-5-5` | Claude Sonnet 5.5 offers the best combination of speed and intelligence. | [Anthropic Model Card](<https://platform.claude.com/docs/en/models/sonnet-5-5/overview>)<br>[Anthropic Ankündigung](<https://www.anthropic.com/claude-sonnet-5-5>) |
| `anthropic.claude-haiku-5-5` | Claude Haiku 5.5 is built for high-volume, latency-sensitive work such as classification, routing, extraction, and subagent tasks. It supports adaptive thinking with the effort parameter, a 1M token context window, and up to 128k output tokens. It uses the same newer tokenizer as Claude 4.7 and later models, so the same text counts as approximately 30% more tokens than on Claude Haiku 4.5. Its thinking blocks work only in the account that produced them, or in an account linked to it. | [Anthropic Model Card](<https://platform.claude.com/docs/en/models/haiku-5-5/overview>)<br>[Anthropic Ankündigung](<https://www.anthropic.com/claude-haiku-5-5>) |
| `openai.gpt-6-astra` | GPT-6 Astra ist OpenAIs leistungsstärkstes Modell, das für anspruchsvollste End-to-End-Aufgaben entwickelt wurde. Nutzen Sie es für komplexe Schlussfolgerungen, Programmierung, Computeranwendungen, Recherche und die Erstellung von Dokumenten. Für die Parameter „reasoning.effort“ stehen die Stufen „low“, „medium“, „high“, „xhigh“ und „max“ zur Verfügung. | [OpenAI Model Card](<https://developers.openai.com/api/docs/models/gpt-6-astra>)<br>[OpenAI Ankündigung](<https://openai.com/index/gpt-6-astra/>) |
| `openai.gpt-6.1-sol` | GPT-6.1 Sol liefert nahezu Astra-niveau Leistung zu geringeren Kosten für komplexe Codierung, Computer-Nutzung und professionelle Aufgaben. Vergleichen Sie es auf Ihren eigenen Aufgaben mit Astra, um das Verhältnis zwischen Qualität und Kosten abzuwägen. | [OpenAI Model Card](<https://developers.openai.com/api/docs/models/gpt-6.1-sol>)<br>[OpenAI Ankündigung](<https://openai.com/de-DE/index/introducing-gpt-6-1-sol/>) |
| `openai.gpt-6.1-terra` | Nutzen Sie GPT-6.1 Terra, um Produktfotos mit Katalogeinträgen abzugleichen, technische Zeichnungen zu interpretieren, auf Anwendungsbildschirmen zu agieren oder Texte zu verfassen und zu überarbeiten. | [OpenAI Model Card](<https://developers.openai.com/api/docs/models/gpt-6.1-terra>)<br>[OpenAI Ankündigung](<https://openai.com/de-DE/index/introducing-gpt-6-1-terra/>) |
| `openai.gpt-6-luna` | GPT-6 Luna ist OpenAIs effizientestes Modell für fokussierte, hochvolumige Aufgaben. Für den Parameter „reasoning.effort“ stehen die Stufen „none“, „low“, „medium“ (Standard), „high“, „xhigh“ und „max“ zur Verfügung. | [OpenAI Model Card](<https://developers.openai.com/api/docs/models/gpt-6-luna>)<br>[OpenAI Ankündigung](<https://openai.com/index/introducing-gpt-6-sol-and-luna/>) |
| `openai.gpt-image-1.5` | GPT Image ist OpenAIs Modellfamilie für Bildgenerierung und Bildbearbeitung. Die Modelle können Text- und teils Bildeingaben verwenden, um neue Bilder zu erzeugen oder bestehende Bilder zu editieren; GPT Image 2 wird in den aktuellen OpenAI-Docs als State-of-the-Art-Modell für schnelle, hochwertige Bildgenerierung und -bearbeitung beschrieben. | [OpenAI Model Card](<https://developers.openai.com/api/docs/models/gpt-image-1.5>)<br>[OpenAI Image Generation Guide](<https://developers.openai.com/api/docs/guides/image-generation>) |
| `gwdg.gemma-4-31b-it` | Die Modell-Serie Gemma ist die Open-Source Variante der Gemini-Reihe von Google. Zu betonen ist dass das Open-Source-Modell von der GWDG/KISSKI betrieben wird und damit kein Datenfluss zu Google besteht. Im Vergleich dazu, können die Gemini-Modelle, welche nicht Open-Source sind, leider nicht von der GWDG/KISSKI betrieben werden. | [Hugging Face Model Card](<https://huggingface.co/google/gemma-4-31B-it>)<br>[Google Model Page](<https://ai.google.dev/gemma/docs/core?hl=de>) |
| `gwdg.deepseek-v4-flash-0731` | DeepSeek V4 Flash 0731 ist ein leistungsfähiges Mixture-of-Experts-(MoE)-Modell mit 284 Milliarden Parametern (13 Milliarden aktiviert) und einer Kontextfenstergröße von einer Million Token. Bei hohem Rechenaufwand erzielt es eine vergleichbare Reasoning-Leistung wie DeepSeek V4 Pro, verfügt jedoch nicht über das tiefe Wissen und die komplexesten agentic Fähigkeiten von den Spitzenmodellen. | [Hugging Face Model Card](<https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash-0731>)<br>[DeepSeek Blog](<https://www.deepseek.com/en/news/v4-preview/>)<br>[GWDG](<https://docs.hpc.gwdg.de/services/ai-services/chat-ai/models/index.html>) |
| `hs-de.openai-gpt-oss-120b` | OpenAI hat neben den proprietären Modellen auch Open-Source Modelle veröffentlicht. Zuletzt sind dies die Modelle GPT-OSS 20B und GPT-OSS 120B. Letzteres kann im Angebot der Hochschule verwendet werden. Zu betonen ist dass das Open-Source-Modell von der GWDG/KISSKI betrieben wird und damit kein Datenfluss zu OpenAI besteht. Im Vergleich zu Modellen wie GPT-5 oder o4, welche nicht Open-Source sind, können diese leider nicht von der GWDG/KISSKI betrieben werden. | [Hugging Face Model Card](<https://huggingface.co/openai/gpt-oss-120b>)<br>[OpenAI Model Card](<https://developers.openai.com/api/docs/models/gpt-oss-120b>) |
| `gwdg.glm-5.3-flash` | Codierungs-fokussiertes Modell von Z.ai. Signifikante Verbesserungen in mehrsprachigem agentic coding und terminal-basierten Aufgaben. Starke Leistung auf SWE-bench, SWE-bench Multilingual, Tool Use, Web Browsing und mathematischem Reasoning. | [Hugging Face Model Card](<https://huggingface.co/zai-org/GLM-5.3-Flash>)<br>[Z.ai Blog](<https://z.ai/blog/glm-5.3-flash>)<br>[GWDG](<https://docs.hpc.gwdg.de/services/ai-services/chat-ai/models/index.html>) |
| `hs-de.qwen3.8-27b` | Qwen 3.8 liefert im Vergleich zu seinen Vorgängern erhebliche Fortschritte in den Bereichen Forschung, Programmierung und groß angelegte Agentic-Aufgaben. Das Modell lässt sich auf unterschiedliche Reasoning-Levels (Low, Medium und XHigh) einstellen, damit man optimal die notwendigen Ressourcen für die jeweilige Aufgabe ausnutzen kann. | [Hugging Face Model Card](<https://huggingface.co/Qwen/Qwen3.8-27B-FP8>)<br>[Qwen Blog](<https://qwenlm.github.io/blog/qwen3/>) |
| `hs-de.qwen3.8-27b-no-think` | Das Qwen 3.8 Modell ist eigentlich ein Reasoning-Model, verfügt allerdings über eine „Non-Reasoning“ Anweisung. Die zugrunde liegende Architektur des Models ändert sich dabei nicht, aber ermöglicht es das Model anzuweisen ohne „Thinking“-Iterationen zu arbeiten und stattdessen direkt eine Antwort zu generieren. Das erlaubt es Nutzende möglichst schnell Texte zu generieren und das Model auch für einfache Aufgaben ohne benötigte Schlussfolgerungen zu nutzen. | [Hugging Face Model Card](<https://huggingface.co/Qwen/Qwen3.8-27B-FP8>)<br>[Qwen Blog](<https://qwenlm.github.io/blog/qwen3/>) |
| `gwdg.qwen3.6-35b-a3b` | Qwen 3.6 35B A3B ist ein MoE-Modell (Mixture of Experts) mit insgesamt 35 Milliarden Parametern, wobei nur 3 Milliarden Parameter für eine effiziente Inferenz aktiviert werden. Es ist geeignet für praktische Anwendungsaufgaben, darunter Codierung und agentenbasierte Workflows. | [Hugging Face Model Card](<https://huggingface.co/Qwen/Qwen3.6-35B-A3B-FP8>)<br>[Qwen Blog](<https://qwenlm.github.io/blog/qwen3/>)<br>[GWDG](<https://docs.hpc.gwdg.de/services/ai-services/chat-ai/models/index.html>) |
| `gwdg.qwen3.6-35b-a3b-no-think` | Das Qwen 3.6 Modell ist eigentlich ein Reasoning-Model, verfügt allerdings über eine „Non-Reasoning“ Anweisung. Die zugrunde liegende Architektur des Models ändert sich dabei nicht, aber ermöglicht es das Model anzuweisen ohne „Thinking“-Iterationen zu arbeiten und stattdessen direkt eine Antwort zu generieren. Das erlaubt es Nutzende möglichst schnell Texte zu generieren und das Model auch für einfache Aufgaben ohne benötigte Schlussfolgerungen zu nutzen. | [Hugging Face Model Card](<https://huggingface.co/Qwen/Qwen3.6-35B-A3B-FP8>)<br>[Qwen Blog](<https://qwenlm.github.io/blog/qwen3/>) |
| `gwdg.qwen3.5-397b-a17b` | Qwen 3.5 397B A17B ist ein MoE-Modell (Mixture of Experts) mit insgesamt 397 Milliarden Parametern, wobei 17 Milliarden Parameter aktiviert sind. Es zählt zu den leistungsfähigsten verfügbaren Modellen mit offenen Gewichtungen (Open-Weight) und erzielt außergewöhnliche Ergebnisse in den Bereichen Reasoning, Programmierung, Mathematik und allgemeine Aufgaben. Das Modell unterstützt Vision-Fähigkeiten und bietet unter den open-source Modellen Spitzenleistungen. | [Hugging Face Model Card](<https://huggingface.co/Qwen/Qwen3.5-397B-A17B-GPTQ-Int4>)<br>[Qwen Blog](<https://qwenlm.github.io/blog/qwen3/>)<br>[GWDG](<https://docs.hpc.gwdg.de/services/ai-services/chat-ai/models/index.html>) |
| `gwdg.qwen3.5-397b-a17b-no-think` | Das Qwen 3.5 Modell ist eigentlich ein Reasoning-Model, verfügt allerdings über eine „Non-Reasoning“ Anweisung. Die zugrunde liegende Architektur des Models ändert sich dabei nicht, aber ermöglicht es das Model anzuweisen ohne „Thinking“-Iterationen zu arbeiten und stattdessen direkt eine Antwort zu generieren. Das erlaubt es Nutzende möglichst schnell Texte zu generieren und das Model auch für einfache Aufgaben ohne benötigte Schlussfolgerungen zu nutzen. | [Hugging Face Model Card](<https://huggingface.co/Qwen/Qwen3.5-397B-A17B-GPTQ-Int4>)<br>[Qwen Blog](<https://qwenlm.github.io/blog/qwen3/>)<br>[GWDG](<https://docs.hpc.gwdg.de/services/ai-services/chat-ai/models/index.html>) |
| `gwdg.qwen3-30b-a3b-instruct-2507` | Dieses MoE-Modell (Mixture of Experts) verfügt über insgesamt 30,5 Milliarden Parameter, wobei für eine effiziente Inferenz nur 3,3 Milliarden Parameter aktiviert werden. Es bietet erhebliche Verbesserungen in Bezug auf die Einhaltung von Anweisungen, logisches Denken, Textverständnis, Mathematik, Naturwissenschaften, Programmieren und den Einsatz von Werkzeugen, mit besserer Abstimmung für subjektive und offene Aufgaben. Das Modell unterstützt eine native Kontextlänge von 256K und arbeitet im sogenannten -Modus, wobei es starke Leistungen in Bezug auf Wissen, Reasoning, Programmierung und mehrsprachige Benchmarks zeigt. | [Hugging Face Model Card](<https://huggingface.co/Qwen/Qwen3-30B-A3B-Thinking-2507>)<br>[Qwen Blog](<https://qwenlm.github.io/blog/qwen3/>)<br>[GWDG](<https://docs.hpc.gwdg.de/services/ai-services/chat-ai/models/index.html>) |
| `hs-de.eurollm-22b-instruct-2512` | Ein großes Sprachmodell aus Europa, das alle 24 Amtssprachen der EU unterstützt. Im Projekt UTTER (Unified Transcription and Translation for Extended Reality) wurde das Sprachmodell EuroLLM entwickelt, welches auf der Grundlage von über 4 Billionen Tokens mehrsprachiger Daten aus 35 verschiedenen Sprachen, darunter alle offiziellen EU-Sprachen, trainiert wurde. Es unterstützt eine Kontextgröße von 32.000 Tokens. Weiterhin ist die 'EuroLLM 22B Instruct' eine Variante, welches speziell für die Befolgung von Anweisungen und Chat-Funktionen feinabgestimmt wurde. | [Hugging Face Model Card](<https://huggingface.co/utter-project/EuroLLM-22B-Instruct-2512>)<br>[Projekt-Seite](<https://he-utter.eu/>)<br>[MÖVE-Rating](<https://moeve.bundesdruckerei.de/models/Eurollm%2022b%20Instruct%202512>) |
| `gwdg.qwen3-coder-next` | Qwen 3 Coder Next verfügt über insgesamt 80 Milliarden Parameter, wovon 3 Milliarden aktiviert sind, was es besonders kosteneffizient macht, vor allem für den Einsatz in Agenten. Mit einer Kontextlänge von 256K und der Anpassungsfähigkeit an verschiedene Templates kann es zudem in CLI- und IDE-Plattformen integriert werden. | [Hugging Face Model Card](<https://huggingface.co/Qwen/Qwen3-Coder-Next-FP8>)<br>[Qwen Blog](<https://qwenlm.github.io/blog/qwen3-coder/>)<br>[GWDG](<https://docs.hpc.gwdg.de/services/ai-services/chat-ai/models/index.html>) |
| `gwdg.qwen3-omni-30b-a3b-instruct` | Qwen3 Omni ist ein nativ mehrsprachiges, omnimodales Foundation Model, das Text, Bilder, Audio und Video verarbeitet. Es erzielt Spitzenleistungen bei vielen Audio- und Video-Benchmarks und bietet bei automatischer Spracherkennung (ASR), Audio-Verständnis sowie Gesprächsführung mit Sprache Leistungen, die mit Gemini 2.5 Pro vergleichbar sind. Das Modell basiert auf einer neuartigen MoE-basierten Thinker-Talker-Architektur mit AuT-Vortrainierung, unterstützt 119 Textsprachen und 19 Spracheingabesprachen und ermöglicht interaktive Dialoge mit geringer Latenz sowie flexible Steuerung über System-Prompts. | [Hugging Face Model Card](<https://huggingface.co/Qwen/Qwen3-Omni-30B-A3B-Instruct>)<br>[Qwen Blog](<https://qwen.ai/blog?id=65f766fc2dcba7905c1cb69cc4cab90e94126bf4&from=research.latest-advancements-list>)<br>[GWDG](<https://docs.hpc.gwdg.de/services/ai-services/chat-ai/models/index.html>) |
| `kiconnect.mistralai-mistral-small-4-119b-2603` | Mistral Small 4 119B A6B - Das französische Unternehmen „Mistral“ wird in den Medien oft als eine europäische Lösung betitelt, welche mit den großen Sprachmodellen der amerikanischen Konkurrenten mithalten kann. Durch den Unternehmenssitz innerhalb der EU, ist es im Vergleich zu anderen Anbietern in den USA, regulierter. Folglich sind Angaben zu Trainings-Daten und der Umgang mit Lizenzen freundlicher gegenüber EU-Verordnungen und -Richtlinien. Hier muss allerdings unterschieden werden, dass es nur um die Entwicklung der Modelle und damit um Fragen geht, wie die Transparenz der Traningsdaten. | [Hugging Face Model Card](<https://huggingface.co/mistralai/Mistral-Small-4-119B-2603>)<br>[Mistral Model Card](<https://docs.mistral.ai/models/model-cards/mistral-small-4-0-26-03>)<br>[Mistral Blog Release](<https://mistral.ai/news/mistral-small-4>) |
| `gwdg.meta-llama-3.1-8b-instruct` | Leichtgewichtigstes Modell mit schnellster Performance und guten Ergebnissen über alle Benchmarks hinweg. Ausreichend für allgemeine Konversationen und Hilfeleistungen. | [Hugging Face Model Card](<https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct>) |
| `hs-de.complexity-router` | Routed automatisch Anfragen innerhalb der deutschen Hochschulrechenzentren an geeignete sowie verfügbare Modelle. Mehr Informationen unter [https://hilfe.uni-paderborn.de/KI-Router-Modelle#HS-DE:_Complexity-Routing](https://hilfe.uni-paderborn.de/KI-Router-Modelle#HS-DE:_Complexity-Routing)  | See links inside description |
| `hs-de.moeve-router` | Für die Modelle innerhalb des Routers wurden nur die TOP-Modelle der MÖVE-Einordnung verwendet ("Modelle für die öffentliche Verwaltung evaluiert"). Mehr Informationen unter [https://hilfe.uni-paderborn.de/KI-Router-Modelle#HS-DE:_M.C3.96VE-Routing_.28geeignet_f.C3.BCr_die_.C3.B6ffentliche_Verwaltung.29](https://hilfe.uni-paderborn.de/KI-Router-Modelle#HS-DE:_M.C3.96VE-Routing_.28geeignet_f.C3.BCr_die_.C3.B6ffentliche_Verwaltung.29)  | See links inside description |
| `gwdg.qwen-complexity-router` | Diese Model routet automatisch Ihre Anfragen nach Komplexität an vier verschiedenen Qwen-Modelle. Mehr Informationen unter [https://hilfe.uni-paderborn.de/KI-Router-Modelle#GWDG:_Qwen-Complexity-Routing](https://hilfe.uni-paderborn.de/KI-Router-Modelle#GWDG:_Qwen-Complexity-Routing) | See links inside description |
| `openai.complexity-router` | Diese Model routet Ihre Anfrage automatisch je nach Komplexität an unterschiedliche Frontier-Modelle von OpenAI GPT-6. Dabei werden auch Reasoning-Effort automatisch hoch bzw. runter gesetzt. Mehr Informationen unter [https://hilfe.uni-paderborn.de/KI-Router-Modelle#OpenAI:_Cost-Complexity-Routing](https://hilfe.uni-paderborn.de/KI-Router-Modelle#OpenAI:_Cost-Complexity-Routing)  | See links inside description |
| `mixed.complexity-router` | Diese Model routet Ihre Anfragen kosten-optimal je nach Komplexität an zwei kostenlose Modelle und für komplexe Anfragen an OpenAI-Modelle. Mehr Informationen unter [https://hilfe.uni-paderborn.de/KI-Router-Modelle#Mixed_.28HS-DE.2FOpenAI.29:_Cost-Complexity-Routing](https://hilfe.uni-paderborn.de/KI-Router-Modelle#Mixed_.28HS-DE.2FOpenAI.29:_Cost-Complexity-Routing)  | See links inside description |
| `kiconnect.qwen3-embedding-8b` | Embedding-Modell, ausschließlich über API verfügbar. Das Modell Unterstützt über 100 Sprachen, mit 8B Parametern, 36 Layers und nutzerdefinierte Dimensionen zwischen 32 und 4096. | [Hugging Face Model Card](<https://huggingface.co/Qwen/Qwen3-Embedding-8B>) |
| `gwdg.qwen3-embedding-4b` | Embedding-Modell, ausschließlich über API verfügbar. Das Modell Unterstützt über 100 Sprachen, mit 4B Parametern, 36 Layers und nutzerdefinierte Dimensionen zwischen 32 und 2560. | [Hugging Face Model Card](<https://huggingface.co/Qwen/Qwen3-Embedding-4B>) |
| `hs-de.e5-mistral-7b-instruct` | Embedding-Modell, ausschließlich über API verfügbar. Das Modell wurde nur für die englische Sprache trainiert. Es hat 7B Parameter, 32 Layers und 4096 Dimensionen. | [Hugging Face Model Card](<https://huggingface.co/intfloat/e5-mistral-7b-instruct>) |
| `gwdg.multilingual-e5-large-instruct` | Embedding-Modell, ausschließlich über API verfügbar. Das Modell unterstützt 94 Sprachen, mit 0.6B Parametern, 24 Layers und 1024 Dimensionen. | [Hugging Face Model Card](<https://huggingface.co/intfloat/multilingual-e5-large-instruct>) |

## Important caveats and inconsistencies

1. **Upcoming entries:** all three Claude 5.5 entries are marked Upcoming. They are included for completeness, not represented as confirmed callable services.
2. **Reasoning disagreement:** Astra’s structured levels are none/low/medium/high, while its prose says low/medium/high/xhigh/max. Luna’s structured levels are none/low/medium/high, while its prose adds xhigh/max. The OpenAI router also references Sol xhigh/max destinations even though Sol’s structured list stops at high. Confirm accepted levels with the gateway.
3. **Base aliases:** hs-de.latest-basemodel currently names Qwen 3.8. openai.latest-basemodel currently names Luna (High Reasoning), but its config is empty and its description says medium is standard. A high default is not independently established. Use fixed IDs when repeatability matters.
4. **Health:** gwdg.qwen3.6-35b-a3b is unhealthy in this snapshot. Null status for other entries means unknown, not healthy. The frontend maps a health property while the endpoint supplies health_status; the status column here reads the endpoint field directly.
5. **DeepSeek parameter mismatch:** structured parameters say 304B, while the description says 284B total and 13B active. Both values are retained; no correction is assumed.
6. **Hosting discrepancy for GPT OSS:** top-level provider is kiconnect, while its description says GWDG/KISSKI operates the model. Neither should be silently substituted for the other.
7. **Qwen 3 Instruct source mismatch:** the API ID says instruct-2507, but its model-card link points to Thinking-2507. Its description also contains an incomplete mode phrase. Use the API ID shown in the call table and verify behavior.
8. **Embedding fields:** the 8B Qwen embedding description permits up to 4,096 dimensions, but max_output_tokens is 2,560. This is a source-field mismatch, not evidence that 4,096-dimensional vectors cannot work. The shared embedding examples do not force dimensions.
9. **Capabilities are not endpoint guarantees:** Omni’s description advertises audio/video, but the explicit flags only list vision. Qwen 3.8 has a video-input tag but no video-specific flag. Tool-oriented descriptions do not guarantee built-in browsing. Verify actual gateway payload support.
10. **No-think flags:** Qwen 3.8 and 3.6 no-think entries still carry supports_reasoning. This describes the family’s capabilities and does not override the variants’ direct-answer descriptions.
11. **Image model identity:** the Image 1.5 description mentions Image 2. Only openai.gpt-image-1.5 is a public entry in this snapshot; no Image 2 call ID is established here. The page supplies API-example buttons only for chat, responses, and embedding modes.
12. **Router costs and location:** OpenAI and mixed routers show zero input/output rates despite paid destinations. The mixed router’s empty region array is not a guarantee that data stays in Germany. Internal effort-suffixed IDs are routing-map values, not additional confirmed public entries.
13. **Tokenizer/account caveat for Haiku:** its description says the newer tokenizer counts approximately 30% more tokens than Haiku 4.5 for the same text; thinking blocks only work within the producing account or a linked account.
14. **Quotas and permissions:** published TPM/RPM/parallelism are not a promise of personal access, cumulative multi-provider capacity, or unrestricted spending. Your key, team permissions, and current budget can impose other limits.
15. **Privacy and compliance:** model origin, an HS* label, European development, or a MÖVE rating alone is not authorization to submit personal, confidential, or regulated data. Follow the university’s current rules.

## Further gateway documentation

| Topic | University reference |
| --- | --- |
| Gateway setup and access | [AI-Gateway](<https://hilfe.uni-paderborn.de/AI-Gateway>) |
| Language-model guidance | [KI-Sprachmodelle](<https://hilfe.uni-paderborn.de/KI-Sprachmodelle>) |
| Budgets and costs | [Budgets in AI-Chat and AI-Gateway](<https://hilfe.uni-paderborn.de/Budgets_im_AI-Chat_und_AI-Gateway>) |
| Router behavior | [KI-Router-Modelle](<https://hilfe.uni-paderborn.de/KI-Router-Modelle>) |
| Terminology | [KI-Glossar](<https://hilfe.uni-paderborn.de/KI-Glossar>) |
| Models visible to your API key | GET https://ai-gateway.uni-paderborn.de/v1/models with your gateway API key; not called for this reference. |

Catalog details, aliases, availability, prices, and limits can change. Recheck the live source before deployment or budgeting.
