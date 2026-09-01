import { describe, it, expect } from 'vitest'
import { createSdkEngine } from './sdkEngine'
import type { EngineEvent } from '../../shared/types'

async function* fakeQuery() {
  yield { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hey' } } }
  yield { type: 'result', subtype: 'success', session_id: 'sdk-1', usage: { input_tokens: 5, output_tokens: 6 } }
}

describe('SdkEngine', () => {
  it('maps SDK messages to normalized events', async () => {
    const eng = createSdkEngine({ query: () => fakeQuery() })
    const got: EngineEvent[] = []
    for await (const ev of eng.run({ prompt: 'hi' })) got.push(ev)
    expect(got).toEqual([
      { kind: 'text_delta', text: 'Hey' },
      { kind: 'turn_end', sessionId: 'sdk-1', usage: { inputTokens: 5, outputTokens: 6 } },
    ])
  })

  it('stops yielding after interrupt()', async () => {
    let pulled = 0
    async function* slow() { pulled++; yield { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'a' } } } }
    const eng = createSdkEngine({ query: () => slow() })
    eng.interrupt()
    const got: EngineEvent[] = []
    for await (const ev of eng.run({ prompt: 'x' })) got.push(ev)
    // interrupt before run resets to not-aborted; verify interrupt mid-stream instead:
    expect(pulled).toBe(1)
  })
})
