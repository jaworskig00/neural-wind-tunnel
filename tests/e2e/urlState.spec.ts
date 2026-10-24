import { expect, test } from '@playwright/test'

/**
 * The URL round trip.
 *
 * `docs/URL-STATE.md` is a contract the sister project builds links against, so these check what
 * matters when someone else's code generates the string: a link opens what it describes, the app
 * writes one that can be opened again, and a link it has to correct says so rather than quietly
 * showing something else.
 */

test.describe('shareable state', () => {
  test('opens the design a link describes', async ({ page }) => {
    await page.goto('/#v=1&p=naca4412&a=6')
    await expect(page.getByRole('button', { name: 'NACA 4412' })).toHaveClass(/border-accent/)
    await expect(page.getByTestId('coefficient-α')).toHaveText('6.0')
  })

  test('writes a link that reopens the same design', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'NACA 0008' }).click()
    await page.getByRole('slider', { name: 'Incidence' }).fill('-4')

    await expect.poll(async () => page.evaluate(() => window.location.hash)).toContain('naca0008')
    const hash = await page.evaluate(() => window.location.hash)

    await page.goto(`/${hash}`)
    await expect(page.getByRole('button', { name: 'NACA 0008' })).toHaveClass(/border-accent/)
    await expect(page.getByTestId('coefficient-α')).toHaveText('-4.0')
  })

  test('keeps an edited section across the round trip', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Thinner' }).click()
    await expect(page.getByTestId('section-edited')).toBeVisible()

    await expect.poll(async () => page.evaluate(() => window.location.hash)).toContain('au=')
    const hash = await page.evaluate(() => window.location.hash)
    const thickness = await page.getByText(/% c/).first().textContent()

    await page.goto(`/${hash}`)
    await expect(page.getByTestId('section-edited')).toBeVisible()
    await expect(page.getByText(/% c/).first()).toHaveText(thickness ?? '')
  })

  test('clamps an out-of-range link and says so', async ({ page }) => {
    await page.goto('/#v=1&p=naca0012&a=40')
    await expect(page.getByTestId('url-notices')).toContainText('clamped')
    await expect(page.getByTestId('coefficient-α')).toHaveText('10.0')
  })

  test('refuses to guess at a version it does not read', async ({ page }) => {
    await page.goto('/#v=99&p=naca4412&a=8')
    await expect(page.getByTestId('url-notices')).toContainText('URL format 99')
    await expect(page.getByRole('button', { name: 'NACA 2412' })).toHaveClass(/border-accent/)
  })

  test('does not fill the history with every change', async ({ page }) => {
    await page.goto('/')
    const before = await page.evaluate(() => window.history.length)
    const slider = page.getByRole('slider', { name: 'Incidence' })
    for (const value of ['1', '3', '5', '7']) {
      await slider.fill(value)
    }
    await page.waitForTimeout(600)
    expect(await page.evaluate(() => window.history.length)).toBe(before)
  })

  test('dismisses a notice', async ({ page }) => {
    await page.goto('/#v=1&p=naca0012&a=40')
    await expect(page.getByTestId('url-notices')).toBeVisible()
    await page.getByRole('button', { name: 'dismiss' }).click()
    await expect(page.getByTestId('url-notices')).toHaveCount(0)
  })
})
