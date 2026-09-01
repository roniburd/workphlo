import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { abs } from './workspace/paths'
import { createEngine as defaultCreateEngine } from './engine'
import type { AgentEngine, EngineEvent, EngineKind, SessionMeta } from '../shared/types'

export async function runSessionPrompt(
  root: string,
  sessionId: string,
  prompt: string,
  emit: (e: EngineEvent) => void,
  deps: { createEngine?: (k: EngineKind) => AgentEngine } = {}
): Promise<void> {
  const meta: SessionMeta = JSON.parse(
    await readFile(join(abs(root, sessionId), 'session.json'), 'utf8')
  )
  const engine = (deps.createEngine ?? defaultCreateEngine)(meta.engine)
  for await (const ev of engine.run({ prompt, cwd: abs(root, sessionId) })) emit(ev)
}
