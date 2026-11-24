/** Exercises prompt enhancement and its persisted limits through the Web composer. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { launchWebScaffold, readPersistedEvents, recordFixture } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, openSettings } from './support.ts'

const SCENARIO = fileURLToPath(new URL('../../../snapshots/web/prompt-enhancement', import.meta.url))
const SESSION = join(SCENARIO, 'session.v4.jsonl')

it('persists limits and sends longer prompts unchanged', async () => {
  const scaffold = await launchWebScaffold({
    profile: { packages: [] }, replayFixture: SESSION, replayOverride: join(SCENARIO, 'replay.override.json'),
  })
  onTestFinished(() => scaffold.close())
  await mkdir(join(scaffold.workspaceCwd, '.git'))
  await writeFile(join(scaffold.workspaceCwd, 'AGENTS.md'), '# Parser instructions\nKeep parser output stable.\n\n# Layout instructions\nKeep layout readable.\n')
  const events: SessionEvent[] = []
  scaffold.ctx.on('session/event', (_session, event: SessionEvent) => { events.push(event) })
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await newEnglishPage(browser, 900)
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await connectFreshWorkspace(page, scaffold.workspaceCwd, 'prompt-enhancement-e2e')

  await openSettings(page, 'en')
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
  await dialog.getByRole('navigation').getByRole('button', { name: 'Prompt enhancement', exact: true }).click()
  const words = dialog.getByLabel('Maximum prompt words')
  const characters = dialog.getByLabel('Maximum prompt characters')
  await expect.poll(() => words.inputValue()).toBe('100')
  expect(await characters.inputValue()).toBe('2000')
  await words.fill('3')
  await characters.fill('100')
  await dialog.getByRole('button', { name: 'Save settings', exact: true }).click()
  await dialog.getByText('Settings saved.', { exact: true }).waitFor()
  if (process.env.DSH_PROMPT_ENHANCEMENT_SCREENSHOTS !== undefined) {
    await page.screenshot({ path: join(process.env.DSH_PROMPT_ENHANCEMENT_SCREENSHOTS, 'settings.png') })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => words.isVisible()).toBe(true)
  if (process.env.DSH_PROMPT_ENHANCEMENT_SCREENSHOTS !== undefined) {
    await page.screenshot({ path: join(process.env.DSH_PROMPT_ENHANCEMENT_SCREENSHOTS, 'settings-narrow.png') })
  }
  await page.setViewportSize({ width: 1680, height: 900 })
  await page.keyboard.press('Escape')
  await openSettings(page, 'en')
  await dialog.getByRole('navigation').getByRole('button', { name: 'Prompt enhancement', exact: true }).click()
  await expect.poll(() => words.inputValue()).toBe('3')
  expect(await characters.inputValue()).toBe('100')
  await page.keyboard.press('Escape')

  const toggle = page.getByRole('switch', { name: 'Enhance prompts' })
  await toggle.click()
  await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('true')
  const composer = page.locator('[data-composer-input][contenteditable="true"]').last()
  await composer.fill('Fix parser')
  const shortSettled = scaffold.whenTurnSettled(60_000)
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  const sessionId = await shortSettled
  await page.getByText('SHORT_RESPONSE', { exact: false }).waitFor()
  expect(events.filter(event => event.type === 'prompt-enhancement/request')).toHaveLength(1)
  const firstRequest = events.find(event => event.type === 'prompt-enhancement/request')
  expect(JSON.stringify(firstRequest)).toContain('Keep parser output stable.')
  expect(JSON.stringify(firstRequest)).not.toContain('DeepSeek Harness project context')
  expect(events.filter(event => event.type === 'prompt-enhancement/result')).toHaveLength(1)
  expect(events.filter(event => event.type === 'prompt-enhancement/accepted')).toHaveLength(1)

  const long = 'Please fix this parser carefully'
  await composer.fill(long)
  const longSettled = scaffold.whenTurnSettled(60_000)
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await longSettled
  await page.getByText('LONG_RESPONSE', { exact: false }).waitFor()
  if (process.env.DSH_PROMPT_ENHANCEMENT_SCREENSHOTS !== undefined) {
    await page.screenshot({ path: join(process.env.DSH_PROMPT_ENHANCEMENT_SCREENSHOTS, 'long-prompt.png') })
  }
  await page.getByRole('status').filter({ hasText: 'Enhancement was skipped because the prompt or expanded references exceed your length limits.' }).waitFor({ timeout: 10_000 })
  const submitted = events.filter(event => event.type === 'user/message').at(-1)
  expect(submitted?.type === 'user/message' && submitted.data.content).toEqual([{ type: 'text', text: long }])
  expect(events.filter(event => event.type === 'prompt-enhancement/request')).toHaveLength(1)

  await openSettings(page, 'en')
  await dialog.getByRole('navigation').getByRole('button', { name: 'Prompt enhancement', exact: true }).click()
  await dialog.getByLabel('Before sending').selectOption('review')
  await dialog.getByRole('button', { name: 'Save settings', exact: true }).click()
  await dialog.getByText('Settings saved.', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await composer.fill('Fix layout')
  const userMessagesBeforeReview = events.filter(event => event.type === 'user/message').length
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  const review = page.getByRole('region', { name: 'Review the enhanced prompt' })
  await review.waitFor()
  expect(await review.getByLabel('Enhanced prompt').inputValue()).toBe('Please fix the layout.')
  if (process.env.DSH_PROMPT_ENHANCEMENT_SCREENSHOTS !== undefined) {
    await page.screenshot({ path: join(process.env.DSH_PROMPT_ENHANCEMENT_SCREENSHOTS, 'review.png') })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.screenshot({ path: join(process.env.DSH_PROMPT_ENHANCEMENT_SCREENSHOTS, 'review-dark.png') })
    await page.emulateMedia({ colorScheme: 'light' })
  }
  await review.getByRole('button', { name: 'Cancel submission', exact: true }).click()
  await expect.poll(() => composer.textContent()).toBe('Fix layout')
  expect(events.filter(event => event.type === 'user/message')).toHaveLength(userMessagesBeforeReview)
  await page.reload({ waitUntil: 'load' })
  await page.getByText('SHORT_RESPONSE', { exact: false }).waitFor({ timeout: 15_000 })
  await page.getByText('Original prompt', { exact: true }).waitFor({ timeout: 15_000 })
  await openSettings(page, 'en')
  await dialog.getByRole('navigation').getByRole('button', { name: 'Prompt enhancement', exact: true }).click()
  await expect.poll(() => words.inputValue()).toBe('3')
  expect(await characters.inputValue()).toBe('100')
  expect(await dialog.getByLabel('Before sending').inputValue()).toBe('review')
  const agent = scaffold.ctx.agents.get(sessionId)
  if (agent === undefined) throw new Error('The submitted Session is unavailable')
  expect(await scaffold.ctx.sessions.flush(agent.session)).toBe(true)
  expect(await readPersistedEvents(scaffold, sessionId)).toEqual(agent.session.snapshotEvents())
  if (process.env.DSH_SNAPSHOT === 'refresh') await recordFixture(scaffold, sessionId, SESSION)
}, 180_000)
