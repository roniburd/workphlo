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
      const rl = readline.createInterface({ input: child.stdout! })
      try {
        for await (const line of rl) {
          for (const ev of parseCliLine(line)) yield ev
        }
      } finally {
        rl.close()
      }
    },
    interrupt() {
      child?.kill('SIGTERM')
    }
  }
}
