import { expect, it } from 'vitest'
import { changedSpan, sourceRequestId } from '../src/client/Components.tsx'

it('retains Unicode characters and identifies removed and added text', () => {
  const diff = changedSpan('Fix 🐳 now', 'Fix 🐳 safely now')
  expect(diff.before + diff.removed + diff.after).toBe('Fix 🐳 now')
  expect(diff.before + diff.changed + diff.after).toBe('Fix 🐳 safely now')
  expect(diff.changed).toBe('safely ')
  expect(changedSpan('Remove old text', 'Remove text').removed).toBe('old ')
})

it('recognizes only correlated user-message sources', () => {
  expect(sourceRequestId({ kind: 'user', rpcId: 'request-1' })).toBe('request-1')
  expect(sourceRequestId({ kind: 'retry', rpcId: 'request-1' })).toBeNull()
  expect(sourceRequestId({ kind: 'user', rpcId: 7 })).toBeNull()
  expect(sourceRequestId(null)).toBeNull()
})
