import { describe, it, expect } from 'vitest'
import { Readable } from 'node:stream'
import { createCliEngine } from './cliEngine'
import type { EngineEvent } from '../../shared/types'

function fakeSpawn(lines: string[]) {
  return () =>
    ({
      stdout: Readable.from(lines.map((l) => l + '\n').join('')),
      stderr: Readable.from([]),
      kill: () => {}
    }) as any
}

describe('CliEngine', () => {
  it('streams normalized events parsed from stdout NDJSON', async () => {
    const lines = [
      JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } } }),
      JSON.stringify({ type: 'result', subtype: 'success', session_id: 'abc', usage: { input_tokens: 1, output_tokens: 2 } })
    ]
    const eng = createCliEngine({ spawn: fakeSpawn(lines) })
    const got: EngineEvent[] = []
    for await (const ev of eng.run({ prompt: 'hi' })) got.push(ev)
    expect(got).toEqual([
      { kind: 'text_delta', text: 'Hello' },
      { kind: 'turn_end', sessionId: 'abc', usage: { inputTokens: 1, outputTokens: 2 } }
    ])
  })
})
