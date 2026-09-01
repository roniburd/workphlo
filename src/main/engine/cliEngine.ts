import { spawn as realSpawn } from 'node:child_process'
import readline from 'node:readline'
import type { AgentEngine, EngineEvent, RunRequest } from '../../shared/types'
import { parseCliLine } from './cliParser'

export function createCliEngine(deps: { spawn?: typeof realSpawn } = {}): AgentEngine {
  const spawnFn = deps.spawn ?? realSpawn
  let child: ReturnType<typeof realSpawn> | null = null
  return {
    async *run(req: RunRequest): AsyncIterable<EngineEvent> {
      const args = ['-p', req.prompt, '--output-format', 'stream-json', '--include-partial-messages', '--verbose']
      if (req.model) args.push('--model', req.model)
      if (req.resume) args.push('--resume', req.resume)
      if (req.allowedTools?.length) args.push('--allowedTools', req.allowedTools.join(','))
      child = spawnFn('claude', args, { cwd: req.cwd, stdio: ['ignore', 'pipe', 'pipe'] })

      // Surface process lifecycle without letting an 'error' (e.g. `claude` not on
      // PATH) become an uncaught exception that crashes the Electron main process.
      let stderrBuf = ''
      child.stderr?.on('data', (d) => {
        stderrBuf += String(d)
      })
      child.stdout?.on('error', () => {}) // avoid unhandled stream error on failed spawn
      const done = new Promise<{ code: number | null; error: Error | null }>((resolve) => {
        child!.once('error', (error) => resolve({ code: null, error }))
        child!.once('close', (code) => resolve({ code, error: null }))
      })

      let sawTurnEnd = false
      const rl = readline.createInterface({ input: child.stdout! })
      try {
        for await (const line of rl) {
          for (const ev of parseCliLine(line)) {
            if (ev.kind === 'turn_end') sawTurnEnd = true
            yield ev
          }
        }
      } finally {
        rl.close()
      }

      const { code, error } = await done
      if (error) {
        yield { kind: 'error', message: `Failed to launch claude: ${error.message}` }
        if (!sawTurnEnd) yield { kind: 'turn_end', sessionId: '' }
      } else if (!sawTurnEnd && code !== 0 && code !== null) {
        yield { kind: 'error', message: stderrBuf.trim() || `claude exited with code ${code}` }
        yield { kind: 'turn_end', sessionId: '' }
      }
    },
    interrupt() {
      child?.kill('SIGTERM')
    }
  }
}
