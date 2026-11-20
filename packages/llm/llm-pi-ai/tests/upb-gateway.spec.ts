/**
 * Regression tests for the shipped Uni Paderborn AI-Gateway route and its
 * model catalog data (see ../src/upb-gateway.ts).
 */
import { describe, expect, it } from 'vitest'

import {
  UPB_CHAT_MODELS,
  UPB_GATEWAY_API_KEY_ENV,
  UPB_GATEWAY_BASE_URL,
  UPB_GATEWAY_CATALOG,
  UPB_GATEWAY_MODELS,
  UPB_GATEWAY_PROFILE,
  UPB_GATEWAY_PROVIDER,
  UPB_GATEWAY_REQUEST_OUTPUT_TOKENS,
  upbEntryOf,
} from '@deepseek-ai/dsh-llm-pi-ai'

describe('UPB AI-Gateway shipped route', () => {
  it('exposes the expected provider identity', () => {
    expect(UPB_GATEWAY_PROVIDER).toBe('upb-ai-gateway')
    expect(UPB_GATEWAY_BASE_URL).toBe('https://ai-gateway.uni-paderborn.de/v1')
    expect(UPB_GATEWAY_API_KEY_ENV).toBe('UPB_AI_GATEWAY_KEY')
  })

  it('wires the profile to the constants', () => {
    expect(UPB_GATEWAY_PROFILE.baseURL).toBe(UPB_GATEWAY_BASE_URL)
    expect(UPB_GATEWAY_PROFILE.apiKeyEnv).toBe(UPB_GATEWAY_API_KEY_ENV)
    expect(UPB_GATEWAY_PROFILE.api).toBe('openai-completions')
    expect(UPB_GATEWAY_PROFILE.models).toBe(UPB_GATEWAY_MODELS)
    // Pacing reserves what the gateway charges: input plus the declared output
    // cap, so a request waits for budget instead of being throttled.
    expect(UPB_GATEWAY_PROFILE.rateLimitOutputTokens).toBe(UPB_GATEWAY_REQUEST_OUTPUT_TOKENS)
  })
})

