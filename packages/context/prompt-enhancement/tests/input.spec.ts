import { describe, expect, it } from 'vitest'
import { containsCredential, enhancementInput, retainsLiterals, selectContext } from '../src/input.ts'

describe('enhancement input', () => {
  it('selects relevant bounded context without credential-bearing sections', () => {
    const candidates = [
      { source: 'orchestration', text: 'Billing recovery keeps completed tool results.' },
      { source: 'unrelated', text: 'A different feature.' },
      { source: 'orchestration', text: 'api_key=abcdefghijklmnop billing' },
    ]
    expect(selectContext('fix orchestration billing', candidates, 200)).toEqual([candidates[0]])
    expect(selectContext('fix orchestration billing', candidates, 2)).toEqual([])
    expect(containsCredential(candidates[2]!.text)).toBe(true)
    expect(JSON.parse(enhancementInput('fix it', [], ['notes.txt']))).toEqual({
      original: 'fix it', context: [], attachments: ['notes.txt'],
    })
  })

  it('rejects a replacement that loses protected code, URLs, or numbers', () => {
    const original = 'Change `src/a.ts` to use 42 and see https://example.com/test'
    expect(retainsLiterals(original, 'Change `src/a.ts` to use 42; see https://example.com/test')).toBe(true)
    expect(retainsLiterals(original, 'Change the file to use 43')).toBe(false)
    expect(retainsLiterals(original, ' ')).toBe(false)
  })
})
