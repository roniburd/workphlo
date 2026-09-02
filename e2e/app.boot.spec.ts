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

  test('selecting a session renders the template-scaffolded section canvas', async ({ win }) => {
    await win.evaluate(async () => {
      const api = (
        window as unknown as {
          workphlo: {
            createProject(name: string): Promise<unknown>
            createSession(projectId: string, name: string): Promise<unknown>
          }
        }
      ).workphlo
      await api.createProject('Canvas')
      await api.createSession('projects/canvas', 'Slice')
    })
    await win.reload()
    await win.waitForLoadState('domcontentloaded')

    // Before selection, the canvas shows its empty hint.
    await expect(win.getByText(/select a session/i)).toBeVisible()

    await win.getByText('Slice').click()

    // The spec-design template's four sections render as typed cells.
    for (const title of ['Summary', 'Requirements', 'Design', 'Open Questions']) {
      await expect(win.getByRole('heading', { name: title })).toBeVisible()
    }
    // Freshly scaffolded sections are empty with a placeholder + status badge.
    await expect(win.getByText('Not generated yet.').first()).toBeVisible()
    await expect(win.getByTestId('section-summary').getByText(/empty/i)).toBeVisible()
  })

  test('exposes the generation controls on the tree and section canvas', async ({ win }) => {
    // The "+ Project" affordance lives in the tree header and is interactive.
    const addProject = win.getByRole('button', { name: '+ Project' })
    await expect(addProject).toBeVisible()
    await expect(addProject).toBeEnabled()

    await win.evaluate(async () => {
      const api = (
        window as unknown as {
          workphlo: {
            createProject(name: string): Promise<unknown>
            createSession(projectId: string, name: string): Promise<unknown>
          }
        }
      ).workphlo
      await api.createProject('Gen')
      await api.createSession('projects/gen', 'Run')
    })
    await win.reload()
    await win.waitForLoadState('domcontentloaded')
    await win.getByText('Run').click()

    // The canvas-level "Generate all" control exists and is interactive.
    const generateAll = win.getByRole('button', { name: 'Generate all' })
    await expect(generateAll).toBeVisible()
    await expect(generateAll).toBeEnabled()

    // Each section cell exposes a per-section Generate button and a model-override select.
    const summary = win.getByTestId('section-summary')
    await expect(summary.getByRole('button', { name: 'Generate' })).toBeVisible()
    const modelSelect = summary.getByRole('combobox', { name: /Model for Summary/i })
    await expect(modelSelect).toBeVisible()
    await expect(modelSelect).toBeEnabled()
    // The override select offers the inherit default plus pinned model choices.
    await expect(modelSelect.locator('option')).not.toHaveCount(0)
  })
})
