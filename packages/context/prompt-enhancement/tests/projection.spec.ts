/** Enhancement outcomes survive checkpoint replay without becoming model messages. */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { promptEnhancementProjection } from '../src/projection.ts'

describe('prompt enhancement projection', () => {
  it('retains a pending dispatch and the final user-selected text across checkpoint replay', () => {
    const session = Session.create(SessionId('enhancement-projection'))
    const id = brandString<SessionRequestId>('request-1')
    const initial = promptEnhancementProjection.init()
    session.append('prompt-enhancement/request', { id, requestKey: 'request-hash', original: 'Fix parser',
      displayOriginal: 'Fix parser', provider: 'test', model: 'test', system: 'Rewrite', messages: [], maxTokens: 100,
      purpose: 'prompt-enhancement' })
    const pending = session.snapshotEvents().reduce((state, event) => promptEnhancementProjection.apply(state, event), initial)
    expect(pending.entries[id]).toMatchObject({ status: 'pending', original: 'Fix parser' })
    expect(promptEnhancementProjection.wire.view(pending)).toEqual({})
    const checkpoint = promptEnhancementProjection.stateSchema.parse(JSON.parse(JSON.stringify(pending)))
    const cursor = session.seq
    session.append('prompt-enhancement/result', { id, requestKey: 'request-hash', original: 'Fix parser',
      displayOriginal: 'Fix parser', status: 'enhanced', enhanced: 'Fix the parser.', elapsedMs: 1 })
    const reviewed = session.snapshotEvents().slice(cursor)
      .reduce((state, event) => promptEnhancementProjection.apply(state, event), checkpoint)
    expect(promptEnhancementProjection.wire.view(reviewed)).toEqual({})
    session.append('prompt-enhancement/accepted', { id, text: 'Fix the parser and add coverage.' })
    const replayed = session.snapshotEvents().slice(cursor)
      .reduce((state, event) => promptEnhancementProjection.apply(state, event), checkpoint)
    const complete = session.snapshotEvents().reduce((state, event) => promptEnhancementProjection.apply(state, event), initial)
    expect(replayed).toEqual(complete)
    expect(replayed.entries[id]).toMatchObject({ status: 'enhanced', enhanced: 'Fix the parser.',
      submitted: true, submittedText: 'Fix the parser and add coverage.' })
    expect(promptEnhancementProjection.wire.view(replayed)[id]).toMatchObject({ submitted: true })
    expect(promptEnhancementProjection.wire.summary).toBe(false)
    expect(session.deriveMessages()).toEqual([])
  })

  it('ignores acceptance without a corresponding attempt and preserves unrelated state identity', () => {
    const session = Session.create(SessionId('enhancement-unmatched'))
    const initial = promptEnhancementProjection.init()
    const event = session.append('prompt-enhancement/accepted', { id: brandString<SessionRequestId>('missing'), text: 'prompt' })
    expect(promptEnhancementProjection.apply(initial, event)).toBe(initial)
  })
})
