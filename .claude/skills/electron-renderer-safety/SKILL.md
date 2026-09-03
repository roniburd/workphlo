---
name: electron-renderer-safety
description: Use when adding or changing any renderer UI, IPC flow, or test in this Electron app (workphlo) — enforces no unsupported browser APIs in the renderer and requires real button-clicking Playwright _electron e2e tests instead of mock-only unit tests.
---

# Electron renderer safety & real-UI testing

## Why this skill exists

A "create project / add session / add section" bug shipped green: the renderer
called `window.prompt()`, which **Electron does not implement** (it throws
`"prompt() is not supported."`). jsdom — the unit-test DOM — *does* implement
`window.prompt`, so every unit test passed while the real app was broken on
every one of those buttons. The tests mocked the IPC bridge and asserted a
store function was called; nothing ever clicked the button inside real Electron.

Two root causes, two rules below.

## Rule 1 — the renderer is not a browser

Electron's renderer leaves several `window` APIs unimplemented; calling them
**throws** or no-ops at runtime:

| API | Behavior in Electron |
| --- | --- |
| `window.prompt()` | throws `"prompt() is not supported."` |
| `window.alert()` | unsupported |
| `window.confirm()` | unsupported |

**Do not use them.** Instead:

- Text entry → inline `<input>`. Reuse `src/renderer/src/components/InlineInput.tsx`
  (Enter/✓ submit, Escape/✕ cancel, blur cancels only when empty, focus returns
  to the trigger). Don't hand-roll another one.
- Confirm / alert → in-app UI, or IPC to a main-process `dialog.*`.

When you touch renderer code, scan the diff for `window.prompt|alert|confirm`
before you finish.

## Rule 2 — tests click real buttons; mocks alone don't count

A jsdom unit test that mocks `window.workphlo` and asserts an action fired
proves the *wiring*, not that the feature works in Electron. jsdom is a
browser-shaped stub and does **not** reproduce Electron's runtime gaps.

For any user-facing flow you add or change:

1. **Add / update a Playwright `_electron` e2e test** (`e2e/*.spec.ts`) that runs
   against the built app in `out/`. Drive it as a user would:
   - `win.getByRole('button', { name: … }).click()`
   - `win.getByPlaceholder(…).fill(…)` / `win.getByLabel(…).fill(…)`
   - `.press('Enter')`, `.click()` on the confirm control
   Assert the visible outcome (`await expect(win.getByText(…)).toBeVisible()`).
2. **Do NOT replace UI interaction with direct IPC.** `win.evaluate(() =>
   window.workphlo.createProject(…))` bypasses the exact renderer layer where the
   bug lived. Direct-IPC calls are allowed **only to seed** preconditions (e.g.
   create a project+session) before the UI actions under test.
3. **Assert zero console errors.** Take the `consoleErrors` fixture from
   `e2e/fixtures.ts` and end the test with:
   ```ts
   expect(consoleErrors, `renderer console errors:\n${consoleErrors.join('\n')}`).toEqual([])
   ```
   This is what would have caught the original bug: a fire-and-forget click
   whose promise rejects looks green without it.
4. **Keep unit tests for branch logic** — empty input, Escape, blur, disabled-
   while-generating — but they *complement* the e2e test; they never replace it.

## Definition of done for a UI change

- [ ] No `window.prompt/alert/confirm` in the renderer diff.
- [ ] A Playwright `_electron` test drives the new/changed flow by clicking real
      controls (not direct IPC), and asserts the visible result.
- [ ] That e2e test takes `consoleErrors` and asserts `toEqual([])`.
- [ ] Unit tests cover the edge branches.
- [ ] `npm run typecheck && npm test && npm run test:e2e` all pass.
