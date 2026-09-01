import {
  test as base,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

interface WorkphloFixtures {
  app: ElectronApplication
  win: Page
  consoleErrors: string[]
}

// Launches the built Electron app (out/main/index.js via `.`) with an isolated,
// throwaway workspace so tests never touch the user's real userData dir.
export const test = base.extend<WorkphloFixtures>({
  // eslint-disable-next-line no-empty-pattern
  app: async ({}, use) => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'workphlo-e2e-'))
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' }
    })
    await use(app)
    await app.close()
  },
  win: async ({ app }, use) => {
    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')
    await use(win)
  },
  consoleErrors: async ({ win }, use) => {
    const errors: string[] = []
    win.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })
    win.on('pageerror', (e) => errors.push(e.message))
    await use(errors)
  }
})

export { expect } from '@playwright/test'
