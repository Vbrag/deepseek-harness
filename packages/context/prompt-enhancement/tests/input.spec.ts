import { describe, expect, it } from 'vitest'
import { containsCredential, enhancementInput, retainsLiterals, selectContext, withinPromptLimits } from '../src/input.ts'

describe('enhancement input', () => {
  it('applies inclusive Unicode word and character limits', () => {
    expect(withinPromptLimits('word '.repeat(100).trim(), 100, 2000)).toBe(true)
    expect(withinPromptLimits('word '.repeat(101).trim(), 100, 2000)).toBe(false)
    expect(withinPromptLimits('x'.repeat(2000), 100, 2000)).toBe(true)
    expect(withinPromptLimits('x'.repeat(2001), 100, 2000)).toBe(false)
    expect(withinPromptLimits('你好 世界', 2, 5)).toBe(true)
    expect(withinPromptLimits('你好 世界', 1, 5)).toBe(false)
    expect(withinPromptLimits('😀😀', 1, 2)).toBe(true)
    expect(withinPromptLimits('😀😀😀', 1, 2)).toBe(false)
  })

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

  it('recognizes each supported credential form without treating ordinary text as a credential', () => {
    const examples = [
      '-----BEGIN PRIVATE KEY-----',
      'sk-abcdefghijklmnopqrst',
      'ghp_abcdefghijklmnopqrst',
      'AKIA1234567890ABCDEF',
      'Bearer abcdefghijklmnop',
      'password=abcdefghijklmnop',
    ]
    for (const example of examples) expect(containsCredential(example)).toBe(true)
    expect(containsCredential('The parser uses a password field.')).toBe(false)
  })

  it('rejects a replacement that loses protected code, URLs, or numbers', () => {
    const original = 'Change `src/a.ts` to use 42 and see https://example.com/test'
    expect(retainsLiterals(original, 'Change `src/a.ts` to use 42; see https://example.com/test')).toBe(true)
    expect(retainsLiterals(original, 'Change the file to use 43')).toBe(false)
    expect(retainsLiterals(original, ' ')).toBe(false)
  })
})
