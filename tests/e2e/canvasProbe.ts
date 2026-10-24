import { type Page, expect } from '@playwright/test'

/**
 * Framebuffer sampling, injected into the page.
 *
 * Reading pixels back is how these tests prove the renderer produced geometry; an image comparison
 * cannot, because a WebGL canvas can composite as empty while rendering perfectly. The function is
 * registered with `addInitScript` so both `evaluate` and `waitForFunction` can call it without
 * serialising a closure.
 */

export interface CanvasSample {
  readonly centre: number
  readonly corner: number
  /** Brightness across a horizontal line, for checking the frame is not uniform. */
  readonly row: number[]
}

declare global {
  interface Window {
    __sampleCanvas?: () => CanvasSample | null
    /** Frames the page has presented since load. */
    __frames?: number
  }
}

export async function installCanvasProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // A frame counter, so tests can wait for frames rather than for wall-clock time. Reading the
    // framebuffer before the first present returns zeros and keeps returning them, and "wait a
    // second" is not a frame on a runner without a GPU, where one frame can take half of one.
    window.__frames = 0
    const count = (): void => {
      window.__frames = (window.__frames ?? 0) + 1
      requestAnimationFrame(count)
    }
    requestAnimationFrame(count)

    window.__sampleCanvas = () => {
      const canvas = document.querySelector('canvas')
      if (!canvas || canvas.width === 0) return null
      const gl = canvas.getContext('webgl2')
      if (!gl) return null
      const read = (fx: number, fy: number): number => {
        const pixel = new Uint8Array(4)
        gl.readPixels(
          Math.floor(fx * canvas.width),
          Math.floor(fy * canvas.height),
          1,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixel,
        )
        return (pixel[0] ?? 0) + (pixel[1] ?? 0) + (pixel[2] ?? 0)
      }
      const row = [0.1, 0.25, 0.4, 0.55, 0.7, 0.85].map((x) => read(x, 0.5))
      return { centre: read(0.5, 0.5), corner: read(0.05, 0.95), row }
    }
  })
}

/** Brightness at which the section is unambiguously drawn rather than background. */
export const LIT_CENTRE = 150

export async function sampleCanvas(page: Page): Promise<CanvasSample | null> {
  return page.evaluate(() => window.__sampleCanvas?.() ?? null)
}

/**
 * Waits until the renderer has put the section on screen.
 *
 * `expect.poll` drives this from the test side rather than `page.waitForFunction`, which polls
 * inside the page: a predicate that calls `readPixels` from there kept returning black no matter
 * the polling mode, while the same call through `evaluate` returns the real framebuffer every time.
 */
export async function waitForRenderedSection(page: Page): Promise<void> {
  // A settle before the first read, which is not cosmetic. Reading the framebuffer before the
  // renderer's first present returns all zeros -- background included -- and keeps returning zeros
  // however long the poll then runs, so the first read has to happen after a real frame. Waiting on
  // two animation frames is the signal; the timeout that follows is headroom for a loaded machine,
  // where one second alone proved flaky.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            resolve()
          }),
        )
      }),
  )
  await page.waitForTimeout(1500)
  await expect
    .poll(async () => (await sampleCanvas(page))?.centre ?? 0, {
      // Generous: a runner without a GPU can take seconds per frame while the shaders compile.
      timeout: 45_000,
      intervals: [250, 250, 500, 500, 1000, 2000],
      message: 'renderer never drew the section into the canvas',
    })
    .toBeGreaterThan(LIT_CENTRE)
}
