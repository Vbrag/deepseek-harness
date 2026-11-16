/** Real Web handoff states and explicit continuation over the shipped composition. */

import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { expect, it } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, StreamChunk, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo'
import type {} from '@deepseek-ai/dsh-work-handoff'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, REPO_ROOT } from './support.ts'

const PROVIDER = 'work-handoff-fixture'
const MODEL = 'checkpoint-worker'

/** Ordinary model finishes let the real todo and goal drivers own their limits. */
class HandoffAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  private readonly completions = new Map<SessionId, { responses: number; gate: Promise<undefined>; todos: TodoItem[] }>()

  completeAfterFiveStops(sessionId: SessionId, gate: Promise<undefined>, content: string): void {
    this.completions.set(sessionId, { responses: 0, gate, todos: [{ content, status: 'completed' }] })
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([{ provider, id: MODEL, name: 'Checkpoint worker' }])
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: 'Checkpoint worker', contextWindow: 131072 })
  }

  override async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(request)
    const completion = request.sessionId === undefined ? undefined : this.completions.get(request.sessionId)
    if (completion !== undefined) {
      completion.responses += 1
      if (completion.responses > 8) throw new Error('Fixture todo completion did not settle')
      if (completion.responses === 6) {
        await completion.gate
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'block-end', index: 0, block: {
          type: 'tool-call', id: brandString<ToolCallId>(`handoff-complete-${this.requests.length}`),
          name: 'todo_write', arguments: JSON.stringify({ todos: completion.todos }),
        } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
        return
      }
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: {
      type: 'text', text: completion !== undefined && completion.responses > 6
        ? 'Verification is complete.' : 'The remaining verification still needs work.',
    } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Open-session navigation is observable without reaching into the Client implementation. */
async function selectedSession(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const value = localStorage.getItem('dsh.sessions.current')
    return value === null ? undefined : (JSON.parse(value) as { sessionId?: string }).sessionId
  })
}

