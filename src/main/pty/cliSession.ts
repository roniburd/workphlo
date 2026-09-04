import { createPtyHost, type PtyHost } from './ptyHost'
import { createArtifactWatcher } from './artifactWatcher'
import type { HookService } from './hookService'
import { abs } from '../workspace/paths'

export interface CliSessions {
  start(sessionId: string, cols: number, rows: number, model?: string): void
  input(sessionId: string, data: string): void
  resize(sessionId: string, cols: number, rows: number): void
  kill(sessionId: string): void
  // Triggered by a Stop/PostToolUse hook (via index.ts wiring) to force an
  // immediate artifact recheck for the session's watcher.
  recheck(sessionId: string): void
  // Reaps every live pty (called on app quit).
  killAll(): void
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
      // A live pty already exists for this session (e.g. TerminalPane remounted
      // on session-switch) — no-op. The pty keeps streaming and the renderer
      // re-subscribes to wf:pty:data, so forward output still appears; we just
      // don't re-register a hook token or spin up a second watcher.
      if (ptyHost.has(sessionId)) return
      const cwd = abs(o.root, sessionId)
      const token = o.hooks.register(sessionId)
      const watcher = makeWatcher({
        cwd,
        onHtml: (html) => o.send('wf:artifactUpdate', { sessionId, html })
      })
      watchers.set(sessionId, watcher)
      // A Stop/PostToolUse hook triggers an immediate recheck (primary signal).
      // (index.ts wires hooks.onHook → this.recheck; see index.ts.)
      try {
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
      } catch (err) {
        stopWatcher(sessionId)
        o.hooks.unregister(sessionId)
        throw err
      }
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
    recheck(sessionId) {
      void watchers.get(sessionId)?.check()
    },
    killAll() {
      ptyHost.killAll()
    }
  }
}
