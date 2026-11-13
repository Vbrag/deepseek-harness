/**
 * The coordinator: turns one raw task into a concrete plan by streaming a
 * single read-only model call over the parent's current route. The call is
 * not logged to a Session; neither this call nor its plan is durable.
 *
 * @module @deepseek-ai/dsh-orchestration/coordinator
 */

import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Modality, TaskDomain } from './capabilities.ts'
import type { OrchestrationStepId, PlannedStep } from './types.ts'

/** Create one branded step id for a plan entry. */
export function createStepId(suffix: number): OrchestrationStepId {
  return brandString<OrchestrationStepId>(`step-${suffix}`)
}

/** Marker refusing to start when the coordinator produced no usable plan. */
export class CoordinatorError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CoordinatorError'
  }
}

const PLAN_PROMPT = `You decompose one goal into independent subtasks and assign each a capability domain.

Rules:
- Split the goal into the smallest set of self-contained subtasks that can run in parallel, with no hidden ordering dependence.
- Each subtask must stand alone as a prompt to a fresh worker with no conversation history.
- Only use domain labels from the exact set provided; omit a domain when none applies.
- A subtask that needs image/screenshot/visual review must use the "vision" domain; coding must use "coding"; complex analysis must use "reasoning".
- When a subtask needs a non-text input modality (image, audio, video), set "requiredModalities" from the exact set provided and omit it for pure-text subtasks.
- When a subtask must retain a large conversation or file context, set "contextTokens" to a conservative estimate of the input tokens it needs (0 when unknown).
- Respond with ONLY a JSON array, no prose, no code fences. Each element: {"description":"...","requiredDomains":["..."],"requiredModalities":["..."],"contextTokens":0}.

Provide the exact pool domains and modalities in the "availableDomains"/"availableModalities" system lines.`

/**
 * Assemble raw chunks into the coordinator's final assistant text block.
 * Mirrors the shared BlockAssembler contract: the last text block is the reply.
 */
function assembleReply(chunks: AsyncIterable<StreamChunk>): Promise<string> {
  return (async () => {
    let text = ''
    let finished = false
    for await (const chunk of chunks) {
      if (chunk.type === 'text-delta') text += chunk.text
      else if (chunk.type === 'finish') {
        finished = true
        if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted') {
          throw new CoordinatorError(`coordinator call failed (${chunk.reason.failure.code})`)
        }
      }
    }
    if (!finished) throw new CoordinatorError('coordinator emitted no terminal finish')
    return text
  })()
}

/**
 * Parse and validate the coordinator's JSON reply into planned steps. Any
 * malformed entry rejects the whole plan so a partial split never starts.
 * @param raw - untrusted coordinator text.
 * @returns validated, ordered steps.
 */
export function parsePlan(raw: string): PlannedStep[] {
  const trimmed = raw.trim()
  const stripped = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let value: unknown
  try {
    value = JSON.parse(stripped)
  } catch {
    throw new CoordinatorError('coordinator returned unparseable plan JSON')
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new CoordinatorError('coordinator returned an empty or non-array plan')
  }
  const steps: PlannedStep[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) throw new CoordinatorError('plan entry is not an object')
    const { description, requiredDomains, requiredModalities, contextTokens } = entry as {
      description?: unknown
      requiredDomains?: unknown
      requiredModalities?: unknown
      contextTokens?: unknown
    }
    if (typeof description !== 'string' || description.trim().length === 0) {
      throw new CoordinatorError('plan entry has no non-empty description')
    }
    const domains = requirements(requiredDomains, isTaskDomain, 'requiredDomains')
    const modalities = requirements(requiredModalities, isModality, 'requiredModalities')
    if (contextTokens !== undefined && (typeof contextTokens !== 'number' || !Number.isSafeInteger(contextTokens) || contextTokens < 0)) {
      throw new CoordinatorError('contextTokens must be a non-negative safe integer')
    }
    const tokens = contextTokens
    steps.push({
      ...(modalities.length === 0 ? {} : { requiredModalities: modalities }),
      ...(tokens === undefined ? {} : { contextTokens: tokens }),
      id: createStepId(steps.length + 1),
      description: description.trim(),
      requiredDomains: domains,
    })
  }
  return steps
}

/** Missing requirements are unconstrained; malformed requirements reject the whole plan. */
function requirements<T extends string>(value: unknown, member: (value: unknown) => value is T, field: string): T[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new CoordinatorError(`${field} must be an array`)
  const result: T[] = []
  for (const item of value) {
    if (!member(item)) throw new CoordinatorError(`${field} contains an unsupported requirement`)
    result.push(item)
  }
  return result
}

/** Whether a value is a known capability domain. */
export function isTaskDomain(value: unknown): value is TaskDomain {
  return typeof value === 'string' && (TASK_DOMAINS as readonly string[]).includes(value)
}

/** Every capability domain the coordinator can assign. */
export const TASK_DOMAINS: readonly TaskDomain[] = ['coding', 'reasoning', 'vision', 'allrounder', 'european']

/** Every input modality the coordinator can request for a step. */
export const TASK_MODALITIES: readonly Modality[] = ['text', 'image', 'audio', 'video']

/** Whether a value is a known input modality. */
export function isModality(value: unknown): value is Modality {
  return typeof value === 'string' && (TASK_MODALITIES as readonly string[]).includes(value)
}

/**
 * Decompose one task into a plan. Uses the coordinator route supplied by the
 * caller, typically the parent agent's currently selected model route.
 * @param ctx - active context with `ctx.llm`.
 * @param options - the coordinator streaming request.
 * @param availableDomains - capability domains usable by the plan, from the selected pool.
 * @returns the validated plan.
 */
export async function coordinate(
  ctx: Context,
  options: Omit<GenerateOptions, 'messages' | 'temperature' | 'system' | 'provider' | 'model'> & {
    readonly route: {
      readonly provider: string
      readonly model: string
      readonly reasoningEffort?: GenerateOptions['reasoningEffort']
    }
    readonly task: string
  },
  availableDomains: readonly TaskDomain[],
  availableModalities: readonly Modality[] = TASK_MODALITIES,
): Promise<PlannedStep[]> {
  const { route, task, ...rest } = options
  const system = `${PLAN_PROMPT}\n\navailableDomains: ${JSON.stringify(availableDomains)}\navailableModalities: ${JSON.stringify(availableModalities)}`
  const request: GenerateOptions = {
    provider: route.provider,
    model: route.model,
    ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort }),
    system,
    temperature: 0,
    messages: [{ role: 'user', content: [{ type: 'text', text: task }] }],
    ...rest,
  }
  const reply = await assembleReply(ctx.llm.stream(request))
  return parsePlan(reply)
}
