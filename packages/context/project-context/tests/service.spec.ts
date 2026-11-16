/** Live AgentFactory finalization through ordinary tool admission and real guarded files. */

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { expect, it, onTestFinished, vi } from 'vitest'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import * as Instructions from '@deepseek-ai/dsh-agent-instructions'
import FsSandbox from '@deepseek-ai/dsh-fs-sandbox'
import FsLocal from '@deepseek-ai/dsh-fs-local'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import { createUserMessage, LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import ProjectContext from '../src/index.ts'
import type { ProjectContextUpdateRequest } from '../src/types.ts'

function failedToolResult(event: SessionEvent): event is Extract<SessionEvent, { type: 'tool/result' }> {
  return event.type === 'tool/result' && event.data.message.isError === true
}

function response(text = 'Task work is complete.'): StreamChunk[] {
  return [{ type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text } }, { type: 'finish', reason: { kind: 'stop' } }]
}

function tool(name: string, args: object): StreamChunk[] {
  return [{ type: 'block-start', index: 0, blockType: 'tool-call' }, { type: 'block-end', index: 0,
    block: { type: 'tool-call', id: ToolCallId('project-context-call'), name, arguments: JSON.stringify(args) } },
  { type: 'finish', reason: { kind: 'tool-calls' } }]
}

const updated = { outcome: 'updated', summary: 'Recorded verified parser behavior and pending review.',
  context: '# Current parser work\n\nObjective: finish the parser.\nCompleted: implementation.\nPending: human review.\nValidation: not run.',
} satisfies ProjectContextUpdateRequest
const deferred = { outcome: 'deferred', summary: 'A document guard requires human review before consolidation.',
} satisfies ProjectContextUpdateRequest

type Reply = StreamChunk[] | ((request: GenerateOptions) => StreamChunk[] | Promise<StreamChunk[]>)

async function fixture(script: Reply[], options: {
  files?: Record<string, string>
  readOnly?: boolean
  candidates?: string[]
  rejectTerminalFlush?: boolean
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'project-context-service-'))
  const root = join(directory, 'project')
  await mkdir(join(root, '.git'), { recursive: true })
  for (const [path, content] of Object.entries(options.files ?? { 'AGENTS.md': '# Rules\n\nPreserve security rules.\n' })) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), content)
  }
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SandboxPolicy, { mode: options.readOnly ? 'read-only' : 'workspace-write', workspaceRoot: root })
  await ctx.plugin(options.readOnly ? FsSandbox : FsLocal, { cwd: root })
  await ctx.plugin(WorkingDirectory)
  const flushes: string[][] = []
  let rejected = false
  ctx.on('session/flush', (session) => {
    const events = session.snapshotEvents()
    const latest = events.at(-1)
    if (options.rejectTerminalFlush && !rejected && latest?.type === 'project-context/status' && latest.data.status === 'updated') {
      rejected = true
      throw new Error('storage refused final document status')
    }
    flushes.push(events.map(event => event.type))
  })
  await ctx.plugin(Instructions, { maxBytes: 65536,
    ...options.candidates === undefined ? {} : { instructionFileCandidates: options.candidates, localInstructionFileCandidates: [] } })
  const service = await ctx.plugin(ProjectContext, { maxTextChars: 16384, maxSourceBytes: 65536, maxDocuments: 8 })
  await ctx.plugin(AgentLoop, { agents: [] })
  const requests: GenerateOptions[] = []
  class Adapter extends LlmAdapter {
    override async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
      requests.push(request)
      const reply = script.shift()
      if (reply === undefined) throw new Error('Project-context fixture exhausted its finite model script')
      yield* typeof reply === 'function' ? await reply(request) : reply
    }
  }
  ctx.llm.registerAdapter(['project-context-test'], new Adapter())
  const agent = (await ctx.agents.create({ sessionId: SessionId('project-context-source'), meta: { cwd: root },
    agentOptions: { provider: 'project-context-test', model: 'test' } })).agent
  const run = async () => {
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Finish the parser and maintain project context.' }] }))
    await agent.whenIdle()
  }
  return { ctx, root, agent, requests, run, service, flushes }
}

