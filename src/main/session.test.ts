import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkspace, createProject, createSession } from './workspace/workspace'
import { runSessionPrompt } from './session'
import type { AgentEngine, EngineEvent } from '../shared/types'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wf-'))
})

const fakeEngine = (events: EngineEvent[]): AgentEngine => ({
  async *run() {
    for (const e of events) yield e
  },
  interrupt() {}
})

describe('runSessionPrompt', () => {
  it('reads the session engine and forwards events to emit', async () => {
    await createWorkspace(root)
    const p = await createProject(root, 'P')
    const s = await createSession(root, p.id, 'S', 'spec-design', 'cli')
    const seen: EngineEvent[] = []
    await runSessionPrompt(root, s.id, 'hello', (e) => seen.push(e), {
      createEngine: () =>
        fakeEngine([
          { kind: 'text_delta', text: 'ok' },
          { kind: 'turn_end', sessionId: 'x' }
        ])
    })
    expect(seen).toEqual([
      { kind: 'text_delta', text: 'ok' },
      { kind: 'turn_end', sessionId: 'x' }
    ])
  })
})
