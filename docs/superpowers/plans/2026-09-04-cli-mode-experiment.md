# CLI Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an additive experimental "CLI Mode" session that embeds the real interactive `claude` CLI (node-pty + xterm.js) beside a live-rendered HTML artifact pane, steered by an on-disk skill + system-prompt append.

**Architecture:** node-pty runs only in the Electron main process; xterm.js only in the renderer; bytes cross the existing preload bridge. Claude is steered to write `result.html` into the session cwd via a scaffolded `.claude/skills/` skill + `--append-system-prompt`. The file surfaces via a Claude Code `Stop` hook (loopback HTTP, mtime-gated) and a hardened file watcher, rendered through the existing sandboxed `HtmlBody` iframe.

**Tech Stack:** Electron 39, electron-vite 5 + Vite 7, React 19, Zustand 5, TailwindCSS 3, TypeScript 5, Vitest 4, Playwright. New: `node-pty`, `@xterm/xterm`, `@xterm/addon-fit`.

**Spec:** `docs/superpowers/specs/2026-09-04-cli-mode-experiment-design.md`

## Global Constraints

- **Security boundary is immovable:** renderer runs `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The renderer NEVER spawns processes or touches fs — everything goes through `window.workphlo` → IPC → main.
- **Path trust boundary:** every session-dir path in main resolves through `abs(root, sessionId)` (`src/main/workspace/paths.ts`), which throws if the id escapes the workspace root. Never `join` raw ids.
- **DI for testability:** native/OS side-effects are injected via a `deps` param with a real default, mirroring `createCliEngine(deps: { spawn?: typeof realSpawn } = {})`.
- **Naming:** the existing `EngineKind = 'cli' | 'sdk'` (headless execution adapter) is a DIFFERENT concept from this feature's session `mode: 'cli'` (interactive embedded terminal). Keep `mode` and `engine` distinct; never conflate.
- **Atomic writes:** persisted JSON/docs use the existing `writeFileAtomic` pattern in `workspace.ts`.
- **Backward compat:** `SessionMeta.mode` is optional; absent ⇒ `'document'`. Existing document sessions and their tests must be untouched.
- **HTML artifact renders only inside the existing locked-down sandbox** (`HtmlBody`, `sandbox="allow-scripts"`, per-render nonce CSP). Do not introduce a second, weaker sandbox.
- Tests: Vitest (`describe/it/expect`), files co-located as `*.test.ts(x)`, jsdom env, globals on (`vitest.config.ts`). Run `npm test` / `npm run typecheck` before commits.

---

### Task 1: Session mode + CLI-session scaffold

Adds the `mode` field and the on-disk steering (skill + hook `settings.json`). Pure fs/string logic — no native deps, fully unit-testable.

**Files:**
- Modify: `src/shared/types.ts` (add `mode` to `SessionMeta`)
- Create: `src/main/pty/scaffold.ts`
- Modify: `src/main/workspace/workspace.ts:53-78` (`createSession` gains `mode`)
- Test: `src/main/pty/scaffold.test.ts`
- Test: `src/main/workspace/workspace.test.ts` (extend — add a `mode: 'cli'` case)

**Interfaces:**
- Produces:
  - `SessionMeta.mode?: 'document' | 'cli'`
  - `HOOK_COMMAND: string` — the shell command written into `settings.json` hooks.
  - `steeringSystemPrompt(): string` — text for `--append-system-prompt`.
  - `async scaffoldCliSession(cwd: string): Promise<void>` — writes `.claude/skills/workphlo-html-report/SKILL.md` and `.claude/settings.json` under `cwd`.
- Consumes: `createSession(root, projectId, name, templateId, engine, mode?)` — new optional trailing `mode` param (default `'document'`).

- [ ] **Step 1: Add `mode` to `SessionMeta`**

In `src/shared/types.ts`, add to the `SessionMeta` interface (after `engine`):

```ts
  // Session experience mode. 'document' (default) = the live-section document.
  // 'cli' = embedded interactive `claude` terminal + live HTML artifact pane.
  // Distinct from `engine` (the headless execution adapter kind). Optional so
  // pre-existing session.json (no field) reads back as 'document'.
  mode?: 'document' | 'cli'
```

- [ ] **Step 2: Write the failing scaffold test**

Create `src/main/pty/scaffold.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scaffoldCliSession, HOOK_COMMAND, steeringSystemPrompt } from './scaffold'