it('writes canonical context and one instruction pointer through the actual finalization tool', async () => {
  const test = await fixture([response(), tool('project_context_update', updated)])
  await test.run()
  expect(test.requests).toHaveLength(2)
  expect(test.agent.session.snapshotEvents().filter(event => event.type === 'turn/start')).toHaveLength(1)
  expect(test.ctx.projectContext.viewOf(test.agent.session)).toMatchObject({ status: 'updated', summary: updated.summary })
  expect(await readFile(join(test.root, 'PROJECT_CONTEXT.md'), 'utf8')).toContain(updated.context)
  const instructions = await readFile(join(test.root, 'AGENTS.md'), 'utf8')
  expect(instructions).toContain('Preserve security rules.')
  expect(instructions.match(/Read \[PROJECT_CONTEXT.md\]/g)).toHaveLength(1)
  const maintenance = test.requests[1]!.messages.flatMap(message => message.content)
    .flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
  expect(maintenance).toContain('objective and scope, completed work, pending todos')
  expect(maintenance).toContain('design decisions and rationale')
  expect(maintenance).toContain('observed validation results, blockers, and concrete next actions')
  expect(test.flushes.at(-1)).toContain('project-context/status')
})

it('retains full original guide contents durably before canonical publication and forwarding replacements', async () => {
  const guide = '# Guide\n\nUnique design rationale.\n'
  const duplicate = '# Old guide\n\nUnique recovery steps.\n'
  const test = await fixture([response(), tool('project_context_read', { paths: ['guide.md', 'guides/duplicate.md'] }),
    tool('project_context_update', { ...updated, context: updated.context + '\nUnique design rationale. Unique recovery steps.',
      guideUpdates: [{ path: 'guide.md', oldText: guide, newText: '# Guide\n\nCurrent reference: PROJECT_CONTEXT.md\n' }],
      forwardingStubs: [{ path: 'guides/duplicate.md', oldText: duplicate }] })],
  { files: { 'AGENTS.md': '# Rules\n', 'guide.md': guide, 'guides/duplicate.md': duplicate } })
  const writes: string[] = []
  const original = test.ctx.fs.writeText.bind(test.ctx.fs)
  const write = vi.spyOn(test.ctx.fs, 'writeText')
  write.mockImplementation(async (...args) => {
    expect(test.flushes.some(types => types.filter(type => type === 'project-context/document-observed').length === 4)).toBe(true)
    writes.push(args[0].displayPath)
    return await original(...args)
  })
  try {
    await test.run()
  } finally {
    write.mockRestore()
  }
  expect(test.ctx.projectContext.viewOf(test.agent.session)?.status).toBe('updated')
  expect(writes[0]).toContain('PROJECT_CONTEXT.md')
  expect(await readFile(join(test.root, 'docs', 'duplicate.md'), 'utf8')).toContain('../PROJECT_CONTEXT.md')
  const originals = test.agent.session.snapshotEvents().filter(event => event.type === 'project-context/document-observed')
    .map(event => event.data.document)
  expect(originals).toContainEqual(expect.objectContaining({ path: 'guide.md', content: guide }))
  expect(originals).toContainEqual(expect.objectContaining({ path: 'guides/duplicate.md', content: duplicate }))
})

it('requires an existing non-empty canonical document before accepting unchanged', async () => {
  const test = await fixture([response(), tool('project_context_update', { outcome: 'unchanged', summary: 'No documentation work is needed.' }),
    tool('project_context_update', deferred)])
  await test.run()
  const failures = test.agent.session.snapshotEvents().filter(failedToolResult)
  expect(failures).toHaveLength(1)
  expect(failures[0]?.data.error?.code).toBe('INVALID_ARGS')
  expect(test.ctx.projectContext.viewOf(test.agent.session)?.status).toBe('deferred')
  await expect(readFile(join(test.root, 'PROJECT_CONTEXT.md'))).rejects.toHaveProperty('code', 'ENOENT')
})

it('accepts unchanged for existing current context without writing authored files', async () => {
  const original = '# Existing project context\n\nThe parser implementation is ready for review.\n'
  const test = await fixture([response(), tool('project_context_update', { outcome: 'unchanged', summary: 'Existing parser status remains current.' })],
    { files: { 'AGENTS.md': '# Rules\n', 'PROJECT_CONTEXT.md': original } })
  await test.run()
  expect(test.ctx.projectContext.viewOf(test.agent.session)?.status).toBe('unchanged')
  expect(await readFile(join(test.root, 'PROJECT_CONTEXT.md'), 'utf8')).toBe(original)
  expect(await readFile(join(test.root, 'AGENTS.md'), 'utf8')).toBe('# Rules\n')
})

