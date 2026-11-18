/** Select an installed shell for one isolated fixture without changing its recorded command. */
import { delimiter } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-shell'

export const name = 'snapshot-shell-path-prefix'
export const inject = ['shell']

/** Directory searched before the fixture process's ordinary executable path. */
export interface Config {
  /** Installed shell directory supplied by the fixture deployment. */
  directory: string
}

/** Prefix only this fixture's shell-call environment with its installed shell directory.
 * @param ctx - Effect owner of the shell executor wrapper.
 * @param config - Explicit directory searched before the ambient executable path.
 */
export function apply(ctx: Context, config: Config): void {
  if (typeof config.directory !== 'string' || config.directory.trim() === '') {
    throw new Error('snapshot-shell-path-prefix: directory must be a nonempty string')
  }
  const shell = ctx.shell
  // oxlint-disable-next-line typescript/unbound-method -- Preserve identity; invocation binds the original receiver.
  const execute = shell.execute
  const pathKey = Object.keys(process.env).find(key => key.toUpperCase() === 'PATH') ?? 'PATH'
  ctx.effect(() => {
    const lifetime = new AbortController()
    const jobs = new Set<Promise<void>>()
    shell.execute = (spec) => {
      lifetime.signal.throwIfAborted()
      const entries = Object.entries(spec.env ?? {})
      const path = entries.find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? process.env[pathKey] ?? ''
      const execution = execute.call(shell, {
        ...spec,
        signal: spec.signal === undefined ? lifetime.signal : AbortSignal.any([spec.signal, lifetime.signal]),
        env: {
          ...Object.fromEntries(entries.filter(([key]) => key.toUpperCase() !== 'PATH')),
          [pathKey]: `${config.directory}${delimiter}${path}`,
        },
      })
      const settled = execution.then(handle => handle.done, () => undefined)
      jobs.add(settled)
      void settled.then(() => jobs.delete(settled), () => jobs.delete(settled))
      return execution
    }
    return async () => {
      lifetime.abort()
      shell.execute = execute
      await Promise.allSettled([...jobs])
    }
  })
}
