import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { createCliEngine } from './cliEngine'
import type { EngineEvent } from '../../shared/types'

function fakeChild(lines: string[], opts: { code?: number; stderr?: string } = {}) {
  const child = new EventEmitter() as any
  child.stdout = Readable.from(lines.map((l) => l + '\n').join(''))
  child.stderr = Readable.from(opts.stderr ? [opts.stderr] : [])
  child.kill = () => {}
  child.stdout.on('end', () => setImmediate(() => child.emit('close', opts.code ?? 0)))
  return child
}
function fakeSpawn(lines: string[], opts: { code?: number; stderr?: string } = {}) {
  return () => fakeChild(lines, opts) as any
}
function fakeErrorSpawn(err: Error) {
  return () => {
    const child = new EventEmitter() as any
    child.stdout = Readable.from([])
    child.stderr = Readable.from([])
    child.kill = () => {}
    setImmediate(() => child.emit('error', err))
    return child as any
  }
}

describe('CliEngine', () => {
  it('streams normalized events parsed from stdout NDJSON', async () => {
    const lines = [
      JSON.stringify({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } }
      }),
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        session_id: 'abc',
        usage: { input_tokens: 1, output_tokens: 2 }
      })
    ]
    const eng = createCliEngine({ spawn: fakeSpawn(lines) })
    const got: EngineEvent[] = []
    for await (const ev of eng.run({ prompt: 'hi' })) got.push(ev)
    expect(got).toEqual([
      { kind: 'text_delta', text: 'Hello' },
      { kind: 'turn_end', sessionId: 'abc', usage: { inputTokens: 1, outputTokens: 2 } }
    ])
  })

  it('surfaces a spawn failure as error + turn_end instead of throwing', async () => {
    const eng = createCliEngine({ spawn: fakeErrorSpawn(new Error('spawn claude ENOENT')) })
    const got: EngineEvent[] = []
    await expect(
      (async () => {
        for await (const ev of eng.run({ prompt: 'hi' })) got.push(ev)
      })()
    ).resolves.not.toThrow()
    expect(got).toEqual([
      { kind: 'error', message: 'Failed to launch claude: spawn claude ENOENT' },
      { kind: 'turn_end', sessionId: '' }
    ])
  })

  it('surfaces an abnormal exit with no result line as error + turn_end', async () => {
    const eng = createCliEngine({ spawn: fakeSpawn([], { code: 1, stderr: 'boom' }) })
    const got: EngineEvent[] = []
    for await (const ev of eng.run({ prompt: 'hi' })) got.push(ev)
    expect(got).toEqual([
      { kind: 'error', message: 'boom' },
      { kind: 'turn_end', sessionId: '' }
    ])
  })

  it('interrupt() before run is a safe no-op', () => {
    const eng = createCliEngine({ spawn: fakeSpawn([]) })
    expect(() => eng.interrupt()).not.toThrow()
  })
})
