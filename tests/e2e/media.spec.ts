import { expect, test } from '@playwright/test'

/**
 * The media in the README, captured from the running app rather than drawn.
 *
 * Skipped unless `CAPTURE_MEDIA=1`, because these are slow -- several seconds each, waiting for
 * particles to build a trail worth looking at -- and because a screenshot that changes on every
 * commit is noise in a diff. Run them deliberately:
 *
 *     CAPTURE_MEDIA=1 pnpm exec playwright test media
 *
 * The frames for the hero animation land in `docs/media/frames`; `scripts/make-hero.sh` turns them
 * into the GIF. Everything here uses a deep link, so each capture is reproducible from its URL.
 */

const CAPTURE = process.env['CAPTURE_MEDIA'] === '1'

/**
 * The real GPU, not SwiftShader.
 *
 * The rest of the suite runs on ANGLE's software backend because CI has no GPU, and a million
 * particles at six frames a second makes a still that is honest about the renderer and dishonest
 * about the app. These captures are made on the machine's own GPU, which is what a visitor has.
 */
test.use({
  // Headed, because a headless Chromium has no compositor driving requestAnimationFrame: the
  // particles take a handful of steps and the capture shows them still bunched at the inflow.
  headless: false,
  launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] },
})

test.describe('demo media', () => {
  test.skip(!CAPTURE, 'set CAPTURE_MEDIA=1 to capture')
  test.describe.configure({ mode: 'serial' })

  /** Park the pointer off every interactive element, so no hover readout is in the capture. */
  async function parkPointer(page: import('@playwright/test').Page) {
    await page.mouse.move(8, 200)
  }

  async function settle(page: import('@playwright/test').Page, ms: number) {
    await expect(page.getByTestId('inference-status')).toBeVisible()
    await page.waitForTimeout(ms)
  }

  // The default camera is the one the viewport was composed for; overriding it in a capture
  // mostly produces a worse version of the same picture.
  test('particles and the pressure colormap', async ({ page }) => {
    await page.goto('/#v=1&p=naca4412&a=6&view=particles')
    await settle(page, 1000)
    // The tier is pinned in the link rather than clicked, so the capture never races the probe,
    // and the wait is long because the particles are seeded in a band at the inflow: a capture
    // taken too early shows that band rather than a developed field.
    await page.getByRole('slider', { name: 'Trails' }).fill('0.5')
    await page.waitForTimeout(9000)
    await parkPointer(page)
    await page.screenshot({ path: 'docs/screenshots/particles.png' })
  })

  test('streamlines', async ({ page }) => {
    await page.goto('/#v=1&p=naca4412&a=8&view=streamlines')
    await settle(page, 3000)
    await parkPointer(page)
    await page.screenshot({ path: 'docs/screenshots/streamlines.png' })
  })

  test('the pressure distribution against the exact solver', async ({ page }) => {
    await page.goto('/#v=1&p=naca0012&a=4&view=surface&cam=0,4,1.6')
    await settle(page, 2000)
    await expect(page.getByTestId('overlay-active')).toBeVisible()
    await parkPointer(page)
    await page.screenshot({ path: 'docs/screenshots/pressure.png' })
  })

  test('the polars', async ({ page }) => {
    await page.goto('/#v=1&p=naca4412&a=4&view=surface')
    await settle(page, 1000)
    await page.getByRole('button', { name: 'polars' }).click()
    await expect(page.getByTestId('polar-status')).toContainText('swept')
    await parkPointer(page)
    await page.screenshot({ path: 'docs/screenshots/polars.png' })
  })

  test('the assistant', async ({ page }) => {
    await page.goto('/#v=1&p=naca2412&a=2&view=particles')
    await settle(page, 1000)
    // Turned down: the panel is the subject here, and opening it narrows the viewport, which
    // concentrates the same particles into fewer texels and brightens the field (see Q10).
    await page.getByRole('slider', { name: 'Trails' }).fill('0.2')
    await page.waitForTimeout(4000)
    await page.getByTestId('assistant-toggle').click()
    await page.getByRole('button', { name: /fifteen per cent thinner/ }).click()
    await expect(page.getByTestId('assistant-panel')).toContainText('% chord')
    await page.waitForTimeout(1500)
    await parkPointer(page)
    await page.screenshot({ path: 'docs/screenshots/assistant.png' })
  })

  test('hero frames', async ({ page }) => {
    await page.goto('/#v=1&p=naca2412&a=0&view=particles&cam=18,14,2.0')
    await settle(page, 1000)
    // Turned up for the animation. Each step of the sweep gives the buffer a sixth of a second to
    // build, against a trail time constant of about four tenths, so at the default exposure the
    // flow never quite catches up with the incidence.
    await page.getByRole('slider', { name: 'Trails' }).fill('1.1')
    await page.waitForTimeout(7000)

    // Sweep the incidence across the trained range and back, one frame per step. The surrogate
    // re-predicts on every one, so the field in the animation is recomputed, not interpolated.
    const incidence = page.getByRole('slider', { name: 'Incidence' })
    const stops: number[] = []
    for (let i = 0; i <= 24; i += 1) stops.push(-4 + (12 * i) / 24)
    for (let i = 23; i > 0; i -= 1) stops.push(-4 + (12 * i) / 24)

    await parkPointer(page)
    for (const [index, alpha] of stops.entries()) {
      // `fill` wants a value on the step grid exactly; a trailing zero is not one.
      await incidence.fill(String(Math.round(alpha * 10) / 10))
      await page.waitForTimeout(160)
      await page.screenshot({
        path: `docs/media/frames/hero-${String(index).padStart(3, '0')}.png`,
        // The viewport alone: a clip that cuts the parameter panel in half looks like a bug.
        clip: { x: 0, y: 70, width: 960, height: 640 },
      })
    }
  })
})
