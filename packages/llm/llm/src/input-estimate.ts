/** Provider-neutral pacing estimates shared by task admission and adapter dispatch. */
import type { ContentBlock, ToolSchema } from './types.ts'

/**
 * Estimate input tokens from text and image counts.
 * @param chars - serialized text character count.
 * @param images - image occurrences.
 * @returns conservative heuristic input-token count.
 */
export function estimateInputTokens(chars: number, images: number): number {
  // ~4 characters per token is the common English heuristic; images reserve a
  // conservative flat allowance because the harness has no provider tokenizer.
  return Math.ceil(chars / 4) + images * 1000
}

/** The only message field the input estimator reads: its content blocks. */
interface MessageContent {
  readonly content: readonly ContentBlock[]
}

/** Count the text characters and inline images in one serialized message. */
function countContent(content: readonly ContentBlock[], acc: { chars: number; images: number }): void {
  for (const block of content) {
    switch (block.type) {
      case 'text': acc.chars += block.text.length; break
      case 'reasoning': acc.chars += block.text.length; break
      case 'tool-call': acc.chars += block.name.length + block.arguments.length; break
      case 'image': acc.images += 1; break
      case 'file': acc.chars += block.attachment.name.length; break
      // tool-addition / tool-removal: negligible representation
      default: break
    }
  }
}

/**
 * Estimate the input tokens a whole request will consume, from its messages,
 * initial system prompt, and tool declarations. This is a pacing estimate only:
 * true usage is reconciled from the provider's reported usage. It reads only
 * each message's content blocks, so any message-shaped value — a full harness
 * message or a minimal `{ content }` — is accepted.
 * @param messages - the conversation messages.
 * @param system - the initial system prompt text, when set.
 * @param tools - tool declarations, when any.
 * @returns estimated input tokens.
 */
export function estimateRequestInputTokens(
  messages: readonly MessageContent[],
  system?: string,
  tools?: readonly ToolSchema[],
): number {
  const acc = { chars: system?.length ?? 0, images: 0 }
  for (const message of messages) countContent(message.content, acc)
  for (const tool of tools ?? []) acc.chars += tool.name.length + tool.description.length + JSON.stringify(tool.parameters).length
  return estimateInputTokens(acc.chars, acc.images)
}
