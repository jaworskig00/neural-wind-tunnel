import { expect, test } from '@playwright/test'

import { LIT_CENTRE, installCanvasProbe, sampleCanvas, waitForRenderedSection } from './canvasProbe'

/**
 * Scene checks.
 *
 * The framebuffer is read rather than compared against a reference image: that asserts the renderer
 * actually produced geometry, which an image comparison does not. `preserveDrawingBuffer` is on in
 * the viewport for the same reason, so the captures committed under `docs/screenshots` contain the
 * scene, and `playwright.config.ts` turns on ANGLE's software backend because headless Chromium has
 * no GPU and would otherwise render nothing at all.
 */

test.describe('viewport', () => {
  test.beforeEach(async ({ page }) => {
    await installCanvasProbe(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Neural Wind Tunnel' })).toBeVisible()
  })

  test('draws the section into the canvas', async ({ page }) => {
    // Poll rather than wait a fixed time: the first frames land whenever the GPU gets to them.
    await waitForRenderedSection(page)

    const sample = await sampleCanvas(page)
    expect(sample?.centre, 'section is lit in the middle of the viewport').toBeGreaterThan(
      LIT_CENTRE,
    )

    // Not "the corner is dark": the flow field fills the frame with trails, so darkness there
    // would mean the particles are missing. What still distinguishes a working render from a
    // broken one is that the frame carries structure rather than one flat value.
    const row = sample?.row ?? []
    expect(row.length).toBeGreaterThan(3)
    const spread = Math.max(...row) - Math.min(...row)
    expect(spread, 'the frame carries structure rather than one flat value').toBeGreaterThan(10)
    expect(Math.max(...row), 'the frame is not saturated to white').toBeLessThan(760)
  })

  test('the flow field lights the background', async ({ page }) => {
    // With particles switched off the background is the scene's own near-black; with them on the
    // trails raise it. This is what proves the GPGPU path ran, rather than that a canvas exists.
    //
    // Polled rather than read once: the trails build up over the first second or so, and on a
    // software renderer that is several seconds.
    await waitForRenderedSection(page)
    await expect
      .poll(async () => (await sampleCanvas(page))?.corner ?? 0, {
        timeout: 30_000,
        intervals: [500, 500, 1000, 1000, 2000],
        message: 'the trails never brightened the background',
      })
      .toBeGreaterThan(40)
  })

  test('reports the metrics of the default section', async ({ page }) => {
    // NACA 2412 fitted to CST: 12.0 % thick at 30.8 % chord, 2.0 % camber at 42.2 % chord.
    await expect(page.getByText('12.01 % c', { exact: true })).toBeVisible()
    await expect(page.getByText('2.01 % c', { exact: true })).toBeVisible()
  })

  test('rebuilds geometry and metrics when a preset changes', async ({ page }) => {
    await expect(page.getByText('12.01 % c', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'NACA 0008' }).click()
    // A symmetric 8 % section: thinner, and with no camber left.
    await expect(page.getByText('8.00 % c', { exact: true })).toBeVisible()
    await expect(page.getByText('0.00 % c', { exact: true })).toBeVisible()
  })

  test('marks the section as edited once a shape control is used', async ({ page }) => {
    // A test id rather than the text: the chart caption also mentions an edited section, and a
    // substring match on "Edited" matched both.
    await expect(page.getByTestId('section-edited')).toHaveCount(0)
    await page.getByRole('button', { name: 'Thinner' }).click()
    await expect(page.getByTestId('section-edited')).toBeVisible()
  })

  test('shows the exact solver curve for a preset and withdraws it once edited', async ({
    page,
  }) => {
    // The overlay is the project's honesty claim made visible, so it is worth a test of its own.
    await expect(page.getByTestId('overlay-active')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('overlay-active')).toContainText('exact solver')
    await page.getByRole('button', { name: 'Thinner' }).click()
    await expect(page.getByTestId('overlay-active')).toHaveCount(0)
    await expect(page.getByText('no solver reference')).toBeVisible()
  })

  test('captures the reference screenshot', async ({ page }) => {
    await waitForRenderedSection(page)
    const shot = await page.screenshot({ path: 'docs/screenshots/app-m4-shell.png' })
    expect(shot.length).toBeGreaterThan(10_000)
  })
})

test.describe('polars', () => {
  test('sweeps the incidence range and marks the operating point', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'polars' }).click()

    await expect(page.getByTestId('polar-chart')).toBeVisible()
    // The sweep runs a few points per animation frame rather than blocking for all of them.
    await expect(page.getByTestId('polar-status')).toContainText('swept across', {
      timeout: 20_000,
    })
    await expect(page.getByRole('img', { name: 'Cl against α' })).toBeVisible()
    await expect(page.getByRole('img', { name: 'Cl against Cd' })).toBeVisible()
  })

  test('re-sweeps when the section changes', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'polars' }).click()
    await expect(page.getByTestId('polar-status')).toContainText('swept across', {
      timeout: 20_000,
    })

    await page.getByRole('button', { name: 'NACA 4412' }).click()
    await expect(page.getByTestId('polar-status')).toContainText('swept across', {
      timeout: 20_000,
    })
  })

  test('switches back to the pressure plot', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'polars' }).click()
    await expect(page.getByTestId('polar-chart')).toBeVisible()
    await page.getByRole('button', { name: 'pressure' }).click()
    await expect(page.getByTestId('cp-chart')).toBeVisible()
    await expect(page.getByTestId('polar-chart')).toHaveCount(0)
  })
})
