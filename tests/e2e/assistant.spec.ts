import { expect, test } from '@playwright/test'

/**
 * The assistant, in a real browser.
 *
 * Three things are worth guarding here and nowhere else: that the demo really drives the app
 * rather than printing a recorded answer, that undo restores the design the tool changed, and that
 * a key the visitor pastes in stays where it was put. The last one is the reason this file exists;
 * the rest is covered by unit tests against the dispatcher.
 */

const FAKE_KEY = 'sk-ant-leak-canary-0123456789'

async function openAssistant(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByTestId('assistant-toggle').click()
  await expect(page.getByTestId('assistant-panel')).toBeVisible()
}

test('the demo drives the real surrogate and the tools are visible', async ({ page }) => {
  await openAssistant(page)

  const thickness = page.getByText('Max thickness')
  await expect(thickness).toBeVisible()
  const before = await page.locator('text=Max thickness').locator('..').innerText()

  await page.getByRole('button', { name: /fifteen per cent thinner/ }).click()

  const toolCalls = page.getByTestId('tool-call')
  await expect(toolCalls.first()).toContainText('nudge_shape')
  await expect(toolCalls.nth(1)).toContainText('explain_result')

  // The recorded answer quotes figures, and every one of them came from the tool calls above.
  const panel = page.getByTestId('assistant-panel')
  await expect(panel).toContainText(/% chord/)
  await expect(panel).not.toContainText('{{')

  const after = await page.locator('text=Max thickness').locator('..').innerText()
  expect(after).not.toBe(before)
})

test('undo puts the design back', async ({ page }) => {
  await openAssistant(page)
  const measured = page.locator('text=Max thickness').locator('..')
  const before = await measured.innerText()

  await page.getByRole('button', { name: /fifteen per cent thinner/ }).click()
  await expect(page.getByTestId('tool-call').first()).toContainText('nudge_shape')
  expect(await measured.innerText()).not.toBe(before)

  await page.getByTestId('tool-call').first().getByRole('button', { name: 'undo' }).click()
  await expect.poll(() => measured.innerText()).toBe(before)
})

test('the app is fully usable with no key at all', async ({ page }) => {
  await page.goto('/')
  const stored = await page.evaluate(() => localStorage.getItem('nwt.assistant.key'))
  expect(stored).toBeNull()

  await page.getByTestId('assistant-toggle').click()
  await page.getByRole('button', { name: /Why did the drag go up/ }).click()
  await expect(page.getByTestId('tool-call').first()).toBeVisible()
  await expect(page.getByTestId('assistant-panel')).toContainText('lift-to-drag')
})

test('a stored key never reaches the URL, the console or an error message', async ({ page }) => {
  const consoleText: string[] = []
  page.on('console', (message) => {
    consoleText.push(message.text())
  })
  page.on('pageerror', (error) => {
    consoleText.push(error.stack ?? error.message)
  })

  await page.goto('/')
  await page.evaluate((key) => {
    localStorage.setItem('nwt.assistant.key', key)
    localStorage.setItem(
      'nwt.assistant.config',
      JSON.stringify({ kind: 'anthropic', model: 'claude-sonnet-5-5', baseUrl: '' }),
    )
  }, FAKE_KEY)

  // Fail the provider call: an error path is where a key most often ends up being printed.
  const seenHeaders: (string | undefined)[] = []
  await page.route('https://api.anthropic.com/**', async (route) => {
    seenHeaders.push(route.request().headers()['x-api-key'])
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'invalid x-api-key' } }),
    })
  })

  await page.reload()
  await page.getByTestId('assistant-toggle').click()
  await page.getByRole('textbox', { name: 'Message the assistant' }).fill('make it thinner')
  await page.getByRole('button', { name: 'Send' }).click()

  const panel = page.getByTestId('assistant-panel')
  await expect(panel).toContainText('401')

  // The key did go to the provider, which is the point of it.
  expect(seenHeaders).toContain(FAKE_KEY)

  // And nowhere else.
  expect(page.url()).not.toContain(FAKE_KEY)
  expect(await panel.innerText()).not.toContain(FAKE_KEY)
  expect(await page.content()).not.toContain(FAKE_KEY)
  expect(consoleText.join('\n')).not.toContain(FAKE_KEY)
})
