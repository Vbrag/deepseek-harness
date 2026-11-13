# Paderborn AI-Gateway: image generation & embeddings — investigation findings

Date: 2026-10-30 (Europe/Berlin).
Purpose: determine whether the Paderborn AI-Gateway's image-generation model
(`openai.gpt-image-1.5`) and embedding models can be wired into the DSH pipeline.

## Scope

- Question: can GPT Image 1.5 (image_generation mode) and the 4 embedding models be
  added to the DSH harness, beyond the existing chat/responses provider routes?
- This is a documentation-only record. No code, configuration, or plugin was changed
  for image generation or embeddings as part of this investigation.

## Endpoint verification (live, authenticated)

Probes used the stored credential referenced by `UNI_PADERBORN_API_KEY`
(`C:\Users\abdelmaw\.dsh\.credentials.yaml`).

| POST endpoint | Model | HTTP | Result |
|---|---|---|---|
| `/v1/chat/completions` | `hs-de.qwen3.8-27b` | 200 | Valid key; chat works |
| `/v1/embeddings` | `kiconnect.qwen3-embedding-8b` | 200 | 2048-dim embedding returned |
| `/v1/images/generations` | `openai.gpt-image-1.5` | 403 (empty body) | Permission denied |

### Interpretation

- The key is valid (chat and embeddings both return 200).
- `/v1/images/generations` returns **403 with an empty body**. A malformed request
  would return a 4xx with a JSON error body; a 403 with no body indicates the key
  does not have image-generation permission on this gateway account/team. A control
  probe confirmed a nonexistent route returns 500, not 401/403, so the 403 is not a
  routing artifact.
- The same absence of permission is seen on `/v1/responses` (also 403), matching a
  key whose chat access is served through completions, not responses.

## Harness pipeline constraints

- The `llm` service seam (`StreamChunk`, `ModelModality`) supports text output,
  reasoning, tool calls, and image *input* only. There is **no image-output
  (generation)** or **embedding/vector output** type in the model-visible pipeline.
- `@deepseek-ai/dsh-llm-pi-ai` registers providers that implement only the chat
  `stream` method; it does not surface pi-ai image or vector methods.
- pi-ai (`@earendil-works/pi-ai@1.3.0`) exposes an image API
  (`Provider.generateImages`, `ImagesContext`, `AssistantImages`) but ships only a
  built-in OpenRouter images provider — no OpenAI images provider — and has no
  embeddings API at all.
- Conclusion: both capabilities require new harness code (a plugin and/or service
  extension), not a `cordis.patch.yml` change. They cannot be added to the chat
  `models:` lists (image_generation/embedding modes would be sent to the wrong
  chat/response endpoint).

## Recommended paths (for a later decision)

- **Embeddings (verified working):** an `embed_text`-style tool calling
  `POST /v1/embeddings` (e.g. `kiconnect.qwen3-embedding-8b`, 2048-dim) is realizable
  today as a DSH plugin. Full RAG (durable vector store, chunking, indexing,
  retrieval) is a separate, larger project.
- **Image generation (blocked by permission):** the endpoint returns 403 for the
  current key. Wiring it into the harness is possible in principle but the runtime
  call will fail until Paderborn grants image-generation access to the account/team.
  This is a gateway-side permission change, not a harness fix.

## Status

- [x] Endpoint availability and authentication verified.
- [x] Harness pipeline feasibility assessed.
- [ ] Embedding tool plugin built (deferred - user elected to stop).
- [ ] Image-generation tool plugin built (deferred - key lacks permission).
