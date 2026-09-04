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
