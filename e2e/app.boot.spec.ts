import { test, expect } from './fixtures'

// The regression guard for "the app doesn't work when starting": if the
// Electron binary is broken, the window fails to open, the renderer crashes,
// or the preload bridge is missing, these assertions fail loudly.
test.describe('app boot', () => {
  test('opens a window and mounts the renderer', async ({ win, consoleErrors }) => {
    // #root is populated only if React actually mounted.
    const root = win.locator('#root')
    await expect(root).not.toBeEmpty()

    // The three P0 shell regions must be present.
    await expect(win.getByPlaceholder('Ask the agent…')).toBeVisible()
    await expect(win.getByRole('button', { name: /send/i })).toBeVisible()

    // The typed preload bridge must be exposed to the renderer.
    const apiType = await win.evaluate(
      () => typeof (window as unknown as { workphlo?: unknown }).workphlo
    )
    expect(apiType).toBe('object')

    expect(consoleErrors, `renderer console errors:\n${consoleErrors.join('\n')}`).toEqual([])
  })

  test('creates a project + session and shows them in the tree', async ({ win }) => {
    // Drive the real IPC surface the way the UI will once wired up.
    await win.evaluate(async () => {
      const api = (
        window as unknown as {
          workphlo: {
            createProject(name: string): Promise<unknown>
            createSession(projectId: string, name: string): Promise<unknown>
          }
        }
      ).workphlo
      await api.createProject('Demo')
      await api.createSession('projects/demo', 'Round 1')
    })

    // TreePane loads on mount; re-trigger a load by reloading the window.
    await win.reload()
    await win.waitForLoadState('domcontentloaded')

    await expect(win.getByText('Demo')).toBeVisible()
    await expect(win.getByText('Round 1')).toBeVisible()
  })
})
