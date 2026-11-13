/**
 * Regression tests for the shipped Uni Paderborn AI-Gateway route and its
 * model catalog data (see ../src/upb-gateway.ts).
 */
import { describe, expect, it } from 'vitest'

import {
  UPB_GATEWAY_API_KEY_ENV,
  UPB_GATEWAY_BASE_URL,
  UPB_GATEWAY_MODELS,
  UPB_GATEWAY_PROFILE,
  UPB_GATEWAY_PROVIDER,
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
  })
})

describe('UPB AI-Gateway model catalog', () => {
  it('has unique model ids', () => {
    const ids = UPB_GATEWAY_MODELS.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('declares an rpm budget on every chat model', () => {
    for (const model of UPB_GATEWAY_MODELS) {
      expect(model.rpm, model.id).toBeGreaterThan(0)
    }
  })

  it('ships the DeepSeek V4 Flash headline model with its caps', () => {
    const deepseek = UPB_GATEWAY_MODELS.find(
      (m) => m.id === 'gwdg.deepseek-v4-flash-0731',
    )
    expect(deepseek).toBeDefined()
    expect(deepseek?.rpm).toBe(10)
    expect(deepseek?.tpm).toBe(500_000)
    expect(deepseek?.contextWindow).toBe(1_000_000)
    expect(deepseek?.maxTokens).toBe(384_000)
  })

  it('ships the known chat-capable gateway model set', () => {
    const ids = UPB_GATEWAY_MODELS.map((m) => m.id)
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
    expect(ids.filter((id) => id.includes('.gpt-image-')).length).toBe(0)
  })
})
