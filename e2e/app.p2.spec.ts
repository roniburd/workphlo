import { test, expect } from './fixtures'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// P2 live-document UI, asserted at the DOM level against the REAL built app and
// REAL IPC surface. No generation is driven (the `claude` CLI is unavailable
// headless): section bodies are seeded through the pure appendSection IPC and,
// where "stale" state is needed, session.json is edited on disk — both are real
// app state, never faked engine output.

// Seed a project + session + one section carrying real body text, all via the
// live IPC surface. Returns the deterministic sessionId and the new section id.
async function seed(
  win: import('@playwright/test').Page,
  project: string,
  session: string,
  body: string,
  format: 'md' | 'html' = 'md'
): Promise<{ sessionId: string; sectionId: string }> {
  return win.evaluate(
    async ({ project, session, body, format }) => {
      const api = (
        window as unknown as {
          workphlo: {
            createProject(name: string): Promise<unknown>
            createSession(projectId: string, name: string): Promise<unknown>
            appendSection(
              sessionId: string,
              spec: {
                type: string
                title: string
                hat: string
                format: string
                body?: string
              }
            ): Promise<{ newSectionId: string }>
          }
        }
      ).workphlo
      await api.createProject(project)
      const projectId = `projects/${project}`
      await api.createSession(projectId, session)
      const sessionId = `${projectId}/sessions/${session}`
      const res = await api.appendSection(sessionId, {
        type: 'summary',
        title: 'Seeded',
        hat: 'summarizer',
        format,
        body
      })
      return { sessionId, sectionId: res.newSectionId }
    },
    { project, session, body, format }
  )
}

test.describe('P2 live-document UI', () => {
  test('exposes an append-cell control and surfaces the ask menu on selection', async ({ win }) => {
    // Seed an HTML section so its body renders in the real sandboxed iframe. The
    // iframe reporter is the selection source for html cells; driving it exercises
    // the exact parent-side wiring a native selection would, and is the only path
    // available here because headless Blink paints no selection so
    // Selection.toString() (the md/code path's input) is always empty.
    const { sectionId } = await seed(
      win,
      'p2ask',
      'run',
      '<p id="para">The quick brown fox jumps the dog.</p>',
      'html'
    )

    await win.reload()
    await win.waitForLoadState('domcontentloaded')
    await win.getByText('run', { exact: true }).click()

    // Append-cell control (spec §5: add a first-class section to the doc).
    const addSection = win.getByRole('button', { name: '+ Add section' })
    await expect(addSection).toBeVisible()
    await expect(addSection).toBeEnabled()

    // The seeded html cell renders inside a sandboxed iframe.
    const cell = win.getByTestId(`section-${sectionId}`)
    const iframeEl = await cell.locator('iframe[title="section-html"]').elementHandle()
    if (!iframeEl) throw new Error('no section iframe')
    const frame = await iframeEl.contentFrame()
    if (!frame) throw new Error('no iframe content frame')
    await frame.waitForSelector('#para')

    // Emit the reporter's real wf:selection message FROM the sandboxed iframe, so
    // the parent's e.source === iframe.contentWindow security check passes and the
    // documented anchor payload drives the floating ask menu.
    await frame.evaluate((id) => {
      parent.postMessage(
        {
          type: 'wf:selection',
          sectionId: id,
          quote: 'quick brown',
          prefix: 'The ',
          suffix: ' fox jumps the dog.',
          startHint: 4,
          bodyHash: 'deadbeef',
          rect: { top: 10, left: 10, bottom: 24, right: 90, width: 80, height: 14 }
        },
        '*'
      )
    }, sectionId)

    const menu = win.getByRole('menu', { name: /ask about selection/i })
    await expect(menu).toBeVisible()
    // The pre-canned follow-ups + free-text ask are present.
    await expect(menu.getByRole('button', { name: 'Add detail' })).toBeVisible()
    await expect(menu.getByRole('button', { name: 'Expand' })).toBeVisible()
    await expect(menu.getByRole('textbox', { name: /free-text ask/i })).toBeVisible()
    // "Split here" is withheld for html cells (Fix 5): the rendered-text offset
    // can't be sliced back into the raw markup without cutting a tag.
    await expect(menu.getByRole('button', { name: 'Split here' })).toHaveCount(0)
  })

  test('a stale section shows a Refresh control', async ({ win, userDataDir }) => {
    const { sessionId, sectionId } = await seed(win, 'p2stale', 'run', 'Seeded body text here.')

    // Mark the seeded section stale in real app state (session.json on disk),
    // then reload so getDocument surfaces the stale status to the renderer.
    const metaPath = join(userDataDir, 'workspace', sessionId, 'session.json')
    const meta = JSON.parse(await readFile(metaPath, 'utf8'))
    meta.sectionStatus[sectionId] = 'stale'
    await writeFile(metaPath, JSON.stringify(meta, null, 2))

    await win.reload()
    await win.waitForLoadState('domcontentloaded')
    await win.getByText('run', { exact: true }).click()

    const cell = win.getByTestId(`section-${sectionId}`)
    // Stale status is rendered on the badge...
    await expect(cell.getByText('stale')).toBeVisible()
    // ...and a body-bearing section exposes a Refresh control (not Generate).
    await expect(cell.getByRole('button', { name: 'Refresh' })).toBeVisible()

    // The canvas-level "Refresh stale" batch control is enabled once any section
    // is stale.
    const refreshStale = win.getByRole('button', { name: 'Refresh stale' })
    await expect(refreshStale).toBeVisible()
    await expect(refreshStale).toBeEnabled()
  })
})
