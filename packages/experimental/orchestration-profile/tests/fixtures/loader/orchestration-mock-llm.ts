/**
 * Keyless LLM adapter for the orchestration Loader boot test. It owns the only
 * nondeterministic inputs in the run — the model streams — and makes them
 * deterministic so a real subagent spawn can prove capability-matched route
 * failover: a coding step's first worker model settles with a server error and
 * the orchestrator fails over to the next, capability-similar model, which
 * completes the step.
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  LlmAdapter,
  ReasoningEffortId,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

const HIGH = ReasoningEffortId('high')
const OFF = ReasoningEffortId('off')

/** First pool worker model: settles with a server error to trigger failover. */
const FAILING_MODEL = 'gwdg.glm-5.3-flash'
/** Second pool worker model: capability-similar and completes the step. */
const BACKUP_MODEL = 'gwdg.qwen3-coder-next'

/** One coding step plan the coordinator returns, mirrors the real plan JSON contract. */
const PLAN_JSON = JSON.stringify([
  { description: 'Write a hello world program in Rust', requiredDomains: ['coding'] },
])

/**
 * Distinguish the coordinator call from a spawned worker call. The coordinator
 * (`coordinate` in dsh-orchestration) is the only caller that sets a `system`
 * carrying `availableDomains`; loop-built worker requests carry the system
 * prompt inside `messages` and leave `options.system` undefined.
 */
function isCoordinatorCall(options: GenerateOptions): boolean {
  return options.system?.includes('availableDomains') === true
}

/**
 * Emit one text block containing `reply` followed by a clean stop finish.
 */
function* textTurn(reply: string, inputTokens: number, outputTokens: number): Generator<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text: reply }
  yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
  yield { type: 'usage', usage: { inputTokens, outputTokens } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

/** Orchestration test adapter backed by {@link FAILING_MODEL} and {@link BACKUP_MODEL}. */
class OrchestrationMockAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return {
      provider,
      id: model,
      name: model,
      reasoning: {
        efforts: [
          { id: OFF, name: 'Off' },
          { id: HIGH, name: 'High' },
        ],
        defaultEffort: HIGH,
      },
    }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (isCoordinatorCall(options)) {
      yield* textTurn(PLAN_JSON, 24, 14)
      return
    }
    // A spawned worker (the real subagent spawn) runs this adapter through its own agent.
    if (options.model === FAILING_MODEL) {
      // Settled failure -> the child turn/end records reason error -> stopReason 'error' -> failover eligible.
      // A non-default retryable code (NOT in llm-retry's default set) so the worker settles
      // immediately instead of entering the provider retry loop.
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'MODEL_FAILED', message: 'orchestration mock first worker failed' } } }
      return
    }
    if (options.model === BACKUP_MODEL) {
      yield* textTurn('Hello, world!', 11, 4)
      return
    }
    // Any other model: fail loud so the test cannot silently route elsewhere.
    yield { type: 'finish', reason: { kind: 'error', failure: { code: 'UNKNOWN_MODEL', message: `unexpected orchestration model: ${options.model}` } } }
  }
}

export const name = 'orchestration-mock-llm'
export const inject = ['llm']

/** Register the deterministic {@link FAILING_MODEL}/{@link BACKUP_MODEL} adapter. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['orchestration-mock'], new OrchestrationMockAdapter())
}
