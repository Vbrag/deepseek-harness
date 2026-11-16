/** Real project-note finalization and fresh-chat loading over the shipped Web composition. */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { chromium, type Browser } from 'playwright'
import { expect, it } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, StreamChunk, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-project-context'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, REPO_ROOT } from './support.ts'

const PROVIDER = 'project-context-fixture'
const MODEL = 'project-writer'
const CONTEXT = '# Project context\n\n## Goals\nRetain the verified project state across chats.\n\n'
  + '## Work\nThe context loader is verified.\n\n## Decisions\nUse the canonical project notes.\n\n'
  + '## Verification\nThe project handshake is citrus-314.\n\n## Next steps\nReview current workspace facts before changes.\n'

/** A finite external-model script; the shipped service owns every maintenance decision and file write. */
class ProjectAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  private readonly counts = new Map<SessionId, number>()

  constructor(private readonly firstId: SessionId, private readonly writing: Promise<undefined>) { super() }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([{ provider, id: MODEL, name: 'Project writer' }])
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: 'Project writer', contextWindow: 131072 })
  }

  override async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(request)
    if (request.sessionId === undefined) throw new Error('Expected a project Session request')
    const count = (this.counts.get(request.sessionId) ?? 0) + 1
    this.counts.set(request.sessionId, count)
    if (count > 2) throw new Error('Project maintenance recursively requested another model response')
    if (count === 2) {
      if (request.sessionId === this.firstId) await this.writing
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: {
        type: 'tool-call', id: brandString<ToolCallId>(`project-update-${this.requests.length}`), name: 'project_context_update',
        arguments: JSON.stringify(request.sessionId === this.firstId
          ? { outcome: 'updated', summary: 'Retained verified project facts.', context: CONTEXT }
          : { outcome: 'unchanged', summary: 'The verified project context remains current.' }),
      } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: {
      type: 'text', text: count === 1 ? 'The project handshake is citrus-314.' : 'Project notes are assessed.',
    } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

it('saves project knowledge, shows independent status and loads it before standing rules in a fresh chat', async () => {
  let scaffold: WebScaffold | undefined
  let browser: Browser | undefined
  let failureShot: (() => Promise<void>) | undefined
  const handles: AgentHandle[] = []
  const writing = Promise.withResolvers<undefined>()
  try {
    scaffold = await launchWebScaffold({ projectContext: true })
    const ctx = scaffold.ctx
    await promisify(execFile)('git', ['init', '--quiet', scaffold.workspaceCwd], { windowsHide: true })
    await writeFile(join(scaffold.workspaceCwd, 'AGENTS.md'), '# Standing rules\n\nKeep the standing project rule intact.\n')
    const sourceId = brandString<SessionId>('project-context-source')
    const adapter = new ProjectAdapter(sourceId, writing.promise)
    ctx.effect(() => ctx.llm.registerAdapter([PROVIDER], adapter), 'project context browser fixture model')
    const workspace = await ctx.workspaceRegistry.create(scaffold.workspaceCwd)
    const source = await ctx.agents.create({
      sessionId: sourceId, agentOptions: { provider: PROVIDER, model: MODEL },
      meta: { cwd: scaffold.workspaceCwd, agentPreset: 'standard' },
      setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, 'standard') },
    })
    handles.push(source)
    await workspace.attachSession(sourceId)
    const errors: unknown[] = []
    ctx.on('agent/error', ({ error }) => { errors.push(error) })
    const channel = process.env.DSH_WEB_TEST_BROWSER_CHANNEL
    browser = await chromium.launch(channel === undefined ? {} : { channel })
    const page = await newEnglishPage(browser)
    const tripwire = watchConsole(page)
    failureShot = async () => {
      await mkdir(join(REPO_ROOT, '.artifacts'), { recursive: true })
      await page.screenshot({ path: join(REPO_ROOT, '.artifacts/project-context-failure.png'), fullPage: true })
    }
    await page.addInitScript((id) => {
      localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: id }))
    }, sourceId)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.locator('[data-composer-input]').first().waitFor({ timeout: 30000 })
    source.agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Verify and retain the project handshake for future chats.' }], source: { kind: 'user' },
    }))
    const status = page.locator('[data-project-context-status]')
    await status.getByText('Updating project notes', { exact: true }).waitFor()
    expect(await page.locator('[data-goal-bar]').count()).toBe(0)
    expect(await page.locator('[data-work-handoff]').count()).toBe(0)
    writing.resolve(undefined)
    await source.agent.whenIdle()
    await status.getByText('Project notes updated', { exact: true }).waitFor()
    expect(adapter.requests).toHaveLength(2)
    expect(await readFile(join(scaffold.workspaceCwd, 'PROJECT_CONTEXT.md'), 'utf8')).toContain(CONTEXT.trimEnd())
    const rules = await readFile(join(scaffold.workspaceCwd, 'AGENTS.md'), 'utf8')
    expect(rules).toContain('Keep the standing project rule intact.')
    expect(rules).toContain('[PROJECT_CONTEXT.md](PROJECT_CONTEXT.md)')
    await mkdir(join(REPO_ROOT, '.artifacts'), { recursive: true })
    await page.screenshot({ path: join(REPO_ROOT, '.artifacts/project-context-wide.png'), fullPage: true })
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
    await page.locator('[data-sidebar-collapsed]').waitFor()
    await page.setViewportSize({ width: 390, height: 900 })
    await page.locator('[data-sidebar-drawer]').waitFor()
    await page.locator('[data-sidebar-drawer] > [inert]').waitFor({ state: 'hidden' })
    await page.screenshot({ path: join(REPO_ROOT, '.artifacts/project-context-narrow.png'), fullPage: true })
    expect(await status.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return rect.left >= 0 && rect.right <= innerWidth && element.scrollWidth <= element.clientWidth
    })).toBe(true)

    const fresh = await ctx.agents.create({
      sessionId: brandString<SessionId>('project-context-fresh'), agentOptions: { provider: PROVIDER, model: MODEL },
      meta: { cwd: scaffold.workspaceCwd, agentPreset: 'standard' },
      setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, 'standard') },
    })
    handles.push(fresh)
    await workspace.attachSession(fresh.agent.id)
    fresh.agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Use the retained project handshake and assess whether the notes need an update.' }],
      source: { kind: 'user' },
    }))
    await fresh.agent.whenIdle()
    expect(ctx.projectContext.viewOf(fresh.agent.session)?.status).toBe('unchanged')
    const firstFresh = adapter.requests.find(request => request.sessionId === fresh.agent.id)
    const text = firstFresh?.messages.flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : []))
      .join('\n') ?? ''
    expect(text).toContain('The project handshake is citrus-314.')
    expect(text.indexOf('Instructions from: PROJECT_CONTEXT.md')).toBeGreaterThanOrEqual(0)
    expect(text.indexOf('Instructions from: PROJECT_CONTEXT.md')).toBeLessThan(text.indexOf('Instructions from: AGENTS.md'))
    expect(adapter.requests).toHaveLength(4)
    for (const handle of handles) {
      expect(handle.agent.session.snapshotEvents().filter(event => event.type === 'user/message'
        && event.data.source.kind === 'project-context')).toHaveLength(1)
    }
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    expect(errors).toEqual([])
  } catch (error) {
    await Promise.allSettled([failureShot?.()])
    await mkdir(join(REPO_ROOT, '.artifacts'), { recursive: true })
    await writeFile(join(REPO_ROOT, '.artifacts/project-context-events.json'), JSON.stringify(handles.map(handle => ({
      id: handle.agent.id,
      events: handle.agent.session.snapshotEvents().filter(event =>
        event.type === 'tool/result' || event.type === 'turn/end' || event.type === 'user/message'),
    })), null, 2))
    throw error
  } finally {
    writing.resolve(undefined)
    await Promise.allSettled([browser?.close(), ...handles.map(handle => handle.dispose())])
    await scaffold?.close()
  }
}, 180000)
