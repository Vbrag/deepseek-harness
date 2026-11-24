/** Credential-safe provider endpoint identity and display label. */
import { createHash } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { LlmEgressId } from './types.ts'

/** Identify one concrete HTTP endpoint without exposing its path, credentials, or query.
 * @param provider - Registered provider route.
 * @param protocol - Adapter API protocol.
 * @param endpoint - Resolved endpoint URL.
 * @returns A credential-free origin and, when no URL credentials or query are present, a stable fingerprint.
 */
export function describeLlmEgress(provider: string, protocol: string, endpoint: string):
  { readonly egressId?: LlmEgressId; readonly egressLabel: string } | undefined {
  let parsed: URL
  try { parsed = new URL(endpoint) } catch { return undefined }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined
  if (parsed.username !== '' || parsed.password !== '' || parsed.search !== '' || parsed.hash !== '') {
    return { egressLabel: parsed.origin }
  }
  return {
    egressId: brandString<LlmEgressId>(createHash('sha256').update(JSON.stringify([provider, protocol, parsed.href])).digest('hex')),
    egressLabel: parsed.origin,
  }
}
