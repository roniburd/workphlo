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

  // Regression: the create flows must work through the REAL UI, not just direct
  // IPC. They previously used window.prompt(), which Electron does not support
  // ("prompt() is not supported."), so every + Project / + Session / + Add
  // section click silently failed. These drive the buttons the way a user does.
  test('creates a project and session through the UI (no window.prompt)', async ({
    win,
    consoleErrors
  }) => {
    await win.getByRole('button', { name: '+ Project' }).click()
    await win.getByPlaceholder('Project name').fill('UiProj')
    await win.getByPlaceholder('Project name').press('Enter')
    await expect(win.getByText('UiProj')).toBeVisible()

    // Add a session under it via its inline + Session affordance.
    await win.getByText('UiProj').hover()
    await win.getByRole('button', { name: 'Add session to UiProj' }).click()
    await win.getByPlaceholder('Session name').fill('UiSess')
    await win.getByPlaceholder('Session name').press('Enter')
    await expect(win.getByText('UiSess')).toBeVisible()

    // No "prompt() is not supported." (or any) console errors were produced.
    expect(consoleErrors, `renderer console errors:\n${consoleErrors.join('\n')}`).toEqual([])
  })

  test('adds a section through the UI and can send a prompt', async ({ win, consoleErrors }) => {
    // Seed a project+session via IPC (creation itself is covered above), then
    // drive the canvas + prompt bar through the UI.
    await win.evaluate(async () => {
      const api = (
        window as unknown as {
          workphlo: {
            createProject(name: string): Promise<unknown>
            createSession(projectId: string, name: string): Promise<unknown>
          }
        }
      ).workphlo
      await api.createProject('Flow')
      await api.createSession('projects/flow', 'F1')
    })
    await win.reload()
    await win.waitForLoadState('domcontentloaded')
    await win.getByText('F1', { exact: true }).click()

    // + Add section is now an inline input, not window.prompt.
    await win.getByRole('button', { name: '+ Add section' }).click()
    await win.getByLabel('New section title').fill('My Cell')
    await win.getByLabel('New section title').press('Enter')
    await expect(win.getByRole('heading', { name: 'My Cell' })).toBeVisible()

    // The prompt bar accepts input and the Send click fires without error.
    await win.getByPlaceholder('Ask the agent…').fill('hello')
    await win.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(win.getByPlaceholder('Ask the agent…')).toHaveValue('')

    // No unsupported-API or other console errors surfaced while driving the
    // canvas + prompt bar (the original bug threw "prompt() is not supported.").
    expect(consoleErrors, `renderer console errors:\n${consoleErrors.join('\n')}`).toEqual([])
  })
})
