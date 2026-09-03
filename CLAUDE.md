# workphlo — project instructions

Electron + React 19 + Zustand desktop app. Renderer talks to main over the
`window.workphlo.*` preload bridge (contextBridge → `ipcMain.handle('wf:*')`).

## Renderer safety (Electron is not a browser)

The renderer runs inside Electron, **not** a full browser. Several `window`
APIs that "just work" in a browser are unimplemented and **throw** at runtime:

- `window.prompt()` → `"prompt() is not supported."`
- `window.alert()` / `window.confirm()` → unsupported / no-op.

Do **not** use these. For text entry use an inline `<input>`
(`src/renderer/src/components/InlineInput.tsx`); for confirms/alerts use in-app
UI or an IPC call to a main-process dialog. This is exactly the bug that made
"create project", "add session", and "add section" silently fail — jsdom
implements `window.prompt`, so unit tests passed while the real app was broken.

## Testing policy — click real buttons, don't mock alone

A unit test that mocks the IPC bridge and asserts a store function was called
proves the wiring, **not** that the feature works in Electron. jsdom is a
browser-shaped stub; it does not reproduce Electron's runtime gaps. So:

1. **Every user-facing flow needs a real Electron e2e test.** Use Playwright's
   `_electron` against the built app in `out/` (`e2e/*.spec.ts`). Drive it the
   way a user does: `getByRole('button', …).click()`, `getByPlaceholder(…).fill()`,
   `.press('Enter')`. **Do not** substitute `win.evaluate(() => window.workphlo…)`
   direct-IPC calls for UI interaction — that bypasses the exact layer where the
   `window.prompt` bug lived. Direct-IPC `evaluate` is fine only to *seed* state
   (create a project/session) before exercising the UI under test.
2. **Assert the app produced no console errors.** Take the `consoleErrors`
   fixture (`e2e/fixtures.ts`) and `expect(consoleErrors).toEqual([])`. This is
   what catches "prompt() is not supported." and any other renderer throw —
   without it, a click that fires-and-forgets a rejected promise looks green.
3. **Unit tests complement, never replace, e2e.** Keep jsdom unit tests for
   branch logic (empty input, Escape, blur, disabled-while-generating), but the
   feature is not "done" until an e2e test clicks the actual button.

Before claiming a UI change works: `npm run typecheck && npm test && npm run test:e2e`.

See `.claude/skills/electron-renderer-safety/SKILL.md` for the detailed checklist.
