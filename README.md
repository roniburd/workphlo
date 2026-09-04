# workphlo

A local, Electron-based, Obsidian/VSCode-like workbench for driving Claude Code.
Instead of a scrolling transcript, each session produces a **live document** made
of typed **sections** ("cells"), each owned by a specialist agent ("hat") with its
own engine + model.

See the design spec and implementation plans under `docs/superpowers/`.

## CLI Mode (experimental)

Alongside the live-document mode, a session can be created in **CLI mode**
(the tree's "+ CLI" affordance). A CLI session mounts a split view: a real
interactive terminal (xterm.js over a `node-pty`-spawned `claude` process) on
the left, and a live "artifact" pane on the right that renders
`result.html` as the agent writes it in the session's working directory.

**Native module build.** `node-pty` ships a native (`.node`) addon compiled
against a specific ABI. Because Electron embeds its own Node version, the
addon must be rebuilt against Electron's ABI rather than the system Node's —
`npm install`'s `postinstall` script (`electron-builder install-app-deps`)
does this automatically. If `node-pty` ever fails to load (e.g. after
switching Node/Electron versions), re-run `npm run postinstall` or
`npx electron-builder install-app-deps`. `electron.vite.config.ts` also marks
`node-pty` as external via `externalizeDepsPlugin()` in the main process build
so Vite doesn't try to bundle the native binding.

**Packaging caveats (not yet wired into `electron-builder.yml`, needed before
CLI mode ships in a packaged build):**
- `node-pty`'s compiled `.node` file must be listed under `asarUnpack` (the
  current config only unpacks `resources/**`) — native addons cannot be
  `dlopen`'d from inside an `asar` archive.
- On macOS, `node-pty` also ships a `spawn-helper` binary that it `spawn()`s
  directly. Even when asar-unpacked, the file loses its executable bit when
  extracted/copied during packaging, so it must have `chmod +x` applied to it
  at runtime (e.g. on app startup) before the first pty is spawned, or spawning
  will fail with `EACCES`.

**Steering.** Each CLI session's working directory is scaffolded (see
`scaffoldCliSession` in `src/main/pty/scaffold.ts`) with a project-scoped
Claude Code skill at `.claude/skills/workphlo-html-report/SKILL.md`, plus
hooks in `.claude/settings.json` that notify the app when `result.html`
changes. The `claude` process itself is launched with
`--append-system-prompt` text (see `steeringSystemPrompt()` in the same file)
telling the agent to keep `result.html` up to date as its result evolves —
that file is what the artifact pane renders.

## Project Setup

```bash
npm install      # install dependencies
npm run dev      # run the app in development
npm test         # run the Vitest suite
npm run typecheck
npm run build    # typecheck + build
```
