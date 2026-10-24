import { expect, test } from '@playwright/test'

/**
 * The contract this suite enforces for every commit: the app boots clean. No console errors,
 * no failed network requests, and the shell actually renders. Later milestones add the visual
 * and performance assertions; this one must never be allowed to go red.
 */
test('boots with no console errors and no failed requests', async ({ page }) => {
  const consoleErrors: string[] = []
  const failedRequests: string[] = []

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text())
    }
  })
  page.on('pageerror', (error) => {
    consoleErrors.push(`uncaught: ${error.message}`)
  })
  page.on('requestfailed', (request) => {
    failedRequests.push(`${request.method()} ${request.url()}`)
  })
  page.on('response', (response) => {
    if (response.status() >= 400) {
      failedRequests.push(`${response.status()} ${response.url()}`)
    }
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Neural Wind Tunnel', level: 1 })).toBeVisible()

  // Give the module graph a beat to settle so a late error still fails the test.
  await page.waitForLoadState('networkidle')

  expect(consoleErrors, 'console errors').toEqual([])
  expect(failedRequests, 'failed requests').toEqual([])
})

test('renders the shell and its controls', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Neural Wind Tunnel' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'NACA 2412' })).toBeVisible()
  await expect(page.getByRole('slider', { name: 'Incidence' })).toBeVisible()
  await expect(page.locator('canvas')).toBeVisible()
})