it('retains proposal, legacy, paused, and budget states and exports into explicit fresh-session continuation', async () => {
  let scaffold: WebScaffold | undefined
  let browser: Browser | undefined
  let failureShot: (() => Promise<void>) | undefined
  const handles: AgentHandle[] = []
  const completion = Promise.withResolvers<undefined>()
  const recoveredCompletion = Promise.withResolvers<undefined>()
  try {
    // The scaffold pins the in-page directory picker and binds its own loopback port 0.
    scaffold = await launchWebScaffold()
    const ctx = scaffold.ctx
    const adapter = new HandoffAdapter()
    ctx.effect(() => ctx.llm.registerAdapter([PROVIDER], adapter), 'work handoff browser fixture model')
    const workspace = await ctx.workspaceRegistry.create(scaffold.workspaceCwd)
    const handle = await ctx.agents.create({
      sessionId: brandString<SessionId>('work-handoff-source'),
      agentOptions: { provider: PROVIDER, model: MODEL }, meta: { cwd: scaffold.workspaceCwd, agentPreset: 'standard' },
      setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, 'standard') },
    })
    handles.push(handle)
    let source = handle.agent
    const executionErrors: unknown[] = []
    ctx.on('agent/error', ({ error }) => { executionErrors.push(error) })
    let policy = ctx.agentPresets.serviceFor(source, 'todoPolicy') ?? source.ctx.get('todoPolicy')
    if (policy === undefined) throw new Error('Expected the standard preset todo policy')
    await workspace.attachSession(source.id)
    source.followup(createUserMessage({
      content: [{ type: 'text', text: 'Inspect retained work and verify the pending changes.' }], source: { kind: 'user' },
    }))
    await source.whenIdle()
    expect(executionErrors).toEqual([])
    expect(adapter.requests).toHaveLength(1)

    const channel = process.env.DSH_WEB_TEST_BROWSER_CHANNEL
    browser = await chromium.launch(channel === undefined ? {} : { channel })
    const page = await newEnglishPage(browser)
    failureShot = async () => {
      await mkdir(join(REPO_ROOT, '.artifacts'), { recursive: true })
      await page.screenshot({ path: join(REPO_ROOT, '.artifacts/work-handoff-failure.png'), fullPage: true })
    }
    const tripwire = watchConsole(page)
    await page.addInitScript((id) => {
      localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: id }))
    }, source.id)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.locator('[data-composer-input]').first().waitFor({ timeout: 30000 })
    const bar = page.locator('[data-work-handoff]')

    policy.writeList(source, [{ content: 'Verify the pending changes', status: 'pending' }], 'proposal', 'paused',
      'The proposed implementation needs approval.')
    await bar.getByText('Proposed work', { exact: true }).waitFor()
    expect(await bar.getByRole('button', { name: 'Continue work', exact: true }).count()).toBe(0)
    expect(adapter.requests).toHaveLength(1)
    adapter.completeAfterFiveStops(source.id, completion.promise, 'Verify the pending changes')
    await bar.getByRole('button', { name: 'Approve and continue', exact: true }).click()
    await bar.getByText('Continuing automatically', { exact: true }).waitFor()
    expect(await bar.getByRole('button', { name: 'Continue work', exact: true }).count()).toBe(0)
    await mkdir(join(REPO_ROOT, '.artifacts'), { recursive: true })
    await page.screenshot({ path: join(REPO_ROOT, '.artifacts/work-handoff-automatic.png'), fullPage: true })
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
    await page.locator('[data-sidebar-collapsed]').waitFor()
    await page.setViewportSize({ width: 390, height: 900 })
    await page.locator('[data-sidebar-drawer]').waitFor()
    await page.locator('[data-sidebar-drawer] > [inert]').waitFor({ state: 'hidden' })
    await page.screenshot({ path: join(REPO_ROOT, '.artifacts/work-handoff-automatic-narrow.png'), fullPage: true })
    expect(await bar.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return rect.left >= 0 && rect.right <= window.innerWidth && element.scrollWidth <= element.clientWidth
    })).toBe(true)
    await page.setViewportSize({ width: 1680, height: 1000 })
    await page.locator('[data-sidebar-drawer]').waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
    completion.resolve(undefined)
    await expect.poll(() => policy?.listOf(source.session), { timeout: 30000 }).toEqual([
      { content: 'Verify the pending changes', status: 'completed' },
    ])
    await source.whenIdle()
    expect(adapter.requests).toHaveLength(8)
    expect(policy.viewOf(source.session)).toMatchObject({ purpose: 'current-task', disposition: 'active' })
    expect(ctx.workHandoffs.viewOf(source.session)).toBeNull()

    const oldLimitId = brandString<SessionId>('work-handoff-old-limit')
    const oldHandle = await ctx.agents.create({
      sessionId: oldLimitId, agentOptions: { provider: PROVIDER, model: MODEL },
      meta: { cwd: scaffold.workspaceCwd, agentPreset: 'standard' },
      setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, 'standard') },
    })
    handles.push(oldHandle)
    const oldAgent = oldHandle.agent
    await workspace.attachSession(oldAgent.id)
    oldAgent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Recover the authorized task saved at the old repair limit.' }], source: { kind: 'user' },
    }))
    await oldAgent.whenIdle()
    const oldPolicy = ctx.agentPresets.serviceFor(oldAgent, 'todoPolicy') ?? oldAgent.ctx.get('todoPolicy')
    if (oldPolicy === undefined) throw new Error('Expected the saved execution-list policy')
    oldPolicy.writeList(oldAgent, [{ content: 'Finish the previously limited task', status: 'pending' }], 'current-task')
    for (let attempt = 0; attempt < 3; attempt += 1) oldPolicy.recordRepair(oldAgent)
    oldPolicy.markLimit(oldAgent)
    await ctx.workHandoffs.capture(oldAgent, { reason: 'todo-limit' })
    await oldHandle.dispose()
    adapter.completeAfterFiveStops(oldLimitId, recoveredCompletion.promise, 'Finish the previously limited task')
    const recovered = await ctx.agents.resume({
      resumeSessionId: oldLimitId, agentOptions: { provider: PROVIDER, model: MODEL },
      setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, 'standard') },
    })
    handles.push(recovered)
    const recoveredPolicy = ctx.agentPresets.serviceFor(recovered.agent, 'todoPolicy') ?? recovered.agent.ctx.get('todoPolicy')
    if (recoveredPolicy === undefined) throw new Error('Expected the recovered execution-list policy')
    await page.locator(`[data-row-key="session:${oldLimitId}"]`).click()
    await bar.getByText('Continuing automatically', { exact: true }).waitFor()
    expect(await bar.getByRole('button', { name: 'Continue work', exact: true }).count()).toBe(0)
    recoveredCompletion.resolve(undefined)
    await expect.poll(() => recoveredPolicy.listOf(recovered.agent.session), { timeout: 30000 }).toEqual([
      { content: 'Finish the previously limited task', status: 'completed' },
    ])
    await recovered.agent.whenIdle()
    expect(adapter.requests.filter(request => request.sessionId === oldLimitId)).toHaveLength(8)
    expect(ctx.workHandoffs.viewOf(recovered.agent.session)).toBeNull()

    const legacyHandle = await ctx.agents.create({
      sessionId: brandString<SessionId>('work-handoff-legacy'),
      agentOptions: { provider: PROVIDER, model: MODEL }, meta: { cwd: scaffold.workspaceCwd, agentPreset: 'standard' },
      setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, 'standard') },
    })
    handles.push(legacyHandle)
    source = legacyHandle.agent
    await workspace.attachSession(source.id)
    source.followup(createUserMessage({
      content: [{ type: 'text', text: 'Review a retained legacy task before execution.' }], source: { kind: 'user' },
    }))
    await source.whenIdle()
    policy = ctx.agentPresets.serviceFor(source, 'todoPolicy') ?? source.ctx.get('todoPolicy')
    if (policy === undefined) throw new Error('Expected the legacy Session todo policy')
    policy.writeList(source, [{ content: 'Review the legacy task before running it', status: 'pending' }])
    await page.locator(`[data-row-key="session:${source.id}"]`).click()
    await bar.getByText('Confirmation required', { exact: true }).waitFor()
    await bar.getByRole('button', { name: 'Confirm and continue', exact: true }).waitFor()
    expect(adapter.requests).toHaveLength(17)
    await ctx.workHandoffs.capture(source, { reason: 'paused' })
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
    await page.locator('[data-sidebar-collapsed]').waitFor()
    await page.setViewportSize({ width: 390, height: 900 })
    await page.locator('[data-sidebar-drawer]').waitFor()
    await page.locator('[data-sidebar-drawer] > [inert]').waitFor({ state: 'hidden' })
    await expect.poll(() => bar.getByRole('button', { name: 'Download handoff' }).isEnabled()).toBe(true)
    await mkdir(join(REPO_ROOT, '.artifacts'), { recursive: true })
    await page.screenshot({ path: join(REPO_ROOT, '.artifacts/work-handoff-narrow.png'), fullPage: true })
    expect(await bar.evaluate(element => [...element.querySelectorAll('button')].every((button) => {
      const rect = button.getBoundingClientRect()
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return rect.left >= 0 && rect.right <= window.innerWidth && hit !== null && button.contains(hit)
    }))).toBe(true)

    await page.setViewportSize({ width: 1680, height: 1000 })
    await page.locator('[data-sidebar-drawer]').waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
    source.session.append('work-handoff/cleared', {})
    policy.writeList(source, [])
    policy.writeList(source, [{ content: 'Wait for review before verification', status: 'pending' }],
      'current-task', 'waiting', 'Review feedback is required.')
    await bar.getByText('Waiting', { exact: true }).waitFor()
    await policy.suspend(source, 'paused', 'The user paused verification.')
    await bar.getByText('Paused', { exact: true }).waitFor()
    await ctx.workHandoffs.capture(source, { reason: 'paused' })
    await page.screenshot({ path: join(REPO_ROOT, '.artifacts/work-handoff-wide.png'), fullPage: true })
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: scaffold.baseUrl })
    await bar.getByRole('button', { name: 'Copy handoff', exact: true }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('# Work handoff')
    const downloadEvent = page.waitForEvent('download')
    await bar.getByRole('button', { name: 'Download handoff', exact: true }).click()
    const download = await downloadEvent
    expect(download.suggestedFilename()).toMatch(/^work-handoff-\d+\.md$/)
    const downloadedPath = await download.path()
    if (downloadedPath === null) throw new Error('Expected a downloaded Markdown file')
    expect(await readFile(downloadedPath, 'utf8')).toContain('# Work handoff')

    ctx.goals.create(source, { objective: 'Finish the pending verification with recorded evidence', maxGoalRounds: 1 })
    await expect.poll(() => ctx.goals.get(source)?.phase, { timeout: 30000 }).toBe('paused')
    await bar.getByText('Paused: round budget exhausted', { exact: true }).waitFor()
    expect(adapter.requests).toHaveLength(18)
    expect(await bar.getByRole('button', { name: 'Continue work', exact: true }).count()).toBe(0)
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
    await page.locator('[data-sidebar-collapsed]').waitFor()
    await page.setViewportSize({ width: 390, height: 900 })
    await page.locator('[data-sidebar-drawer]').waitFor()
    await page.locator('[data-sidebar-drawer] > [inert]').waitFor({ state: 'hidden' })
    await page.screenshot({ path: join(REPO_ROOT, '.artifacts/work-handoff-budget-narrow.png'), fullPage: true })
    expect(await bar.evaluate(element => [...element.querySelectorAll('button')].every((button) => {
      const rect = button.getBoundingClientRect()
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return rect.left >= 0 && rect.right <= window.innerWidth && hit !== null && button.contains(hit)
    }))).toBe(true)
    await page.setViewportSize({ width: 1680, height: 1000 })
    await page.locator('[data-sidebar-drawer]').waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
    await bar.getByRole('button', { name: 'Continue in new session', exact: true }).click()
    await expect.poll(() => selectedSession(page), { timeout: 30000 }).not.toBe(source.id)
    const nextId = await selectedSession(page)
    if (nextId === undefined) throw new Error('Expected the newly selected continuation session')
    const next = ctx.agents.get(brandString<SessionId>(nextId))
    if (next === undefined) throw new Error('Expected the fresh continuation Agent')
    await expect.poll(() => ctx.workspaceRegistry.list().some(row =>
      row.id === workspace.id && row.sessionIds.includes(next.id)), { timeout: 30000 }).toBe(true)
    await page.locator(`[data-row-key="session:${next.id}"]`).waitFor({ state: 'visible', timeout: 30000 })
    await expect.poll(() => ctx.goals.get(next)?.phase, { timeout: 30000 }).toBe('paused')
    expect(adapter.requests).toHaveLength(20)
    expect(next.session.header.cwd).toBe(source.session.header.cwd)
    expect(next.model.current()).toEqual(source.model.current())
    const nextPolicy = ctx.agentPresets.serviceFor(next, 'todoPolicy') ?? next.ctx.get('todoPolicy')
    expect(nextPolicy?.viewOf(next.session)?.purpose).toBe('current-task')
    expect(adapter.requests.slice(18).some(request => request.messages.some(message => message.content.some(block =>
      block.type === 'text' && block.text.includes('# Work handoff'))))).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    expect(executionErrors).toEqual([])
  } catch (error) {
    await Promise.allSettled([failureShot?.()])
    throw error
  } finally {
    completion.resolve(undefined)
    recoveredCompletion.resolve(undefined)
    await Promise.allSettled([browser?.close(), ...handles.map(handle => handle.dispose())])
    await scaffold?.close()
  }
}, 180000)
