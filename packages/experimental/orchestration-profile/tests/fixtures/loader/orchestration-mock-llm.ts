/** Deterministic model responses for real-profile subagent routing smokes. */
import { randomUUID } from 'node:crypto'
import { appendFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { LlmAdapter, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk, type ToolCallId } from '@deepseek-ai/dsh-llm'

class OrchestrationMockAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return {
      provider, id: model, name: model,
      context: { contextWindow: 128_000 },
      inputModalities: model === 'gwdg.glm-5.3-flash' || model === 'lead' ? ['text'] : ['text', 'image'],
    }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.tools?.some(tool => tool.name === 'project_context_update')) {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: {
        type: 'tool-call', id: brandString<ToolCallId>(randomUUID()), name: 'project_context_update',
        arguments: JSON.stringify({ outcome: 'deferred', summary: 'This isolated routing probe contains no project implementation to document.' }),
      } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    if (options.purpose === undefined) {
      const context = options.messages.findLast(message => message.role === 'user'
        && 'source' in message && message.source.kind === 'runtime-context')
      await appendFile('model-requests.jsonl', `${JSON.stringify({
        sessionId: options.sessionId,
        model: options.model,
        context: context?.content.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? '',
      })}\n`)
    }
    const text = `ran:${options.model}`
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 4 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'orchestration-mock-llm'
export const inject = ['llm']

/**
 * Register a deterministic adapter for the smoke's exact model routes.
 * @param ctx - Host context with the LLM registry.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['orchestration-mock'], new OrchestrationMockAdapter())
}