describe('UPB AI-Gateway model catalog', () => {
  it('has unique model ids', () => {
    const ids = UPB_GATEWAY_MODELS.map(m => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('declares an rpm budget on every chat model', () => {
    for (const model of UPB_GATEWAY_MODELS) {
      expect(model.rpm, model.id).toBeGreaterThan(0)
    }
  })

  it('ships the DeepSeek V4 Flash headline model with its caps', () => {
    const deepseek = UPB_GATEWAY_MODELS.find(
      m => m.id === 'gwdg.deepseek-v4-flash-0731',
    )
    expect(deepseek).toBeDefined()
    expect(deepseek?.rpm).toBe(10)
    expect(deepseek?.tpm).toBe(500_000)
    expect(deepseek?.contextWindow).toBe(1_000_000)
    // The gateway charges the declared output cap against its 500,000-token
    // minute, so the shipped per-request cap is one tenth (10 simultaneous
    // requests), not the published 384,000-token output maximum.
    expect(deepseek?.maxTokens).toBe(50_000)
  })

  it('ships the known chat-capable gateway model set', () => {
    const ids = UPB_GATEWAY_MODELS.map(m => m.id)
    for (const expected of [
      'gwdg.deepseek-v4-flash-0731',
      'hs-de.qwen3.8-27b',
      'gwdg.gemma-4-31b-it',
      'gwdg.glm-5.3-flash',
      'gwdg.qwen3-coder-next',
      'kiconnect.mistralai-mistral-small-4-119b-2603',
    ]) {
      expect(ids).toContain(expected)
    }
    // The gateway also lists embedding / image-generation entries that the
    // chat-only transport cannot dispatch; those must not appear here.
    expect(ids).not.toContain('kiconnect.qwen3-embedding-8b')
    expect(ids.filter(id => id.includes('.gpt-image-')).length).toBe(0)
  })

  it('derives the shipped set from the canonical chat-executable catalogue, excluding reference-only entries', () => {
    // The shipped route is exactly the chat-executable catalogue subset,
    // including the gateway's `(Test)` chat listings. It is a derivation, not a
    // restated copy.
    const chatExecutable = UPB_CHAT_MODELS
    const expectedIds = new Set(chatExecutable.map(m => m.id))
    const shippedIds = UPB_GATEWAY_MODELS.map(m => m.id)
    expect(expectedIds.size).toBe(chatExecutable.length)
    expect(shippedIds).toHaveLength(chatExecutable.length)
    for (const id of shippedIds) {
      expect(expectedIds.has(id), id).toBe(true)
    }
    // Every shipped id exists in the full catalogue.
    for (const model of UPB_GATEWAY_MODELS) {
      const entry = upbEntryOf(model.id)
      expect(entry, model.id).toBeDefined()
    }
    // Reference-only entries (embedding / image / responses / router / alias)
    // are never shipped by the chat route, even though the test `(Test)` chat
    // listings are.
    const referenceIds = new Set(UPB_GATEWAY_CATALOG.filter(m => m.mode !== 'chat').map(m => m.id))
    for (const id of referenceIds) {
      expect(shippedIds, `reference-only "${id}" must not be shipped`).not.toContain(id)
    }
  })

  it('ships the gateway `(Test)` chat listings as callable, non-excluded models', () => {
    // The DeepSeek V4.1 Flash 1017 (Test), GLM 5.3 (Test), and Mistral Large
    // 4 1T A52B (Test) chat models are part of the shipped route again: they
    // appear in pickers and are callable, though none is a default.
    for (const id of [
      'gwdg.deepseek-v4.1-flash-1017',
      'gwdg.glm-5.3',
      'gwdg.mistral-large-4-1t-a52b',
    ]) {
      const model = UPB_GATEWAY_MODELS.find(m => m.id === id)
      expect(model, id).toBeDefined()
      expect(model?.name).toMatch(/\(Test\)/)
      expect(model?.rpm).toBeGreaterThan(0)
    }
  })

  it('sizes every request to the gateway per-minute token share while keeping the published ceiling', () => {
    // The published maximum output is the model's capability and stays a
    // catalogue fact. The shipped `maxTokens` is the part of the per-minute
    // token budget one request may declare, so the gateway keeps admitting the
    // next request instead of throttling it with HTTP 429.
    expect(UPB_GATEWAY_REQUEST_OUTPUT_TOKENS).toBe(50_000)
    for (const model of UPB_GATEWAY_MODELS) {
      const entry = upbEntryOf(model.id)
      expect(entry, model.id).toBeDefined()
      const share = Math.floor((model.tpm ?? 0) / (entry?.maxParallel ?? 1))
      expect(model.maxTokens, model.id).toBeGreaterThan(0)
      expect(model.maxTokens, model.id).toBeLessThanOrEqual(share)
      expect(entry?.maxOutputTokens ?? 0, model.id).toBeGreaterThanOrEqual(model.maxTokens ?? 0)
    }
    // A published output ceiling below the share is the cap itself.
    expect(UPB_GATEWAY_MODELS.find(m => m.id === 'hs-de.eurollm-22b-instruct-2512')?.maxTokens).toBe(32_000)
    expect(upbEntryOf('gwdg.deepseek-v4-flash-0731')?.maxOutputTokens).toBe(384_000)
    // A Qwen 3.8 row publishes an RPM range 10 - 100; the shipped route paces
    // at the conservative lower bound.
    expect(UPB_GATEWAY_MODELS.find(m => m.id === 'hs-de.qwen3.8-27b')?.rpm).toBe(10)
    // Vision-advertised chat models accept image input.
    expect(UPB_GATEWAY_MODELS.find(m => m.id === 'gwdg.gemma-4-31b-it')?.input).toContain('image')
  })
})