describe('scaffoldCliSession', () => {
  it('writes the html-report skill and a Stop hook settings.json', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'wf-scaffold-'))
    await scaffoldCliSession(cwd)

    const skill = await readFile(
      join(cwd, '.claude/skills/workphlo-html-report/SKILL.md'),
      'utf8'
    )
    expect(skill).toContain('result.html')
    expect(skill.startsWith('---')).toBe(true) // has frontmatter

    const settings = JSON.parse(await readFile(join(cwd, '.claude/settings.json'), 'utf8'))
    const stopHooks = settings.hooks.Stop
    expect(stopHooks[0].hooks[0].command).toBe(HOOK_COMMAND)
  })

  it('steering prompt references the skill and the artifact path', () => {
    expect(steeringSystemPrompt()).toContain('result.html')
    expect(steeringSystemPrompt()).toContain('workphlo-html-report')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- scaffold`
Expected: FAIL — cannot resolve `./scaffold`.

- [ ] **Step 4: Implement `src/main/pty/scaffold.ts`**

```ts
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// The relative path (inside the session cwd) Claude is asked to write.
export const ARTIFACT_FILE = 'result.html'

// Shell command registered as the Claude Code `Stop` hook (and PostToolUse).
// Reads the hook JSON from stdin and POSTs it to our loopback server. Port and
// token arrive via the pty env (set by ptyHost). `|| true` keeps a broken hook
// from ever surfacing a non-zero exit to the agent (fail open).
export const HOOK_COMMAND =
  'curl -s -X POST ' +
  '-H "X-Workphlo-Hook-Token: $WORKPHLO_HOOK_TOKEN" ' +
  '--data-binary @- ' +
  '--connect-timeout 0.5 --max-time 1.5 --noproxy 127.0.0.1 ' +
  'http://127.0.0.1:$WORKPHLO_HOOK_PORT/hook || true'

// Text appended to Claude's system prompt on every CLI-mode launch.
export function steeringSystemPrompt(): string {
  return (
    'When you have a result to present to the user, use the ' +
    '`workphlo-html-report` skill: write (or overwrite) a complete, ' +
    'self-contained, styled HTML document to `result.html` in the current ' +
    'working directory. Keep it updated as your result evolves.'
  )
}

const SKILL_MD = `---
name: workphlo-html-report
description: Use whenever you have a result, answer, summary, or deliverable to present. Write it as a complete styled HTML document to result.html in the working directory.
---

# Workphlo HTML Report

When you have something to show the user, do NOT rely on terminal text alone.
Write a **complete, self-contained HTML document** to \`result.html\` in the
current working directory, overwriting any previous version.

Requirements:
- A single valid HTML fragment: a top-level \`<article class="wf-report">\`.
- Inline \`<style>\` only (no external assets, no network requests, no scripts).
- Structure: an \`<h1>\` title, an optional \`<p class="wf-summary">\` lead, then
  the body as semantic sections.
- Update the same file as your result evolves; it is rendered live beside the
  terminal.
`

// Scaffold the CLI session working dir: the html-report skill + a project-scoped
// settings.json registering the Stop / PostToolUse(Write) hooks. Idempotent.
export async function scaffoldCliSession(cwd: string): Promise<void> {
  const skillDir = join(cwd, '.claude', 'skills', 'workphlo-html-report')
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, 'SKILL.md'), SKILL_MD)

  const settings = {
    hooks: {
      Stop: [{ hooks: [{ type: 'command', command: HOOK_COMMAND, timeout: 10 }] }],
      PostToolUse: [
        { matcher: 'Write', hooks: [{ type: 'command', command: HOOK_COMMAND, timeout: 10 }] }
      ]
    }
  }
  await writeFile(
    join(cwd, '.claude', 'settings.json'),
    JSON.stringify(settings, null, 2)
  )
}
```

- [ ] **Step 5: Wire `mode` into `createSession`**

In `src/main/workspace/workspace.ts`, change the signature and body of `createSession` (lines 53-78). Add the import at the top of the file: `import { scaffoldCliSession } from '../pty/scaffold'`.

```ts
export async function createSession(
  root: string,
  projectId: string,
  name: string,
  templateId: string,
  engine: EngineKind,
  mode: 'document' | 'cli' = 'document'
): Promise<SessionMeta> {
  const id = join(projectId, 'sessions', slugify(name)).replaceAll('\\', '/')
  const dir = abs(root, id)
  await mkdir(join(dir, 'artifacts'), { recursive: true })

  if (mode === 'cli') {
    // CLI mode: no document scaffold; instead seed the cwd steering (skill +
    // hook settings). The cwd IS the session dir.
    await scaffoldCliSession(dir)
    const meta: SessionMeta = { id, name, templateId, engine, status: 'empty', mode }
    await writeFile(join(dir, 'session.json'), JSON.stringify(meta, null, 2))
    await writeFile(join(dir, 'transcript.jsonl'), '')
    return meta
  }

  const template = getTemplate(templateId)
  const doc = template ? scaffoldDocument(template) : { sections: [] }
  const sectionStatus: Record<string, SectionStatus> = {}
  for (const s of doc.sections) sectionStatus[s.id] = 'empty'

  const meta: SessionMeta = { id, name, templateId, engine, status: 'empty', sectionStatus, mode }
  await writeFile(join(dir, 'session.json'), JSON.stringify(meta, null, 2))
  await writeFile(
    join(dir, 'document.md'),
    doc.sections.length ? serializeDocument(doc) : ''
  )
  await writeFile(join(dir, 'transcript.jsonl'), '')
  return meta
}
```

- [ ] **Step 6: Add a workspace test for CLI mode**

Append to `src/main/workspace/workspace.test.ts` (follow the file's existing tmp-root setup helper):

```ts
it('createSession mode=cli scaffolds the skill and skips document.md', async () => {
  const root = await freshRoot() // reuse the file's existing helper
  await createProject(root, 'P')
  const meta = await createSession(root, 'projects/p', 'S', 'spec-design', 'cli', 'cli')
  expect(meta.mode).toBe('cli')
  const skill = await readFile(
    join(root, meta.id, '.claude/skills/workphlo-html-report/SKILL.md'),
    'utf8'
  )
  expect(skill).toContain('result.html')
  // No document sections were scaffolded.
  const doc = await loadDocument(root, meta.id)
  expect(doc.sections).toHaveLength(0)
})
```

(If `freshRoot`/helper names differ in the file, match the existing ones; add the `readFile`/`join` imports if not present.)

- [ ] **Step 7: Run tests**

Run: `npm test -- scaffold workspace` then `npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/shared/types.ts src/main/pty/scaffold.ts src/main/pty/scaffold.test.ts src/main/workspace/workspace.ts src/main/workspace/workspace.test.ts
git commit -m "feat(cli-mode): session mode + CLI-session scaffold (skill + Stop hook settings)"
```

---

### Task 2: PTY host (main)

Spawns and tracks the interactive `claude` process per session. node-pty is added here and externalized from the main bundle.

**Files:**
- Modify: `package.json` (add `node-pty` to `dependencies`)
- Modify: `electron.vite.config.ts` (externalize deps for main + preload)
- Create: `src/main/pty/ptyHost.ts`
- Test: `src/main/pty/ptyHost.test.ts`

**Interfaces:**
- Consumes: `steeringSystemPrompt()` from Task 1.
- Produces:
  - `interface PtyProc { onData(cb: (d: string) => void): void; onExit(cb: (e: { exitCode: number; signal?: number }) => void): void; write(d: string): void; resize(c: number, r: number): void; kill(sig?: string): void }`
  - `type PtySpawn = (file: string, args: string[], opts: { name: string; cols: number; rows: number; cwd: string; env: Record<string, string> }) => PtyProc`
  - `createPtyHost(deps?: { spawn?: PtySpawn }): PtyHost` where `PtyHost` has:
    - `start(o: { sessionId: string; cwd: string; model?: string; cols: number; rows: number; env: Record<string, string>; onData: (d: string) => void; onExit: (e: { code: number; signal?: number }) => void }): void`
    - `write(sessionId: string, data: string): void`
    - `resize(sessionId: string, cols: number, rows: number): void`
    - `kill(sessionId: string): void`
    - `has(sessionId: string): boolean`

- [ ] **Step 1: Add node-pty + externalize config**

- `package.json` → add to `dependencies`: `"node-pty": "^1.0.0"`. (The existing `postinstall: electron-builder install-app-deps` rebuilds native deps against the Electron ABI, so no extra rebuild script is needed for dev. node-pty MUST be a `dependency`, not `devDependency`, for install-app-deps to see it.)
- `electron.vite.config.ts` → externalize deps so native modules are never bundled:

```ts
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    resolve: { alias: { '@renderer': resolve('src/renderer/src') } },
    plugins: [react()]
  }
})
```

Run `npm install` to rebuild native deps.

- [ ] **Step 2: Write the failing ptyHost test**

Create `src/main/pty/ptyHost.test.ts` (fake pty, mirrors the cliEngine fake-spawn pattern):

```ts
import { describe, it, expect, vi } from 'vitest'
import { createPtyHost, type PtyProc, type PtySpawn } from './ptyHost'

function fakeProc() {
  const proc: any = {
    written: [] as string[],
    resized: null as null | [number, number],
    killed: [] as string[],
    _data: null as null | ((d: string) => void),
    _exit: null as null | ((e: { exitCode: number; signal?: number }) => void),
    onData(cb: (d: string) => void) { proc._data = cb },
    onExit(cb: (e: { exitCode: number; signal?: number }) => void) { proc._exit = cb },
    write(d: string) { proc.written.push(d) },
    resize(c: number, r: number) { proc.resized = [c, r] },
    kill(sig?: string) { proc.killed.push(sig ?? 'SIGHUP') }
  }
  return proc as PtyProc & Record<string, any>
}

