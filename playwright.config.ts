import { defineConfig } from '@playwright/test'

// E2E tests drive the real, built Electron app (out/). Run `npm run build`
// first (the `test:e2e` script does this for you). Kept separate from the
// Vitest unit suite (src/**/*.test.ts) which never launches Electron.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 }
})
