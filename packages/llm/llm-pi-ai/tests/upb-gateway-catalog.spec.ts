/**
 * Consistency checks for the canonical Uni Paderborn AI-Gateway catalogue.
 *
 * These are structural, deterministic assertions over {@link UPB_GATEWAY_CATALOG}
 * and its derived views, so a catalogue edit cannot ship duplicate, dangling,
 * or unsourced facts. They check behaviour (uniqueness, referential
 * integrity, source linkage) rather than any specific model count.
 *
 * @module dsh-llm-pi-ai/tests/upb-gateway-catalog
 */
import { describe, expect, it } from 'vitest'
import {
  UPB_CHAT_MODELS,
  UPB_GATEWAY_CATALOG,
  UPB_GATEWAY_SNAPSHOT,
  UPB_REFERENCE_ONLY,
  upbEntryOf,
} from '@deepseek-ai/dsh-llm-pi-ai/upb-gateway-catalog'

describe('UPB AI-Gateway canonical catalogue', () => {
  it('holds unique, non-empty ids and a balanced complete inventory', () => {
    const ids = UPB_GATEWAY_CATALOG.map(e => e.id)
    expect(ids.every(id => id.length > 0)).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
    // Chat-executable and reference-only views partition the catalogue exactly.
    expect(UPB_CHAT_MODELS.length + UPB_REFERENCE_ONLY.length).toBe(UPB_GATEWAY_CATALOG.length)
    const partitioned = new Set([...UPB_CHAT_MODELS.map(e => e.id), ...UPB_REFERENCE_ONLY.map(e => e.id)])
    expect(partitioned.size).toBe(UPB_GATEWAY_CATALOG.length)
  })

  it('records a source on every entry', () => {
    expect(UPB_GATEWAY_SNAPSHOT.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    for (const entry of UPB_GATEWAY_CATALOG) {
      expect(entry.source.url.length, entry.id).toBeGreaterThan(0)
      expect(entry.source.snapshot, entry.id).toBe(UPB_GATEWAY_SNAPSHOT.date)
    }
  })

  it('alias and router targets resolve to listed catalogue ids', () => {
    const ids = new Set(UPB_GATEWAY_CATALOG.map(e => e.id))
    for (const entry of UPB_GATEWAY_CATALOG) {
      if (entry.aliasTarget !== undefined) {
        expect(ids.has(entry.aliasTarget), `alias "${entry.id}" -> ${entry.aliasTarget}`).toBe(true)
      }
      for (const targets of Object.values(entry.routedModelMap ?? {})) {
        for (const target of targets) {
          expect(ids.has(target), `router "${entry.id}" -> ${target}`).toBe(true)
        }
      }
    }
  })

  it('keeps fault-tolerant quota math sound across the whole catalogue', () => {
    // A published RPM/TPM tuple must be a positive finite array; 'none' is the
    // explicit spelling for "page publishes nothing".
    for (const entry of UPB_GATEWAY_CATALOG) {
      for (const [field, value] of [['rpm', entry.rpm], ['tpm', entry.tpm]] as const) {
        if (value === undefined || value === 'none') continue
        expect(value.length, `${entry.id} ${field}`).toBeGreaterThan(0)
        for (const n of value) {
          expect(Number.isInteger(n) && n > 0, `${entry.id} ${field} = ${n}`).toBe(true)
        }
      }
      if (entry.maxInputTokens !== undefined) expect(entry.maxInputTokens, entry.id).toBeGreaterThan(0)
      if (entry.maxOutputTokens !== undefined) expect(entry.maxOutputTokens, entry.id).toBeGreaterThan(0)
      if (entry.maxParallel !== undefined) expect(entry.maxParallel, entry.id).toBeGreaterThan(0)
    }
  })

  it('chat-executable entries are chat-interface language or multimodal models', () => {
    for (const entry of UPB_CHAT_MODELS) {
      expect(['llm', 'multimodal'], entry.id).toContain(entry.kind)
      expect(entry.mode, entry.id).toBe('chat')
      expect(entry.apiInterface, entry.id).toBe('chat')
      expect(entry.compatStatus, entry.id).toBe('chat-executable')
    }
  })

  it('exposes every chat model through upbEntryOf', () => {
    for (const entry of UPB_CHAT_MODELS) {
      expect(upbEntryOf(entry.id)?.id, entry.id).toBe(entry.id)
    }
  })
})