describe('PtyHost', () => {
  it('spawns claude interactively with model + append-system-prompt and forwards data', () => {
    const proc = fakeProc()
    const spawn = vi.fn(() => proc) as unknown as PtySpawn
    const host = createPtyHost({ spawn })
    const seen: string[] = []
    host.start({
      sessionId: 's1', cwd: '/tmp/s1', model: 'claude-opus-5',
      cols: 80, rows: 24, env: { PATH: '/usr/bin' },
      onData: (d) => seen.push(d), onExit: () => {}
    })
    const [file, args] = (spawn as any).mock.calls[0]
    expect(file).toBe('claude')
    expect(args).toContain('--append-system-prompt')
    expect(args).toContain('--model')
    expect(args).toContain('claude-opus-5')
    expect(args).not.toContain('-p') // interactive, not headless
    proc._data!('hello')
    expect(seen).toEqual(['hello'])
    expect(host.has('s1')).toBe(true)
  })

  it('write / resize forward to the proc; kill sends SIGINT then SIGTERM', () => {
    vi.useFakeTimers()
    const proc = fakeProc()
    const host = createPtyHost({ spawn: (() => proc) as unknown as PtySpawn })
    host.start({ sessionId: 's', cwd: '/tmp', cols: 80, rows: 24, env: {}, onData: () => {}, onExit: () => {} })
    host.write('s', 'ls\r')
    expect(proc.written).toContain('ls\r')
    host.resize('s', 100, 40)
    expect(proc.resized).toEqual([100, 40])
    host.kill('s')
    expect(proc.killed).toContain('SIGINT')
    vi.advanceTimersByTime(5000)
    expect(proc.killed).toContain('SIGTERM')
    vi.useRealTimers()
  })

  it('drops tracking on exit', () => {
    const proc = fakeProc()
    const host = createPtyHost({ spawn: (() => proc) as unknown as PtySpawn })
    host.start({ sessionId: 's', cwd: '/tmp', cols: 80, rows: 24, env: {}, onData: () => {}, onExit: () => {} })
    proc._exit!({ exitCode: 0 })
    expect(host.has('s')).toBe(false)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- ptyHost`
Expected: FAIL — cannot resolve `./ptyHost`.

- [ ] **Step 4: Implement `src/main/pty/ptyHost.ts`**

```ts
import { steeringSystemPrompt } from './scaffold'

export interface PtyProc {
  onData(cb: (d: string) => void): void
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void
  write(d: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
}
export type PtySpawn = (
  file: string,
  args: string[],
  opts: { name: string; cols: number; rows: number; cwd: string; env: Record<string, string> }
) => PtyProc

// Lazily load the native module so unit tests (which always inject `spawn`)
// never require the .node binary.
function realSpawn(): PtySpawn {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pty = require('node-pty') as { spawn: PtySpawn }
  return pty.spawn
}

export interface PtyStartOpts {
  sessionId: string
  cwd: string
  model?: string
  cols: number
  rows: number
  env: Record<string, string>
  onData: (d: string) => void
  onExit: (e: { code: number; signal?: number }) => void
}

export interface PtyHost {
  start(o: PtyStartOpts): void
  write(sessionId: string, data: string): void
  resize(sessionId: string, cols: number, rows: number): void
  kill(sessionId: string): void
  has(sessionId: string): boolean
}

export function createPtyHost(deps: { spawn?: PtySpawn } = {}): PtyHost {
  const spawn = deps.spawn ?? realSpawn()
  const procs = new Map<string, PtyProc>()

  return {
    start(o) {
      if (procs.has(o.sessionId)) return // one pty per session
      const args = ['--append-system-prompt', steeringSystemPrompt()]
      if (o.model) args.push('--model', o.model)
      const proc = spawn('claude', args, {
        name: 'xterm-256color',
        cols: o.cols,
        rows: o.rows,
        cwd: o.cwd,
        env: { ...o.env, TERM: 'xterm-256color' }
      })
      procs.set(o.sessionId, proc)
      proc.onData(o.onData)
      proc.onExit((e) => {
        procs.delete(o.sessionId)
        o.onExit({ code: e.exitCode, signal: e.signal })
      })
    },
    write(sessionId, data) {
      procs.get(sessionId)?.write(data)
    },
    resize(sessionId, cols, rows) {
      procs.get(sessionId)?.resize(cols, rows)
    },
    kill(sessionId) {
      const proc = procs.get(sessionId)
      if (!proc) return
      proc.kill('SIGINT') // graceful (equivalent to user Ctrl-C)
      setTimeout(() => {
        if (procs.has(sessionId)) proc.kill('SIGTERM')
      }, 5000)
    },
    has(sessionId) {
      return procs.has(sessionId)
    }
  }
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test -- ptyHost && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json electron.vite.config.ts src/main/pty/ptyHost.ts src/main/pty/ptyHost.test.ts
git commit -m "feat(cli-mode): pty host spawning interactive claude (node-pty, externalized)"
```

---

### Task 3: Artifact watcher (main)

Detects `result.html` writes and pushes changed content, with Orca's hardening: watch the parent dir, back `fs.watch` with a reconciliation poll, debounce, dedup by mtime+size, handle not-yet-existing.

**Files:**
- Create: `src/main/pty/artifactWatcher.ts`
- Test: `src/main/pty/artifactWatcher.test.ts`

**Interfaces:**
- Consumes: `ARTIFACT_FILE` from Task 1 (`scaffold.ts`).
- Produces: `createArtifactWatcher(o: { cwd: string; onHtml: (html: string) => void; pollMs?: number; debounceMs?: number }): { check(): Promise<void>; stop(): void }`
  - `check()` reads `<cwd>/result.html`; if mtime+size changed since the last push, reads and calls `onHtml`. Missing file is a silent no-op.
  - The watcher auto-runs `check()` on a poll interval and on debounced `fs.watch` events; `check()` is also exported so the hook service (Task 4) can trigger an immediate recheck.

- [ ] **Step 1: Write the failing watcher test**

Create `src/main/pty/artifactWatcher.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createArtifactWatcher } from './artifactWatcher'

describe('artifactWatcher', () => {
  it('check() pushes html once, then dedups until the file changes', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'wf-art-'))
    const seen: string[] = []
    const w = createArtifactWatcher({ cwd, onHtml: (h) => seen.push(h), pollMs: 0 })
    await w.check() // no file yet → no push
    expect(seen).toHaveLength(0)

    await writeFile(join(cwd, 'result.html'), '<article>one</article>')
    await w.check()
    await w.check() // unchanged → deduped
    expect(seen).toEqual(['<article>one</article>'])

    // A new write with different size is detected.
    await new Promise((r) => setTimeout(r, 10))
    await writeFile(join(cwd, 'result.html'), '<article>two-longer</article>')
    await w.check()
    expect(seen).toEqual(['<article>one</article>', '<article>two-longer</article>'])
    w.stop()
  })

  it('stop() halts the poll loop', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'wf-art-'))
    const onHtml = vi.fn()
    const w = createArtifactWatcher({ cwd, onHtml, pollMs: 5 })
    w.stop()
    await new Promise((r) => setTimeout(r, 20))
    expect(onHtml).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- artifactWatcher`
Expected: FAIL — cannot resolve `./artifactWatcher`.

- [ ] **Step 3: Implement `src/main/pty/artifactWatcher.ts`**

```ts
import { watch, type FSWatcher } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { ARTIFACT_FILE } from './scaffold'

export function createArtifactWatcher(o: {
  cwd: string
  onHtml: (html: string) => void
  pollMs?: number
  debounceMs?: number
}): { check(): Promise<void>; stop(): void } {
  const file = join(o.cwd, ARTIFACT_FILE)
  const pollMs = o.pollMs ?? 1000
  const debounceMs = o.debounceMs ?? 40
  let last = '' // `${mtimeMs}:${size}` of the last pushed version
  let stopped = false
  let debounce: NodeJS.Timeout | null = null
  let poll: NodeJS.Timeout | null = null
  let fsw: FSWatcher | null = null

  const check = async (): Promise<void> => {
    if (stopped) return
    let st: import('node:fs').Stats
    try {
      st = await stat(file)
    } catch {
      return // not written yet — silent no-op
    }
    const sig = `${st.mtimeMs}:${st.size}`
    if (sig === last) return
    let html: string
    try {
      html = await readFile(file, 'utf8')
    } catch {
      return // transient mid-write read failure; a later poll retries
    }
    last = sig
    o.onHtml(html)
  }

  // fs.watch on the PARENT dir survives atomic-replace writes (macOS); it is
  // best-effort acceleration only — the poll below is the liveness guarantee.
  try {
    fsw = watch(o.cwd, (_e, name) => {
      if (name && name !== ARTIFACT_FILE) return
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => void check(), debounceMs)
    })
  } catch {
    fsw = null
  }
  if (pollMs > 0) poll = setInterval(() => void check(), pollMs)

  return {
    check,
    stop() {
      stopped = true
      if (debounce) clearTimeout(debounce)
      if (poll) clearInterval(poll)
      fsw?.close()
    }
  }
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test -- artifactWatcher && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/pty/artifactWatcher.ts src/main/pty/artifactWatcher.test.ts
git commit -m "feat(cli-mode): hardened result.html watcher (parent-dir watch + poll + dedup)"
```

---

### Task 4: Hook service (main)

A loopback HTTP server that receives Claude Code `Stop`/`PostToolUse` hook POSTs, authenticated per-session, always `204`, fails open. On a hit it triggers the artifact watcher's `check()`.

**Files:**
- Create: `src/main/pty/hookService.ts`
- Test: `src/main/pty/hookService.test.ts`

**Interfaces:**
- Produces: `async createHookService(o: { onHook: (sessionId: string) => void }): Promise<HookService>` where `HookService` has:
  - `port: number` — the bound ephemeral port.
  - `register(sessionId: string): string` — returns a fresh per-session token; associates it so a POST bearing it maps to `sessionId`.
  - `unregister(sessionId: string): void`
  - `close(): Promise<void>`
- The server accepts `POST /hook` with header `X-Workphlo-Hook-Token`; it looks up the session for that token and calls `onHook(sessionId)`. Unknown/missing token ⇒ still `204` (fail open), no callback.

- [ ] **Step 1: Write the failing hook-service test**

Create `src/main/pty/hookService.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { createHookService, type HookService } from './hookService'

let svc: HookService | null = null
afterEach(async () => { await svc?.close(); svc = null })

async function post(port: number, token?: string): Promise<number> {
  const res = await fetch(`http://127.0.0.1:${port}/hook`, {
    method: 'POST',
    headers: token ? { 'X-Workphlo-Hook-Token': token } : {},
    body: '{"hook_event_name":"Stop"}'
  })
  return res.status
}

describe('hookService', () => {
  it('maps a valid token to its session and always returns 204', async () => {
    const hits: string[] = []
    svc = await createHookService({ onHook: (id) => hits.push(id) })
    const token = svc.register('sess-A')
    expect(await post(svc.port, token)).toBe(204)
    expect(hits).toEqual(['sess-A'])
  })

  it('fails open: unknown token still 204, no callback', async () => {
    const hits: string[] = []
    svc = await createHookService({ onHook: (id) => hits.push(id) })
    expect(await post(svc.port, 'bogus')).toBe(204)
    expect(await post(svc.port)).toBe(204)
    expect(hits).toEqual([])
  })

  it('unregister stops routing that token', async () => {
    const hits: string[] = []
    svc = await createHookService({ onHook: (id) => hits.push(id) })
    const token = svc.register('sess-B')
    svc.unregister('sess-B')
    expect(await post(svc.port, token)).toBe(204)
    expect(hits).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- hookService`
Expected: FAIL — cannot resolve `./hookService`.

- [ ] **Step 3: Implement `src/main/pty/hookService.ts`**

```ts
import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'

export interface HookService {
  port: number
  register(sessionId: string): string
  unregister(sessionId: string): void
  close(): Promise<void>
}

export async function createHookService(o: {
  onHook: (sessionId: string) => void
}): Promise<HookService> {
  const tokenToSession = new Map<string, string>()
  const sessionToToken = new Map<string, string>()

  const server: Server = createServer((req, res) => {
    // Always drain + 204, no matter what. A hook must never block the agent.
    req.resume()
    req.on('end', () => {
      const token = req.headers['x-workphlo-hook-token']
      const sessionId = typeof token === 'string' ? tokenToSession.get(token) : undefined
      if (req.method === 'POST' && sessionId) {
        try {
          o.onHook(sessionId)
        } catch {
          /* fail open */
        }
      }
      res.statusCode = 204
      res.end()
    })
    req.on('error', () => {
      res.statusCode = 204
      res.end()
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0

  return {
    port,
    register(sessionId) {
      const token = randomUUID()
      tokenToSession.set(token, sessionId)
      sessionToToken.set(sessionId, token)
      return token
    },
    unregister(sessionId) {
      const token = sessionToToken.get(sessionId)
      if (token) tokenToSession.delete(token)
      sessionToToken.delete(sessionId)
    },
    close() {
      return new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test -- hookService && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/pty/hookService.ts src/main/pty/hookService.test.ts
git commit -m "feat(cli-mode): loopback Stop-hook service (per-session token, fails open)"
```

---

### Task 5: IPC + preload wiring (main + preload)

Ties Tasks 1–4 together: a session controller that starts the pty + watcher + hook registration, IPC handlers, event pushes, `mode`-aware `wf:createSession`, `mode` in `wf:getDocument`, and the preload bridge additions.

**Files:**
- Create: `src/main/pty/cliSession.ts` (per-session controller)
- Modify: `src/main/ipc.ts` (new handlers + createSession mode + getDocument mode)
- Modify: `src/main/index.ts:64-66` (create the hook service once, pass to `registerIpc`)
- Modify: `src/preload/index.ts` (bridge methods + subscriptions)
- Test: `src/main/pty/cliSession.test.ts`

**Interfaces:**
- Consumes: `createPtyHost` (Task 2), `createArtifactWatcher` (Task 3), `createHookService` (Task 4), `abs` (`workspace/paths.ts`).
- Produces:
  - `createCliSessions(o: { root: string; hooks: HookService; ptyHost?: PtyHost; makeWatcher?: typeof createArtifactWatcher; send: (channel: string, payload: unknown) => void }): CliSessions` with:
    - `start(sessionId, cols, rows, model?): void` — registers hook token, spawns pty (env carries `WORKPHLO_HOOK_PORT`/`WORKPHLO_HOOK_TOKEN`), starts watcher; forwards pty data on `wf:pty:data`, exit on `wf:pty:exit`, artifact html on `wf:artifactUpdate`.
    - `input(sessionId, data)`, `resize(sessionId, cols, rows)`, `kill(sessionId)`.
  - Preload additions on `window.workphlo`:
    - `createSession(projectId, name, mode?)` — extended with optional `mode`.
    - `ptyStart(sessionId, cols, rows)`, `ptyInput(sessionId, data)`, `ptyResize(sessionId, cols, rows)`, `ptyKill(sessionId)` → `Promise<void>`.
    - `onPtyData(cb: (p: { sessionId: string; data: string }) => void): () => void`
    - `onPtyExit(cb: (p: { sessionId: string; code: number; signal?: number }) => void): () => void`
    - `onArtifactUpdate(cb: (p: { sessionId: string; html: string }) => void): () => void`
  - `wf:getDocument` return type gains `mode: 'document' | 'cli'`.

- [ ] **Step 1: Write the failing cliSession test**

Create `src/main/pty/cliSession.test.ts` (inject fakes for pty + watcher + a stub hook service):

```ts
import { describe, it, expect, vi } from 'vitest'
import { createCliSessions } from './cliSession'
import type { PtyHost } from './ptyHost'
import type { HookService } from './hookService'

function fakePtyHost() {
  let onData: (d: string) => void = () => {}
  let onExit: (e: { code: number; signal?: number }) => void = () => {}
  const calls: any = { started: null, writes: [] as string[], killed: [] as string[] }
  const host: PtyHost = {
    start(o) { calls.started = o; onData = o.onData; onExit = o.onExit },
    write(_id, d) { calls.writes.push(d) },
    resize() {},
    kill(id) { calls.killed.push(id) },
    has: () => true
  }
  return { host, calls, emitData: (d: string) => onData(d), emitExit: () => onExit({ code: 0 }) }
}

function fakeHooks(): HookService {
  return { port: 4321, register: () => 'tok-1', unregister: () => {}, close: async () => {} }
}

describe('createCliSessions', () => {
  it('start injects hook env + model and forwards pty data to wf:pty:data', () => {
    const pty = fakePtyHost()
    const sent: Array<[string, any]> = []
    const sessions = createCliSessions({
      root: '/root',
      hooks: fakeHooks(),
      ptyHost: pty.host,
      makeWatcher: (() => ({ check: async () => {}, stop: () => {} })) as any,
      send: (c, p) => sent.push([c, p])
    })
    sessions.start('projects/p/sessions/s', 80, 24, 'claude-opus-5')
    expect(pty.calls.started.model).toBe('claude-opus-5')
    expect(pty.calls.started.env.WORKPHLO_HOOK_PORT).toBe('4321')
    expect(pty.calls.started.env.WORKPHLO_HOOK_TOKEN).toBe('tok-1')

    pty.emitData('output')
    expect(sent).toContainEqual([
      'wf:pty:data',
      { sessionId: 'projects/p/sessions/s', data: 'output' }
    ])
  })

  it('watcher html pushes wf:artifactUpdate; pty exit pushes wf:pty:exit', () => {
    const pty = fakePtyHost()
    const sent: Array<[string, any]> = []
    let capturedOnHtml: ((h: string) => void) | null = null
    createCliSessions({
      root: '/root',
      hooks: fakeHooks(),
      ptyHost: pty.host,
      makeWatcher: ((o: any) => { capturedOnHtml = o.onHtml; return { check: async () => {}, stop: () => {} } }) as any,
      send: (c, p) => sent.push([c, p])
    }).start('s', 80, 24)
    capturedOnHtml!('<article>hi</article>')
    expect(sent).toContainEqual(['wf:artifactUpdate', { sessionId: 's', html: '<article>hi</article>' }])
    pty.emitExit()
    expect(sent).toContainEqual(['wf:pty:exit', { sessionId: 's', code: 0, signal: undefined }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- cliSession`
Expected: FAIL — cannot resolve `./cliSession`.

- [ ] **Step 3: Implement `src/main/pty/cliSession.ts`**

```ts
import { createPtyHost, type PtyHost } from './ptyHost'
import { createArtifactWatcher } from './artifactWatcher'
import type { HookService } from './hookService'
import { abs } from '../workspace/paths'

export interface CliSessions {
  start(sessionId: string, cols: number, rows: number, model?: string): void
  input(sessionId: string, data: string): void
  resize(sessionId: string, cols: number, rows: number): void
  kill(sessionId: string): void
}

export function createCliSessions(o: {
  root: string
  hooks: HookService
  send: (channel: string, payload: unknown) => void
  ptyHost?: PtyHost
  makeWatcher?: typeof createArtifactWatcher
}): CliSessions {
  const ptyHost = o.ptyHost ?? createPtyHost()
  const makeWatcher = o.makeWatcher ?? createArtifactWatcher
  const watchers = new Map<string, ReturnType<typeof createArtifactWatcher>>()

  const stopWatcher = (sessionId: string): void => {
    watchers.get(sessionId)?.stop()
    watchers.delete(sessionId)
  }

  return {
    start(sessionId, cols, rows, model) {
      const cwd = abs(o.root, sessionId)
      const token = o.hooks.register(sessionId)
      const watcher = makeWatcher({
        cwd,
        onHtml: (html) => o.send('wf:artifactUpdate', { sessionId, html })
      })
      watchers.set(sessionId, watcher)
      // A Stop/PostToolUse hook triggers an immediate recheck (primary signal).
      // (index.ts wires hooks.onHook → this recheck; see Step 5.)
      ptyHost.start({
        sessionId,
        cwd,
        model,
        cols,
        rows,
        env: {
          ...(process.env as Record<string, string>),
          WORKPHLO_HOOK_PORT: String(o.hooks.port),
          WORKPHLO_HOOK_TOKEN: token
        },
        onData: (data) => o.send('wf:pty:data', { sessionId, data }),
        onExit: ({ code, signal }) => {
          stopWatcher(sessionId)
          o.hooks.unregister(sessionId)
          o.send('wf:pty:exit', { sessionId, code, signal })
        }
      })
    },
    input(sessionId, data) {
      ptyHost.write(sessionId, data)
    },
    resize(sessionId, cols, rows) {
      ptyHost.resize(sessionId, cols, rows)
    },
    kill(sessionId) {
      ptyHost.kill(sessionId)
    },
    // Exposed for the hook → recheck wiring in index.ts.
    // (Attach as a property so index.ts can reach the right watcher.)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...( { recheck: (sessionId: string) => void watchers.get(sessionId)?.check() } as any )
  }
}
```

- [ ] **Step 4: Add IPC handlers + mode plumbing in `src/main/ipc.ts`**

Change `registerIpc` to accept the `CliSessions` controller, and modify/add handlers. Update the signature to `export function registerIpc(root: string, getWindow: () => BrowserWindow | null, cli: CliSessions): void` and add `import type { CliSessions } from './pty/cliSession'`.

Replace the `wf:createSession` handler (lines 158-161) with a mode-aware version:

```ts
  ipcMain.handle(
    'wf:createSession',
    async (_e, projectId: string, name: string, mode: 'document' | 'cli' = 'document') => {
      await createSession(root, projectId, name, 'spec-design', 'cli', mode)
      return loadTree(root)
    }
  )
```

Extend `wf:getDocument` (lines 141-151) to include `mode`:

```ts
      const doc = await loadDocument(root, sessionId)
      const meta = await loadSessionMeta(root, sessionId)
      return { doc, sectionStatus: meta?.sectionStatus ?? {}, mode: meta?.mode ?? 'document' }
```

(Update its return type annotation to add `mode: 'document' | 'cli'`.)

Add the pty handlers near the end of `registerIpc` (before the closing brace):

```ts
  ipcMain.handle('wf:pty:start', (_e, sessionId: string, cols: number, rows: number) => {
    cli.start(sessionId, cols, rows)
  })
  ipcMain.on('wf:pty:input', (_e, sessionId: string, data: string) => cli.input(sessionId, data))
  ipcMain.on('wf:pty:resize', (_e, sessionId: string, cols: number, rows: number) =>
    cli.resize(sessionId, cols, rows)
  )
  ipcMain.handle('wf:pty:kill', (_e, sessionId: string) => cli.kill(sessionId))
```

(Input/resize use `ipcMain.on` fire-and-forget — high-frequency, no ack needed, mirroring Orca's resize choice.)

- [ ] **Step 5: Wire the hook service in `src/main/index.ts`**

Replace lines 64-66 with:

```ts
    const root = join(app.getPath('userData'), 'workspace')
    await createWorkspace(root)
    const send = (channel: string, payload: unknown): void =>
      mainWindow?.webContents.send(channel, payload)
    // The hook service must exist before cli sessions so start() can register tokens.
    const hooks = await createHookService({
      onHook: (sessionId) => cliRef?.recheck(sessionId)
    })
    const cli = createCliSessions({ root, hooks, send })
    // Give the hook callback a handle to the controller (created after hooks).
    cliRef = cli as typeof cli & { recheck: (id: string) => void }
    registerIpc(root, () => mainWindow, cli)
```

Add near the top of `index.ts`:

```ts
import { createHookService } from './pty/hookService'
import { createCliSessions } from './pty/cliSession'

// Late-bound so the hook onHook closure can reach the controller created after it.
let cliRef: (ReturnType<typeof createCliSessions> & { recheck: (id: string) => void }) | null = null
```

- [ ] **Step 6: Add preload bridge methods in `src/preload/index.ts`**

Extend the `createSession` method and add the pty/artifact methods to the `workphlo` object:

```ts
  createSession: (projectId: string, name: string, mode: 'document' | 'cli' = 'document') =>
    ipcRenderer.invoke('wf:createSession', projectId, name, mode) as Promise<TreeNode[]>,
  ptyStart: (sessionId: string, cols: number, rows: number) =>
    ipcRenderer.invoke('wf:pty:start', sessionId, cols, rows) as Promise<void>,
  ptyInput: (sessionId: string, data: string) => ipcRenderer.send('wf:pty:input', sessionId, data),
  ptyResize: (sessionId: string, cols: number, rows: number) =>
    ipcRenderer.send('wf:pty:resize', sessionId, cols, rows),
  ptyKill: (sessionId: string) => ipcRenderer.invoke('wf:pty:kill', sessionId) as Promise<void>,
  onPtyData: (cb: (p: { sessionId: string; data: string }) => void) => {
    const l = (_e: unknown, p: { sessionId: string; data: string }): void => cb(p)
    ipcRenderer.on('wf:pty:data', l)
    return () => ipcRenderer.removeListener('wf:pty:data', l)
  },
  onPtyExit: (cb: (p: { sessionId: string; code: number; signal?: number }) => void) => {
    const l = (_e: unknown, p: { sessionId: string; code: number; signal?: number }): void => cb(p)
    ipcRenderer.on('wf:pty:exit', l)
    return () => ipcRenderer.removeListener('wf:pty:exit', l)
  },
  onArtifactUpdate: (cb: (p: { sessionId: string; html: string }) => void) => {
    const l = (_e: unknown, p: { sessionId: string; html: string }): void => cb(p)
    ipcRenderer.on('wf:artifactUpdate', l)
    return () => ipcRenderer.removeListener('wf:artifactUpdate', l)
  },
```

Also update the `getDocument` return type in preload to include `mode: 'document' | 'cli'`.

- [ ] **Step 7: Run tests + typecheck**

Run: `npm test -- cliSession && npm run typecheck`
Expected: PASS. (The `WorkphloApi` type widens automatically; renderer tasks consume it.)

- [ ] **Step 8: Commit**

```bash
git add src/main/pty/cliSession.ts src/main/pty/cliSession.test.ts src/main/ipc.ts src/main/index.ts src/preload/index.ts
git commit -m "feat(cli-mode): cli-session controller + IPC/preload wiring (pty, artifact, hooks, mode)"
```

---

### Task 6: Renderer store — CLI session state

Adds `mode` + `artifactHtml` + `ptyExit` to the store and the IPC subscriptions, guarded by `activeSessionId` like the existing section/thread routing.

**Files:**
- Modify: `src/renderer/src/store.ts`
- Test: `src/renderer/src/store.test.ts` (extend)

**Interfaces:**
- Consumes: `window.workphlo.onArtifactUpdate`, `onPtyExit`, extended `getDocument` (`mode`).
- Produces store additions: `mode: 'document' | 'cli'`, `artifactHtml: string`, `ptyExit: { code: number; signal?: number } | null`, and reducers `applyArtifactUpdate(p)`, `applyPtyExit(p)`. `loadDoc` also stores `mode`; `select` resets `artifactHtml`/`ptyExit`.

- [ ] **Step 1: Write the failing store test**

Extend `src/renderer/src/store.test.ts` (follow the file's existing `useStore.setState` / reset pattern):

```ts
it('applyArtifactUpdate stores html only for the active session', () => {
  useStore.setState({ activeSessionId: 's1', artifactHtml: '' })
  useStore.getState().applyArtifactUpdate({ sessionId: 's2', html: '<b>other</b>' })
  expect(useStore.getState().artifactHtml).toBe('') // ignored: not active
  useStore.getState().applyArtifactUpdate({ sessionId: 's1', html: '<b>mine</b>' })
  expect(useStore.getState().artifactHtml).toBe('<b>mine</b>')
})

it('applyPtyExit records exit for the active session', () => {
  useStore.setState({ activeSessionId: 's1', ptyExit: null })
  useStore.getState().applyPtyExit({ sessionId: 's1', code: 1, signal: undefined })
  expect(useStore.getState().ptyExit).toEqual({ code: 1, signal: undefined })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- store`
Expected: FAIL — `applyArtifactUpdate` is not a function.

- [ ] **Step 3: Implement store additions**

In `src/renderer/src/store.ts`, add to the `State` interface:

```ts
  mode: 'document' | 'cli'
  artifactHtml: string
  ptyExit: { code: number; signal?: number } | null
  applyArtifactUpdate: (p: { sessionId: string; html: string }) => void
  applyPtyExit: (p: { sessionId: string; code: number; signal?: number }) => void
```

Add to the initial state object: `mode: 'document', artifactHtml: '', ptyExit: null,`.

In `select`, reset the CLI fields: change the `set(...)` call to also include `artifactHtml: '', ptyExit: null, mode: 'document'`.

In `loadDoc`, capture `mode` from the response — change the destructure to `const { doc, sectionStatus, mode } = await window.workphlo.getDocument(id)` and include `mode` in the `set(...)` payload (both branches).

Add the reducers to the store object:

```ts
  applyArtifactUpdate: ({ sessionId, html }) =>
    set((s) => (sessionId === s.activeSessionId ? { artifactHtml: html } : s)),
  applyPtyExit: ({ sessionId, code, signal }) =>
    set((s) => (sessionId === s.activeSessionId ? { ptyExit: { code, signal } } : s)),
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test -- store && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/store.ts src/renderer/src/store.test.ts
git commit -m "feat(cli-mode): store slice for artifact html + pty exit + session mode"
```

---

### Task 7: TerminalPane (renderer, xterm)

Mounts xterm, starts the pty, and pipes I/O + resize. xterm deps are added here.

**Files:**
- Modify: `package.json` (add `@xterm/xterm`, `@xterm/addon-fit` to `dependencies`)
- Create: `src/renderer/src/components/TerminalPane.tsx`
- Test: `src/renderer/src/components/TerminalPane.test.tsx`

**Interfaces:**
- Consumes: `window.workphlo.ptyStart/ptyInput/ptyResize/onPtyData/onPtyExit`, store `ptyExit`.
- Produces: `<TerminalPane sessionId={string} model={string | undefined} />`.

- [ ] **Step 1: Add xterm deps**

`package.json` → `dependencies`: `"@xterm/xterm": "^5.5.0"`, `"@xterm/addon-fit": "^0.10.0"`. Run `npm install`.

- [ ] **Step 2: Write the failing TerminalPane test**

Create `src/renderer/src/components/TerminalPane.test.tsx`. Mock `@xterm/xterm` so jsdom (no canvas/WebGL) can mount it, and assert `ptyStart` is called and inbound data is written.

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

const writes: string[] = []
const onDataCbs: Array<(d: string) => void> = []
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    write(d: string) { writes.push(d) }
    onData(cb: (d: string) => void) { onDataCbs.push(cb) }
    onResize() {}
    open() {}
    loadAddon() {}
    dispose() {}
  }
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} activate() {} dispose() {} } }))

const ptyStart = vi.fn(async () => {})
let dataListener: ((p: { sessionId: string; data: string }) => void) | null = null
beforeEach(() => {
  writes.length = 0
  onDataCbs.length = 0
  ;(globalThis as any).window.workphlo = {
    ptyStart,
    ptyInput: vi.fn(),
    ptyResize: vi.fn(),
    onPtyData: (cb: any) => { dataListener = cb; return () => {} },
    onPtyExit: () => () => {}
  }
})

import { TerminalPane } from './TerminalPane'

describe('TerminalPane', () => {
  it('starts the pty on mount and writes inbound data to the terminal', () => {
    render(<TerminalPane sessionId="s1" model={undefined} />)
    expect(ptyStart).toHaveBeenCalledWith('s1', 80, 24)
    dataListener!({ sessionId: 's1', data: 'hi' })
    expect(writes).toContain('hi')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- TerminalPane`
Expected: FAIL — cannot resolve `./TerminalPane`.

- [ ] **Step 4: Implement `src/renderer/src/components/TerminalPane.tsx`**

```tsx
import { useEffect, useRef, type JSX } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useStore } from '../store'

export function TerminalPane({
  sessionId
}: {
  sessionId: string
  model?: string
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const ptyExit = useStore((s) => s.ptyExit)

  useEffect(() => {
    const term = new Terminal({ convertEol: true, fontSize: 13 })
    const fit = new FitAddon()
    term.loadAddon(fit)
    if (hostRef.current) term.open(hostRef.current)
    try {
      fit.fit()
    } catch {
      /* jsdom / zero-size: keep default cols/rows */
    }

    void window.workphlo.ptyStart(sessionId, term.cols, term.rows)
    const offData = window.workphlo.onPtyData((p) => {
      if (p.sessionId === sessionId) term.write(p.data)
    })
    term.onData((d) => window.workphlo.ptyInput(sessionId, d))
    term.onResize(({ cols, rows }) => window.workphlo.ptyResize(sessionId, cols, rows))

    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        /* ignore */
      }
    })
    if (hostRef.current) ro.observe(hostRef.current)

    return () => {
      offData()
      ro.disconnect()
      term.dispose()
    }
  }, [sessionId])

  return (
    <div className="flex h-full flex-col bg-black">
      {ptyExit && (
        <div className="bg-amber-100 px-3 py-1 text-xs text-amber-900">
          Session ended (code {ptyExit.code}
          {ptyExit.signal ? `, signal ${ptyExit.signal}` : ''}).
        </div>
      )}
      <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden p-1" />
    </div>
  )
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test -- TerminalPane && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/renderer/src/components/TerminalPane.tsx src/renderer/src/components/TerminalPane.test.tsx
git commit -m "feat(cli-mode): TerminalPane (xterm) wired to pty I/O + resize"
```

---

### Task 8: ArtifactPane (renderer)

Renders the live `artifactHtml` through the existing sandboxed `HtmlBody`.

**Files:**
- Modify: `src/renderer/src/sections/renderers.tsx` (export `HtmlBody`)
- Create: `src/renderer/src/components/ArtifactPane.tsx`
- Test: `src/renderer/src/components/ArtifactPane.test.tsx`

**Interfaces:**
- Consumes: store `artifactHtml`; `HtmlBody` (now exported).
- Produces: `<ArtifactPane />`.

- [ ] **Step 1: Export `HtmlBody`**

In `src/renderer/src/sections/renderers.tsx`, change `function HtmlBody(` (line 65) to `export function HtmlBody(`.

- [ ] **Step 2: Write the failing ArtifactPane test**

Create `src/renderer/src/components/ArtifactPane.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useStore } from '../store'
import { ArtifactPane } from './ArtifactPane'

beforeEach(() => useStore.setState({ artifactHtml: '' }))

describe('ArtifactPane', () => {
  it('shows an empty state before the first artifact write', () => {
    render(<ArtifactPane />)
    expect(screen.getByText(/no result yet/i)).toBeInTheDocument()
  })

  it('renders the sandboxed iframe once html arrives', () => {
    useStore.setState({ artifactHtml: '<article>done</article>' })
    render(<ArtifactPane />)
    expect(screen.getByTitle('section-html')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- ArtifactPane`
Expected: FAIL — cannot resolve `./ArtifactPane`.

- [ ] **Step 4: Implement `src/renderer/src/components/ArtifactPane.tsx`**

```tsx
import { type JSX } from 'react'
import { HtmlBody } from '../sections/renderers'
import { useStore } from '../store'

export function ArtifactPane(): JSX.Element {
  const html = useStore((s) => s.artifactHtml)
  return (
    <div className="flex h-full flex-col overflow-auto bg-white">
      <div className="border-b bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
        Result
      </div>
      {html ? (
        // Reuse the locked-down sandbox. A synthetic id is fine: the ask-menu
        // reporter's postMessages are simply ignored by this pane.
        <HtmlBody body={html} sectionId="__artifact__" />
      ) : (
        <div className="p-6 text-sm text-slate-400">
          No result yet — the agent will write <code>result.html</code> here as it works.
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test -- ArtifactPane && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/sections/renderers.tsx src/renderer/src/components/ArtifactPane.tsx src/renderer/src/components/ArtifactPane.test.tsx
git commit -m "feat(cli-mode): ArtifactPane rendering live result.html in the existing sandbox"
```

---

### Task 9: CliSessionView + App routing + new-CLI-session action

Splits terminal + artifact, routes by `mode`, and adds a "New CLI session" entry point.

**Files:**
- Create: `src/renderer/src/components/CliSessionView.tsx`
- Modify: `src/renderer/src/App.tsx` (route by `mode`; subscribe to artifact/exit)
- Modify: `src/renderer/src/components/TreePane.tsx` (add "New CLI session" — match the file's existing create-session UI)
- Test: `src/renderer/src/components/CliSessionView.test.tsx`

**Interfaces:**
- Consumes: `TerminalPane`, `ArtifactPane`, store `mode`/`activeSessionId`.
- Produces: `<CliSessionView sessionId={string} />`.

- [ ] **Step 1: Write the failing CliSessionView test**

Create `src/renderer/src/components/CliSessionView.test.tsx` (mock the two child panes so xterm isn't exercised again):

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
vi.mock('./TerminalPane', () => ({ TerminalPane: () => <div>TERM</div> }))
vi.mock('./ArtifactPane', () => ({ ArtifactPane: () => <div>ART</div> }))
import { CliSessionView } from './CliSessionView'

describe('CliSessionView', () => {
  it('renders both the terminal and artifact panes', () => {
    render(<CliSessionView sessionId="s1" />)
    expect(screen.getByText('TERM')).toBeInTheDocument()
    expect(screen.getByText('ART')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- CliSessionView`
Expected: FAIL — cannot resolve `./CliSessionView`.

- [ ] **Step 3: Implement `src/renderer/src/components/CliSessionView.tsx`**

```tsx
import { type JSX } from 'react'
import { TerminalPane } from './TerminalPane'
import { ArtifactPane } from './ArtifactPane'

export function CliSessionView({ sessionId }: { sessionId: string }): JSX.Element {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-2">
      <div className="min-h-0 border-r">
        <TerminalPane sessionId={sessionId} />
      </div>
      <div className="min-h-0">
        <ArtifactPane />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Route by mode in `App.tsx`**

Add the artifact/exit subscriptions and route the main region. Import `CliSessionView` and select store fields:

```tsx
const mode = useStore((s) => s.mode)
const activeSessionId = useStore((s) => s.activeSessionId)
const applyArtifactUpdate = useStore((s) => s.applyArtifactUpdate)
const applyPtyExit = useStore((s) => s.applyPtyExit)
```

In the existing `useEffect`, add (and clean up) two more subscriptions:

```tsx
const offArtifact = window.workphlo.onArtifactUpdate(applyArtifactUpdate)
const offPtyExit = window.workphlo.onPtyExit(applyPtyExit)
```

(Add `offArtifact()` / `offPtyExit()` to the returned cleanup, and add the two callbacks to the dep array.)

Replace the `<main>` body so CLI sessions get the split view:

```tsx
      <main className="flex flex-1 flex-col">
        {mode === 'cli' && activeSessionId ? (
          <CliSessionView sessionId={activeSessionId} />
        ) : (
          <>
            <SectionCanvas />
            <div className="flex flex-col border-t">
              {/* ...existing Transcript toggle... */}
            </div>
            <PromptBar />
          </>
        )}
      </main>
```

- [ ] **Step 5: Add "New CLI session" in `TreePane.tsx`**

Locate the existing new-session control (the one calling `window.workphlo.createSession(projectId, name)` / the store's create path). Add a sibling action that passes `'cli'` as the mode, e.g. a second button "New CLI session" whose handler calls `window.workphlo.createSession(projectId, name, 'cli')` then refreshes the tree via the existing `loadTree`. Match the file's existing prompt/naming affordance for the session name; do not invent a new modal system.

- [ ] **Step 6: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS (full suite — confirms document-mode tests still green).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/CliSessionView.tsx src/renderer/src/components/CliSessionView.test.tsx src/renderer/src/App.tsx src/renderer/src/components/TreePane.tsx
git commit -m "feat(cli-mode): split CliSessionView + mode routing + new-CLI-session action"
```

---

### Task 10: E2E smoke + README

End-to-end confirmation that a CLI session mounts the split view, plus documenting the native-module build.

**Files:**
- Create: `e2e/app.cli-mode.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: the full built app (`npm run build` then Playwright, per `test:e2e`).

- [ ] **Step 1: Write the E2E smoke spec**

Create `e2e/app.cli-mode.spec.ts`, following the existing `e2e/app.boot.spec.ts` / `fixtures.ts` harness (reuse its Electron launch fixture). The spec:
1. launches the app,
2. creates a project, then a **CLI** session via the new TreePane action,
3. asserts the terminal container (`.xterm` or the ArtifactPane "Result" header + "No result yet" empty state) is visible.

```ts
import { test, expect } from './fixtures'

test('creating a CLI session mounts the terminal + artifact split', async ({ window }) => {
  // Reuse fixtures.ts helpers to create a project + CLI session
  // (mirror app.p2.spec.ts's creation flow, passing the CLI action).
  await expect(window.getByText(/no result yet/i)).toBeVisible()
  await expect(window.locator('.xterm')).toBeVisible({ timeout: 10_000 })
})
```

(Adapt selectors/helpers to `fixtures.ts`. If driving a real `claude` isn't available in CI, this spec only asserts the panes mount — it never sends a prompt.)

- [ ] **Step 2: Run the E2E suite**

Run: `npm run test:e2e:only -- app.cli-mode` (after a `npm run build`)
Expected: PASS — panes mount. If `.xterm` never appears, verify node-pty rebuilt (`npm install` ran install-app-deps) and `externalizeDepsPlugin` is set.

- [ ] **Step 3: Document the build in README**

Add a "CLI Mode (experimental)" section to `README.md` covering: what it is; that `node-pty` is a native module rebuilt against the Electron ABI by the existing `postinstall` (`electron-builder install-app-deps`); the packaging caveats for later (`.node` must be asar-unpacked; on macOS the node-pty `spawn-helper` needs its exec bit `chmod +x`'d at runtime inside asar); and that steering lives in the scaffolded `.claude/skills/workphlo-html-report/` + `--append-system-prompt`.

- [ ] **Step 4: Commit**

```bash
git add e2e/app.cli-mode.spec.ts README.md
git commit -m "test(cli-mode): e2e smoke for CLI session view + README native-build notes"
```

---

## Self-Review

**Spec coverage:**
- Decision "embed real CLI (pty+xterm)" → Tasks 2 (pty host), 7 (xterm TerminalPane). ✓
- Decision "new additive mode" → Task 1 (`mode` field, default document), Task 9 (routing leaves document flow intact; full suite re-run in 9.6). ✓
- Decision "split view + live HTML pane reusing HtmlBody" → Tasks 8 (ArtifactPane via exported HtmlBody), 9 (CliSessionView split). ✓
- Decision "injected skill + system-prompt append" → Task 1 (`scaffoldCliSession`, `steeringSystemPrompt`), Task 2 (append passed to spawn). ✓
- Spec §4a Stop hook (loopback, token, 204, fail-open, mtime gate) → Task 4 + Task 5 (recheck wiring); mtime gate lives in the watcher dedup (Task 3). ✓
- Spec §4b hardened watcher (parent-dir, poll-backs-fs.watch, debounce, dedup, not-yet-exists) → Task 3. ✓
- Spec §5 IPC/preload channels table → Task 5 (all channels present: start/input/resize/kill, data/exit, artifactUpdate). ✓
- Spec §7 native build (externalize, rebuild, darwin asar/spawn-helper) → Task 2 (externalize + dep) + Task 10 (README caveats). ✓
- Error handling: spawn failure / exit banner → Task 7 (`ptyExit` banner); malformed html → existing sandbox isolation (Task 8 reuse); dead-pty input → `ptyHost.write` no-ops on missing proc (Task 2). ✓

**Placeholder scan:** No "TBD"/"add error handling" — all code steps carry real code. The two places that say "match the file's existing X" (workspace test helper in 1.6, TreePane create UI in 9.5, fixtures in 10.1) point at concrete existing patterns rather than leaving logic unspecified, because those files' local conventions must be followed rather than duplicated blindly.

**Type consistency:** `createPtyHost`/`PtyHost` surface (start/write/resize/kill/has) consistent across Tasks 2 & 5. `createArtifactWatcher` `{ check, stop }` + `onHtml` consistent across Tasks 3 & 5. `HookService` (`port`/`register`/`unregister`/`close`) consistent across Tasks 4 & 5. Preload names (`ptyStart`/`ptyInput`/`ptyResize`/`ptyKill`/`onPtyData`/`onPtyExit`/`onArtifactUpdate`) consistent across Tasks 5, 6, 7, 9. Store fields (`mode`/`artifactHtml`/`ptyExit`/`applyArtifactUpdate`/`applyPtyExit`) consistent across Tasks 6, 7, 8, 9.

**Note on `cliSession.recheck`:** the controller exposes a `recheck(sessionId)` used by the hook `onHook` wiring (Task 5, index.ts). Implemented as a property in Task 3's controller object; if the spread pattern reads awkwardly during implementation, promote `recheck` to a first-class method on the returned `CliSessions` object and update the `onHook` closure accordingly — behavior is identical.
