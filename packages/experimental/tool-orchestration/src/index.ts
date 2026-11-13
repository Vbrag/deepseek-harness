/** Scoped model-facing tool over the opt-in Orchestration runtime. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { PoolRoute } from '@deepseek-ai/dsh-orchestration'

/** Cordis plugin name. */
export const name = 'tool-orchestration'
/** Services required by the Orchestration tool plugin. */
export const inject = ['agents', 'orchestrations', 'tools']

/** One provider/model route in the configured Orchestration pool. */
export interface PoolRouteConfig {
  /** Provider route registered on `ctx.llm`; must match a catalogued route. */
  readonly provider: string
  /** Exact API model id passed to the provider; must match a catalogued model. */
  readonly model: string
}

/** Tool routing configuration. */
export interface Config {
  /**
   * Seed pool of provider/model routes: used only to set the service pool when
   * it is empty on plugin load, so a deployment without the GUI panel can still
   * run. Execution always reads the service's selected pool.
   */
  readonly pool: PoolRouteConfig[]
}

/** Loader schema for the opt-in Orchestration tool plugin. */
export const Config: z<Config> = z.object({
  pool: z.array(z.object({
    provider: z.string(),
    model: z.string(),
  })).default([]),
})

const EMPTY_POOL_ERROR = 'run_orchestration: the Orchestration pool is empty; configure a non-empty pool in tool-orchestration'

const MODE_INACTIVE_ERROR = 'run_orchestration: Orchestration mode is not active in this session; select Orchestration mode to delegate'

const ROUTE_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    provider: { type: 'string', required: true },
    model: { type: 'string', required: true },
  },
} as const

const STEPS_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    description: { type: 'string', required: true },
    status: { type: 'string', required: true, enum: ['completed', 'failed'] },
    output: { type: 'string' },
    route: ROUTE_VIEW_SCHEMA,
    domains: { type: 'array', required: true, items: { type: 'string' } },
    failedOver: { type: 'boolean', required: true },
  },
} as const

const ORCHESTRATION_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    succeeded: { type: 'boolean', required: true },
    steps: { type: 'array', required: true, items: STEPS_VALUE_SCHEMA },
    failovers: { type: 'integer', required: true },
    failedSteps: { type: 'integer', required: true },
  },
} as const

/**
 * Declare one canonical output schema with compact model-facing JSON.
 * @param schema - canonical value schema for the tool.
 * @returns the `output` declaration accepted by {@link defineTool}.
 */
function jsonOutput<const S extends ValueSchemaSpec>(schema: S): {
  schema: S
  render: (args: unknown, value: InferValue<S>) => [{ type: 'text'; text: string }]
} {
  return {
    schema,
    render: (_args: unknown, value: InferValue<S>) => [{ type: 'text', text: JSON.stringify(value) }],
  }
}

/** Recover the exact caller guaranteed by Agent-scoped tool discovery. */
function callingAgent(agent: Agent | undefined, toolName: string): Agent {
  /* v8 ignore next 2 -- Orchestration tools are registered only in an exact Agent scope, so discovery supplies this carrier. */
  if (agent === undefined) throw new Error(`${toolName} requires a calling Agent`)
  return agent
}

/** The route actually used by a step's last attempt, for the model-facing view. */
function modelRoute(attempts: readonly { readonly provider: string; readonly model: string }[]): {
  provider: string
  model: string
} {
  const last = attempts.at(-1)
  return { provider: last?.provider ?? 'unknown', model: last?.model ?? 'unknown' }
}

/** Register the Orchestration tool in one exact Agent scope. */
function install(agent: Agent, ctx: Context): () => void {
  const scoped = agent.ctx
  const disposers: Array<() => unknown> = []
  try {
    disposers.push(scoped.tools.register(defineTool({
      name: 'run_orchestration',
      description: 'Split a goal into independent parallel sub-tasks and run them across the selected model pool, failing over a failed worker to the next eligible model route instead of failing the whole run.',
      parameters: {
        task: { type: 'string', required: true, description: 'Complete, self-contained goal to decompose and execute.' },
      },
      output: jsonOutput(ORCHESTRATION_VALUE_SCHEMA),
      async execute(args, exec) {
        const caller = callingAgent(exec.agent, 'run_orchestration')
        // The mode is the delegation gate: in the default (non-Orchestration)
        // mode the tool refuses so a normal single-model run is not silently
        // replaced, and only an active Orchestration selection delegates.
        if (!ctx.orchestrations.modeOf(caller)) throw new Error(MODE_INACTIVE_ERROR)
        // Read the selected pool from the service at execution time so the
        // GUI-chosen pool drives every run; config only seeds an empty pool.
        const pool: readonly PoolRoute[] = ctx.orchestrations.getPool()
        if (pool.length === 0) throw new Error(EMPTY_POOL_ERROR)
        const result = await ctx.orchestrations.run(caller, args.task, pool, exec.signal)
        return {
          succeeded: result.succeeded,
          failovers: result.failovers,
          failedSteps: result.failedSteps,
          steps: result.steps.map(step => ({
            id: step.step.id,
            description: step.step.description,
            status: step.failed ? 'failed' as const : 'completed' as const,
            failedOver: step.failedOver,
            domains: [...step.step.requiredDomains],
            ...(step.output.length > 0
              ? { output: step.output.filter(b => b.type === 'text').map(b => b.text).join('\n') }
              : {}),
            route: modelRoute(step.attempts),
          })),
        }
      },
    })))
  } catch (error: unknown) {
    /* v8 ignore next 1 -- run_orchestration registers exactly one tool, so a failed registration leaves an empty disposer list */
    for (const dispose of disposers.reverse()) void dispose()
    throw error
  }
  return () => {
    for (const dispose of disposers.reverse()) void dispose()
  }
}

/**
 * Install the Orchestration tool in every live or subsequently published
 * Agent scope. The tool reads the GUI/service-selected pool at execution and
 * fails loud on an empty pool; the configured pool here only seeds the service
 * pool when it is empty, so a deployment without the GUI panel can still run.
 */
export function apply(ctx: Context, config: Config): void {
  // Seed the service pool from config only when nothing is selected yet, so a
  // later GUI selection is never overridden by this static configuration.
  if (ctx.orchestrations.getPool().length === 0 && config.pool.length > 0) {
    ctx.orchestrations.setPool(config.pool)
  }
  const installed = new Map<Agent, () => void>()
  const maybeInstall = (agent: Agent): void => {
    if (installed.has(agent)) return
    installed.set(agent, install(agent, ctx))
  }
  for (const agent of ctx.agents.list()) maybeInstall(agent)
  ctx.on('agent/created', ({ agent }) => { maybeInstall(agent) })
  ctx.on('agent/disposed', ({ agent }) => {
    installed.get(agent)?.()
    installed.delete(agent)
  })
  ctx.effect(() => () => {
    for (const dispose of installed.values()) dispose()
    installed.clear()
  }, 'tool-orchestration.scopedTools()')
}

/** The loud error thrown by a pool-less run_orchestration call. */
export { EMPTY_POOL_ERROR, MODE_INACTIVE_ERROR }
