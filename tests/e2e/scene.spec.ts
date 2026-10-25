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

/**
 * The flow has to be visible, and visible everywhere the field is.
 *
 * This guards a bug that reached production: the trail buffer decayed per second but was deposited
 * into per frame, so its steady-state brightness scaled with the frame rate. On a 120 Hz display
 * the dense band of freshly seeded particles at the inlet saturated to white in under a second and
 * the rest of the field — two orders of magnitude sparser — never crossed the first visible step.
 * The tunnel looked empty with a bright stripe down its left edge.
 *
 * `trails.test.ts` holds the arithmetic, and that is the test that actually catches this bug: it
 * is parametric in frame time and needs no GPU. This one cannot, and the reason is worth writing
 * down — CI renders through SwiftShader at around eight frames a second, which is precisely where
 * the broken arithmetic happens to look correct. Restoring the bug leaves this test green.
 *
 * It earns its place for a different failure: the flow must reach the part of the viewport
 * downstream of the section, and must not be dwarfed by whatever is at the inlet. That covers a
 * dead field, a broken mask, particles that never advect, and an inlet that saturates.
 */
test.describe('the flow field is visible across the domain', () => {
  // Self-paced rather than clock-paced. A particle needs about five seconds of simulated time to
  // cross three chords, and the step clamps each frame to 1/30 s, so a runner managing two frames
  // a second advances the simulation at a fifteenth of real time. Polling lets a GPU finish in
  // seconds and still gives SwiftShader the minutes it needs.
  test('downstream of the section, not only at the inlet', async ({ page }) => {
    test.setTimeout(240_000)
    await installCanvasProbe(page)
    await page.goto('/#v=1&p=naca2412&a=2&view=particles&tier=low')
    await waitForRenderedSection(page)

    const bands = async () =>
      page.evaluate(() => {
        const canvas = document.querySelector('canvas')
        if (!canvas) return null
        const gl = canvas.getContext('webgl2')
        if (!gl) return null
        const { width, height } = canvas
        const pixels = new Uint8Array(width * height * 4)
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)

        // The upper quarter only: above the section, where nothing but flow is drawn.
        const mean = (from: number, to: number) => {
          let sum = 0
          let count = 0
          for (let y = Math.floor(height * 0.72); y < height; y += 3) {
            for (let x = Math.floor(width * from); x < Math.floor(width * to); x += 3) {
              const i = (y * width + x) * 4
              sum += ((pixels[i] ?? 0) + (pixels[i + 1] ?? 0) + (pixels[i + 2] ?? 0)) / 3
              count += 1
            }
          }
          return count === 0 ? 0 : sum / count
        }

        return { inlet: mean(0, 0.12), middle: mean(0.4, 0.7), outlet: mean(0.78, 0.98) }
      })

    // Wait for the field to develop, then assert. The poll's threshold is the "is there flow
    // downstream" question; the assertion afterwards is the "does the inlet drown it" question.
    await expect
      .poll(
        async () => {
          const sample = await bands()
          return Math.min(sample?.middle ?? 0, sample?.outlet ?? 0)
        },
        {
          timeout: 180_000,
          message: 'the flow never reached the middle or the outlet of the domain',
        },
      )
      .toBeGreaterThan(8)

    const settled = await bands()
    expect(settled).not.toBeNull()
    if (!settled) return

    // The inlet is legitimately the brightest band -- every respawn happens there, so it is the
    // densest part of the field. What must not happen is it being the *only* visible band, which
    // is what an exposure that saturates looks like: in the broken build the middle sampled at
    // essentially zero and this ratio had no upper bound at all.
    expect(
      settled.inlet / Math.max(settled.middle, 1),
      `inlet ${settled.inlet.toFixed(1)} against mid-domain ${settled.middle.toFixed(1)}`,
    ).toBeLessThan(4)
  })
})
