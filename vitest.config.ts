import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Unit tests live next to the module they cover. Playwright owns `tests/e2e`.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/main.tsx'],
    },
  },
})
