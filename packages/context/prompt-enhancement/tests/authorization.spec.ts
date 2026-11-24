/** Non-owner peers cannot approve or initiate prompt enhancement. */
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { PeerId, RemoteInvocation } from '@deepseek-ai/dsh-typert-protocol'
import { expect, it, onTestFinished } from 'vitest'
import { PromptEnhancementRemote } from '../src/index.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface PrincipalMap {
    /** A peer without ownership of the active profile. */
    'enhancement-guest': { readonly kind: 'enhancement-guest' }
  }
}

it('refuses settings and request access before reading the Session or provider', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const signal = new AbortController().signal
  const invocation = {
    request: { namespace: 'promptEnhancement', method: 'preflight', args: {} },
    service: 'promptEnhancementRemote',
    peer: { id: 'guest' as PeerId, ctx, principal: { kind: 'enhancement-guest' },
      interactions: 'answer', signal, dispose: async () => {} },
    signal,
    uplink: <In>(): AsyncIterable<In> => ({ [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }) }),
  } satisfies RemoteInvocation
  const remote = new PromptEnhancementRemote(ctx.extend({ invocation }))
  expect(() => remote.preferences()).toThrow(expect.objectContaining({ code: 'prompt-enhancement/owner-required' }))
  await expect(remote.preflight({ sessionId: SessionId('session'), id: brandString<SessionRequestId>('request'),
    original: 'Prompt', displayOriginal: 'Prompt' }, signal))
    .rejects.toMatchObject({ code: 'prompt-enhancement/owner-required' })
})
