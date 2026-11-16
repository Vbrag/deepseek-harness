/** Shared project discovery and the scoped instruction-loader configuration query. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Scoped } from '@deepseek-ai/dsh-scope'

export { findProjectRoot, discoverBaselineInstructionFiles } from './files.ts'
export { resolveDiscoveryConfig, resolveProjectContextFileName } from './config.ts'
export type { InstructionFile } from './files.ts'
export type { ResolvedDiscoveryConfig } from './config.ts'

/** Exact active loader choices used to validate project-context writers. */
export interface AgentInstructionDiscovery {
  readonly projectContextFileName: string
  readonly projectRootMarkers: readonly string[]
  readonly instructionFileCandidates: readonly string[]
  readonly localInstructionFileCandidates: readonly string[]
  readonly enabled: boolean
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Read the instruction loader selected by the requesting Agent's scope.
     * @param payload.agent - Agent whose loader must admit the written project file.
     * @returns active discovery settings, or undefined when no loader is mounted.
     * @mode bail
     */
    'agent-instructions/discovery'(this: Scoped<Agent>, payload: { agent: Agent }): AgentInstructionDiscovery | undefined
  }
}
