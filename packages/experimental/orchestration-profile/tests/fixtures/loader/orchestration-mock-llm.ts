/** Deterministic model responses for real-profile subagent routing smokes. */
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'

class OrchestrationMockAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return {
      provider, id: model, name: model,
      context: { contextWindow: 128_000 },
      inputModalities: model === 'gwdg.glm-5.3-flash' || model === 'lead' ? ['text'] : ['text', 'image'],
    }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
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
