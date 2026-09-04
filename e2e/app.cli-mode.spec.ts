import { test, expect } from './fixtures'

// P3 CLI mode: proves a CLI session mounts the real xterm terminal + the
// ArtifactPane split, driven entirely through the UI the "+ CLI" affordance
// exposes on TreePane (per Task 9's review finding: the create flow must be
// exercised via real clicks/InlineInput, not window.evaluate direct-IPC —
// that's exactly the layer where the window.prompt() bug lived).
test.describe('CLI mode', () => {
  test('creating a CLI session mounts the terminal + artifact split', async ({
    win,
    consoleErrors
  }) => {
    // Seeding the *project* via direct IPC is fine — the project flow isn't
    // under test here (it's covered by app.boot.spec.ts).
    await win.evaluate(async () => {
      const api = (
        window as unknown as {
          workphlo: { createProject(name: string): Promise<unknown> }
        }
      ).workphlo
      await api.createProject('CliProj')
    })
    await win.reload()
    await win.waitForLoadState('domcontentloaded')

    // Create the CLI session through the real "+ CLI" button + InlineInput —
    // this is the flow under test.
    await win.getByText('CliProj').hover()
    await win.getByRole('button', { name: 'Add CLI session to CliProj' }).click()
    await win.getByPlaceholder('CLI session name').fill('Shell1')
    await win.getByPlaceholder('CLI session name').press('Enter')
    await expect(win.getByText('Shell1')).toBeVisible()

    // Select the resulting session and assert the split view renders.
    await win.getByText('Shell1', { exact: true }).click()

    await expect(win.getByText(/no result yet/i)).toBeVisible()
    await expect(win.locator('.xterm')).toBeVisible({ timeout: 10_000 })

    // No renderer console errors (this is what catches the historic
    // window.prompt() bug and any other renderer throw along this path).
    expect(consoleErrors, `renderer console errors:\n${consoleErrors.join('\n')}`).toEqual([])
  })
})
