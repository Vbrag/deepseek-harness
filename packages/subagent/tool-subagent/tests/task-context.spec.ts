/** Structured task assessment and explicit stored image handoff. */

import { describe, expect, it, vi } from 'vitest'
import AttachmentStore, { AttachmentError } from '@deepseek-ai/dsh-attachment'
import type { AttachmentId, ImageAttachmentRef, ImageAttachmentLimits, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { brandString } from '@deepseek-ai/dsh-brand'
import { assembleContextFor, type Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { callSubagent, modelSelectionSetupAgent, ownContext, setup } from './harness.ts'
import * as tool from '../src/index.ts'
import { mountLocalActivations } from '../../subagent/tests/local-activation.ts'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const IMAGE: ImageAttachmentRef = {
  attachmentId: brandString<AttachmentId>('sha256:' + 'a'.repeat(64)),
  mediaType: 'image/png', bytes: 1, width: 1, height: 1,
}

/** Stored-image fixture using the real shared prompt admission policy. */
class StoredImages extends AttachmentStore {
  readonly imageLimits: ImageAttachmentLimits = {
    maxImageBytes: 10, maxImagesPerMessage: 2, maxMessageImageBytes: 10,
    maxImagePixels: 10, maxImageDimension: 10, mediaTypes: ['image/png'],
  }

  validateImage(): Promise<void> { throw new Error('fixture accepts only stored images') }
  saveImage(): Promise<ImageAttachmentRef> { throw new Error('fixture accepts only stored images') }
  readImage(ref: ImageAttachmentRef): Promise<StoredImageAttachment> {
    return Promise.resolve({ ref, data: new Uint8Array(ref.bytes) })
  }
}

describe('subagent task context', () => {
  it('forwards assessed requirements and only explicitly selected stored images', async () => {
    const started = vi.fn((_request: SubagentStartRequest) => {})
    const ctx = await setup({ provider: 'mock' }, { onStart: started })
    const parent = modelSelectionSetupAgent(ctx)
    const second = { ...IMAGE, attachmentId: brandString<AttachmentId>('sha256:' + 'b'.repeat(64)) }
    const earlier = parent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [
      { type: 'image', attachment: IMAGE },
    ] }), { surfaceOp: 'append' })
    parent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [
      { type: 'image', attachment: second },
    ] }), { surfaceOp: 'append' })
    expect(ctx.subagents.contextImagesOf(parent.session)).toEqual([IMAGE, second])
    const assembly = await ctx.systemPrompt.assemble(assembleContextFor(parent))
    const guidance = assembly.contexts.find(context => context.name === 'tool:subagent:images')?.text
    expect(guidance).toContain(IMAGE.attachmentId)
    expect(guidance).toContain(second.attachmentId)
    await ctx.plugin(StoredImages)
    const readImage = vi.spyOn(ctx.attachments, 'readImage')
    const admission = vi.spyOn(ctx.attachments, 'admitPromptContent')
    const task_assessment = { requiredCapabilities: ['coding', 'vision'], requiredModalities: ['image'], contextTokens: 1000 }
    const result = await callSubagent(ctx, {
      description: 'edit the design', prompt: 'match the selected reference', task_assessment,
      context_image_ids: [IMAGE.attachmentId],
    })
    expect(result.isError).not.toBe(true)
    expect(started.mock.calls[0]?.[0]).toMatchObject({
      taskAssessment: task_assessment,
      prompt: [{ type: 'text', text: 'match the selected reference' }, { type: 'image', attachment: IMAGE }],
    })
    expect(readImage).toHaveBeenCalledExactlyOnceWith(IMAGE, expect.any(AbortSignal))
    expect(admission).toHaveBeenCalledExactlyOnceWith([
      { type: 'text', text: 'match the selected reference' }, { type: 'image', attachment: IMAGE, encodedBytes: IMAGE.bytes },
    ])
    parent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'image removed' }] }), {
      surfaceOp: { op: 'replace', startSeq: earlier.seq, endSeq: earlier.seq }, sourceEventSeqs: [earlier.seq],
    })
    expect(ctx.subagents.contextImagesOf(parent.session)).toEqual([second])
  })

  it('records and sends selected images to a real spawned child through shared admission', async () => {
    const ctx = ownContext(new Context())
    await mountAgentLoopTestDependencies(ctx)
    await mountLocalActivations(ctx)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(StoredImages)
    await ctx.plugin(Spawn, { providerName: 'spawn' })
    await ctx.plugin(tool, { provider: 'spawn' })
    const adapter = new MockAdapter([textResponse('child done'), textResponse('parent done')])
    vi.spyOn(adapter, 'resolveModel').mockImplementation((provider, model) => Promise.resolve({
      provider, id: model, name: model, inputModalities: ['text', 'image'],
    }))
    ctx.llm.registerAdapter(['mock'], adapter)
    const { agent: parent } = await ctx.agents.create({
      sessionId: brandString<SessionId>('image-context-parent'), agentOptions: { provider: 'mock', model: 'vision' },
    })
    const other = { ...IMAGE, attachmentId: brandString<AttachmentId>('sha256:' + 'b'.repeat(64)) }
    parent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [
      { type: 'image', attachment: IMAGE }, { type: 'image', attachment: other },
    ] }), { surfaceOp: 'append' })
    const created = Promise.withResolvers<Agent>()
    ctx.on('agent/created', ({ agent }) => {
      if (agent.session.header.parentSession === parent.id) created.resolve(agent)
    })
    const result = await callSubagent(ctx, {
      description: 'review selected design', prompt: 'match this reference', context_image_ids: [IMAGE.attachmentId],
    }, { agent: parent })
    expect(result.isError).not.toBe(true)
    const child = await created.promise
    await child.whenIdle()
    const initial = child.session.snapshotEvents().find(event => event.type === 'user/message')
    expect(initial?.type === 'user/message' && initial.data.content.filter(block => block.type === 'image'))
      .toEqual([{ type: 'image', attachment: IMAGE }])
    const request = adapter.requests.find(request => request.sessionId === child.id)
    expect(request?.messages.flatMap(message => message.content).filter(block => block.type === 'image'))
      .toEqual([{ type: 'image', attachment: IMAGE }])
  })

  it('refuses a selected image batch that exceeds shared admission limits before starting a child', async () => {
    const started = vi.fn((_request: SubagentStartRequest) => {})
    const ctx = await setup({ provider: 'mock' }, { onStart: started })
    await ctx.plugin(StoredImages)
    ctx.attachments.imageLimits.maxImagesPerMessage = 1
    const parent = modelSelectionSetupAgent(ctx)
    const other = { ...IMAGE, attachmentId: brandString<AttachmentId>('sha256:' + 'b'.repeat(64)) }
    parent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [
      { type: 'image', attachment: IMAGE }, { type: 'image', attachment: other },
    ] }), { surfaceOp: 'append' })
    const result = await callSubagent(ctx, {
      description: 'two image task', prompt: 'compare', context_image_ids: [IMAGE.attachmentId, other.attachmentId],
    })
    expect(result.error?.info).toEqual({ name: AttachmentError.name, code: 'TOO_MANY_IMAGES' })
    expect(started).not.toHaveBeenCalled()
  })

  it('rejects images outside retained parent context before startup', async () => {
    const started = vi.fn((_request: SubagentStartRequest) => {})
    const ctx = await setup({ provider: 'mock' }, { onStart: started })
    ctx.provide('attachments', { readImage: vi.fn() } as never)
    const result = await callSubagent(ctx, {
      description: 'unknown image', prompt: 'inspect it', context_image_ids: [IMAGE.attachmentId],
    })
    expect(result.isError).toBe(true)
    expect(result.error?.info).toEqual({ name: 'ToolArgsError', code: 'INVALID_ARGS' })
    expect(started).not.toHaveBeenCalled()
  })

  it('does not forward unselected images', async () => {
    const started = vi.fn((_request: SubagentStartRequest) => {})
    const ctx = await setup({ provider: 'mock' }, { onStart: started })
    modelSelectionSetupAgent(ctx).session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'image', attachment: IMAGE }] }), { surfaceOp: 'append' })
    await callSubagent(ctx, { description: 'text task', prompt: 'inspect code' })
    expect(started.mock.calls[0]?.[0].prompt).toEqual([{ type: 'text', text: 'inspect code' }])
  })

  it.each([-1, Number.MAX_SAFE_INTEGER + 1])('rejects an invalid expected context token count: %s', async (contextTokens) => {
    const started = vi.fn((_request: SubagentStartRequest) => {})
    const ctx = await setup({ provider: 'mock' }, { onStart: started })
    const result = await callSubagent(ctx, {
      description: 'bad assessment', prompt: 'inspect code',
      task_assessment: { requiredCapabilities: ['coding'], contextTokens },
    })
    expect(result.error?.info).toEqual({ name: 'ToolArgsError', code: 'INVALID_ARGS' })
    expect(started).not.toHaveBeenCalled()
  })

  it.each([0, -1, Number.MAX_SAFE_INTEGER + 1])('rejects an invalid expected response token count: %s', async (outputTokens) => {
    const started = vi.fn((_request: SubagentStartRequest) => {})
    const ctx = await setup({ provider: 'mock' }, { onStart: started })
    const result = await callSubagent(ctx, {
      description: 'bad response estimate', prompt: 'inspect code',
      task_assessment: { requiredCapabilities: ['coding'], contextTokens: 0, outputTokens },
    })
    expect(result.error?.info).toEqual({ name: 'ToolArgsError', code: 'INVALID_ARGS' })
    expect(started).not.toHaveBeenCalled()
  })
})
