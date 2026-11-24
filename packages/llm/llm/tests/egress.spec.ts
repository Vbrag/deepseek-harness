import { expect, it } from 'vitest'
import { describeLlmEgress } from '../src/egress.ts'

it('compares endpoint paths without exposing them in the display label', () => {
  const first = describeLlmEgress('provider', 'api', 'https://example.com/one')
  const same = describeLlmEgress('provider', 'api', 'https://example.com/one')
  const other = describeLlmEgress('provider', 'api', 'https://example.com/two')
  expect(first?.egressLabel).toBe('https://example.com')
  expect(first?.egressId).toBe(same?.egressId)
  expect(first?.egressId).not.toBe(other?.egressId)
})

it('does not persist fingerprints of endpoint URLs with credentials or queries', () => {
  expect(describeLlmEgress('provider', 'api', 'https://user:secret@example.com/route?key=secret'))
    .toEqual({ egressLabel: 'https://example.com' })
  expect(describeLlmEgress('provider', 'api', 'not a URL')).toBeUndefined()
})