it('protects instruction and README rules even after their contents were explicitly observed', async () => {
  const original = '# README\n\nRequired product entrypoint.\n'
  const test = await fixture([response(), tool('project_context_read', { paths: ['README.md'] }),
    tool('project_context_update', { ...updated, forwardingStubs: [{ path: 'README.md', oldText: original }] }),
    tool('project_context_update', deferred)], { files: { 'AGENTS.md': '# Rules\n', 'README.md': original } })
  await test.run()
  expect(await readFile(join(test.root, 'README.md'), 'utf8')).toBe(original)
  await expect(readFile(join(test.root, 'PROJECT_CONTEXT.md'))).rejects.toHaveProperty('code', 'ENOENT')
  expect(test.ctx.projectContext.viewOf(test.agent.session)?.status).toBe('deferred')
})

it('does not let guessed oldText authorize an unobserved guide replacement', async () => {
  const original = '# Guide\n\nAuthored rationale.\n'
  const test = await fixture([response(), tool('project_context_update', { ...updated,
    forwardingStubs: [{ path: 'guide.md', oldText: original }] }), tool('project_context_update', deferred)],
  { files: { 'AGENTS.md': '# Rules\n', 'guide.md': original } })
  await test.run()
  expect(await readFile(join(test.root, 'guide.md'), 'utf8')).toBe(original)
  expect(test.ctx.projectContext.viewOf(test.agent.session)?.status).toBe('deferred')
})

it('respects normal tool denial before the writer is invoked', async () => {
  const test = await fixture([response(), tool('project_context_update', updated), tool('project_context_update', deferred)])
  const stop = test.ctx.on('tools/pre-execute', (exec, next) => exec.name === 'project_context_update'
    && typeof exec.arguments === 'object' && exec.arguments !== null && 'outcome' in exec.arguments && exec.arguments.outcome === 'updated'
    ? Promise.resolve({ kind: 'deny' as const, reason: 'This update requires review.' }) : next())
  try { await test.run() } finally { stop() }
  expect(test.ctx.projectContext.viewOf(test.agent.session)?.status).toBe('deferred')
  await expect(readFile(join(test.root, 'PROJECT_CONTEXT.md'))).rejects.toHaveProperty('code', 'ENOENT')
})

it('uses the actual read-only filesystem policy instead of widening access for maintenance', async () => {
  const test = await fixture([response(), tool('project_context_update', updated), tool('project_context_update', deferred)], { readOnly: true })
  await test.run()
  const failed = test.agent.session.snapshotEvents().find(failedToolResult)
  expect(failed?.data.error?.code).toBe('FS_SANDBOX_DENIED')
  await expect(readFile(join(test.root, 'PROJECT_CONTEXT.md'))).rejects.toHaveProperty('code', 'ENOENT')
})

it('does not claim updated when the final durable status flush fails', async () => {
  const test = await fixture([response(), tool('project_context_update', updated), tool('project_context_update', deferred)],
    { rejectTerminalFlush: true })
  await test.run()
  const failed = test.agent.session.snapshotEvents().find(failedToolResult)
  expect(failed?.data.error?.code).toBe('PROJECT_CONTEXT_DURABILITY_REQUIRED')
  expect(test.ctx.projectContext.viewOf(test.agent.session)?.status).toBe('deferred')
  expect(await readFile(join(test.root, 'PROJECT_CONTEXT.md'), 'utf8')).toContain(updated.context)
})

it('reports canonical changes honestly when a later observed guide becomes stale', async () => {
  const original = '# Guide\n\nOriginal rationale.\n'
  let guidePath = ''
  const test = await fixture([response(), tool('project_context_read', { paths: ['guide.md'] }), async () => {
    await writeFile(guidePath, 'A human revised this guide after observation.\n')
    return tool('project_context_update', { ...updated, forwardingStubs: [{ path: 'guide.md', oldText: original }] })
  }, tool('project_context_update', deferred)], { files: { 'AGENTS.md': '# Rules\n', 'guide.md': original } })
  guidePath = join(test.root, 'guide.md')
  await test.run()
  const failed = test.agent.session.snapshotEvents().find(failedToolResult)
  expect(failed?.data.error?.code).toBe('FS_STALE_VERSION')
  const failureText = failed?.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
  expect(failureText).toContain('stopped after changing')
  expect(await readFile(join(test.root, 'PROJECT_CONTEXT.md'), 'utf8')).toContain(updated.context)
  expect(await readFile(guidePath, 'utf8')).toBe('A human revised this guide after observation.\n')
  expect(test.ctx.projectContext.viewOf(test.agent.session)?.status).toBe('deferred')
})

