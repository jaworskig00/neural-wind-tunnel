import { defineConfig, devices } from '@playwright/test'

const PORT = 5182
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  /**
   * One worker on CI.
   *
   * The runner has no GPU, so the flow field goes through SwiftShader at around a frame a second
   * at the top tier. Two of these tests running side by side do not take twice as long, they take
   * turns being starved, and both time out. This was invisible while the velocity field was never
   * written on a tier change -- frozen particles are cheap to draw -- and surfaced the moment the
   * renderer started doing the work it is supposed to do.
   */
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // The GPU work in later milestones needs a stable, known viewport for screenshots
    // and for the frame-time budgets measured in M6.
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          // Headless Chromium has no GPU, so WebGL needs ANGLE's software backend explicitly.
          // Without these the canvas renders nothing and every framebuffer read comes back zero,
          // which would make the scene assertions untestable in CI.
          args: [
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--enable-webgl',
            '--ignore-gpu-blocklist',
          ],
        },
      },
    },
  ],
  webServer: {
    command: `pnpm dev --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
