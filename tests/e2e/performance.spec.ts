import { expect, test } from '@playwright/test'

import { installCanvasProbe, waitForRenderedSection } from './canvasProbe'

/**
 * Frame-time measurement.
 *
 * Runs against whatever renderer the browser offers, which in continuous integration is ANGLE's
 * software backend -- the slowest thing the app will ever run on, and therefore a useful floor. The
 * numbers in `docs/perf.md` come from here and from the same measurement on real hardware.
 *
 * The assertion is deliberately loose. This is not a benchmark gate: a shared runner's frame times
 * are not reproducible enough to fail a build over. What it does catch is a regression that stops
 * the loop entirely or makes it pathologically slow.
 */

interface FrameStats {
  readonly median: number
  readonly p95: number
  readonly frames: number
}

async function measureFrames(page: import('@playwright/test').Page): Promise<FrameStats> {
  return page.evaluate(async () => {
    const samples: number[] = []
    let last = performance.now()
    await new Promise<void>((resolve) => {
      let count = 0
      const tick = (): void => {
        const now = performance.now()
        samples.push(now - last)
        last = now
        count += 1
        if (count < 150) requestAnimationFrame(tick)
        else resolve()
      }
      requestAnimationFrame(tick)
    })
    // The first frames pay for shader compilation and the first texture uploads.
    const sorted = samples.slice(30).sort((a, b) => a - b)
    return {
      median: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
      p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      frames: sorted.length,
    }
  })
}

test.describe('flow field performance', () => {
  for (const tier of ['low', 'mid', 'high'] as const) {
    test(`sustains a frame loop at the ${tier} tier`, async ({ page }) => {
      await installCanvasProbe(page)
      await page.goto('/')
      await waitForRenderedSection(page)

      await page.getByRole('button', { name: tier, exact: true }).click()
      await expect(page.getByTestId('flow-status')).toContainText(tier, { timeout: 15_000 })
      // Let the new tier settle before measuring it.
      await page.waitForTimeout(1500)

      const stats = await measureFrames(page)
       
      console.log(
        `  ${tier}: median ${stats.median.toFixed(1)} ms, p95 ${stats.p95.toFixed(1)} ms ` +
          `over ${stats.frames} frames`,
      )

      expect(stats.frames, 'the frame loop keeps running').toBeGreaterThan(100)
      expect(stats.median, 'frames are not pathologically slow').toBeLessThan(400)
    })
  }

  test('the automatic tier reports what it settled on', async ({ page }) => {
    await installCanvasProbe(page)
    await page.goto('/')
    await waitForRenderedSection(page)
    await expect(page.getByTestId('flow-status')).toContainText('particles', { timeout: 15_000 })
  })
})