it('serializes two sessions sharing one project and cancels a queued update before the current writer settles', async () => {
  const test = await fixture([])
  const second = (await test.ctx.agents.create({ sessionId: SessionId('project-context-second'), meta: { cwd: test.root },
    agentOptions: { provider: 'project-context-test', model: 'test' } })).agent
  const preparedA = Promise.withResolvers<undefined>()
  const preparedB = Promise.withResolvers<undefined>()
  const releaseMaintenance = Promise.withResolvers<undefined>()
  const maintenanceA = test.agent.runMaintenance(async (signal) => {
    test.agent.session.append('turn/start', { turn: 1 })
    await test.ctx.projectContext.prepare(test.agent, 1, signal)
    test.agent.inbox.clear()
    preparedA.resolve(undefined)
    await releaseMaintenance.promise
  })
  const maintenanceB = second.runMaintenance(async (signal) => {
    second.session.append('turn/start', { turn: 1 })
    await test.ctx.projectContext.prepare(second, 1, signal)
    second.inbox.clear()
    preparedB.resolve(undefined)
    await releaseMaintenance.promise
  })
  const entered = Promise.withResolvers<undefined>()
  const releaseWrite = Promise.withResolvers<undefined>()
  const order: string[] = []
  const originalWrite = test.ctx.fs.writeText.bind(test.ctx.fs)
  const write = vi.spyOn(test.ctx.fs, 'writeText').mockImplementation(async (...args) => {
    if (args[0].displayPath.endsWith('PROJECT_CONTEXT.md')) {
      order.push('canonical-start')
      entered.resolve(undefined)
      await releaseWrite.promise
      const result = await originalWrite(...args)
      order.push('canonical-published')
      return result
    }
    return await originalWrite(...args)
  })
  const stop = test.ctx.on('session/flush', (session) => { if (session === second.session) order.push('second-flush') })
  const operations: Promise<unknown>[] = [maintenanceA, maintenanceB]
  try {
    await Promise.all([preparedA.promise, preparedB.promise])
    const first = test.ctx.projectContext.executeUpdate(test.agent, updated, new AbortController().signal)
    operations.push(first)
    await entered.promise
    const cancellation = new AbortController()
    const queued = test.ctx.projectContext.executeUpdate(second, { ...updated, context: 'Second writer facts.' }, cancellation.signal)
    operations.push(queued)
    const reason = new DOMException('Queued write cancelled', 'AbortError')
    const cancelled = expect(queued).rejects.toBe(reason)
    cancellation.abort(reason)
    await cancelled
    expect(order).toEqual(['canonical-start'])
    const retry = test.ctx.projectContext.executeUpdate(second, { ...updated, context: 'Second writer facts.' }, new AbortController().signal)
    operations.push(retry)
    const stale = expect(retry).rejects.toHaveProperty('code', 'FS_STALE_VERSION')
    releaseWrite.resolve(undefined)
    expect((await first).outcome).toBe('updated')
    await stale
    expect(order.indexOf('second-flush')).toBeGreaterThan(order.indexOf('canonical-published'))
    expect(await readFile(join(test.root, 'PROJECT_CONTEXT.md'), 'utf8')).toContain(updated.context)
    expect(await readFile(join(test.root, 'PROJECT_CONTEXT.md'), 'utf8')).not.toContain('Second writer facts.')
    expect(test.requests).toHaveLength(0)
  } finally {
    releaseWrite.resolve(undefined)
    releaseMaintenance.resolve(undefined)
    stop()
    write.mockRestore()
    await Promise.allSettled(operations)
  }
})

it.each([{ candidates: ['CUSTOM.md'] }, { candidates: [] }])(
  'preserves the configured primary filename selection $candidates', async ({ candidates }) => {
    const test = await fixture([response(), tool('project_context_update', updated)], { files: {}, candidates })
    await test.run()
    expect(test.ctx.projectContext.viewOf(test.agent.session)?.status).toBe('updated')
    await expect(readFile(join(test.root, 'AGENTS.md'))).rejects.toHaveProperty('code', 'ENOENT')
    if (candidates.length > 0) expect(await readFile(join(test.root, 'CUSTOM.md'), 'utf8')).toContain('PROJECT_CONTEXT.md')
  })

it('removes both registered model tools when the owning service unloads', async () => {
  const test = await fixture([])
  expect(test.ctx.tools.get('project_context_update')).toBeDefined()
  await test.service.dispose()
  expect(test.ctx.tools.get('project_context_update')).toBeUndefined()
  expect(test.ctx.tools.get('project_context_read')).toBeUndefined()
})
