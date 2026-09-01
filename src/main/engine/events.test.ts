import { describe, it, expect } from 'vitest'
import { messageToEvents } from './events'
import { parseCliLine } from './cliParser'

describe('messageToEvents', () => {
  it('maps a text delta', () => {
    expect(messageToEvents({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } } }))
      .toEqual([{ kind: 'text_delta', text: 'Hi' }])
  })
  it('maps a tool_use start', () => {
    expect(messageToEvents({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', id: 't1', name: 'Read' } } }))
      .toEqual([{ kind: 'tool_use', id: 't1', name: 'Read' }])
  })
  it('maps a successful result to turn_end with usage', () => {
    expect(messageToEvents({ type: 'result', subtype: 'success', session_id: 's1', usage: { input_tokens: 3, output_tokens: 4 } }))
      .toEqual([{ kind: 'turn_end', sessionId: 's1', usage: { inputTokens: 3, outputTokens: 4 } }])
  })
  it('maps an error result to error + turn_end', () => {
    expect(messageToEvents({ type: 'result', subtype: 'error_max_turns', result: 'boom', session_id: 's2' }))
      .toEqual([{ kind: 'error', message: 'boom' }, { kind: 'turn_end', sessionId: 's2', usage: { inputTokens: undefined, outputTokens: undefined } }])
  })
  it('ignores unrelated stream events', () => {
    expect(messageToEvents({ type: 'stream_event', event: { type: 'message_start' } })).toEqual([])
  })
  it('maps a thinking block start', () => {
    expect(messageToEvents({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'thinking', thinking: 'hmm' } } }))
      .toEqual([{ kind: 'thinking', text: 'hmm' }])
  })
  it('maps a tool_result', () => {
    expect(messageToEvents({ type: 'tool_result', id: 't1', is_error: true }))
      .toEqual([{ kind: 'tool_result', id: 't1', isError: true }])
  })
})

describe('parseCliLine', () => {
  it('parses a JSON NDJSON line via the shared mapper', () => {
    const line = JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'yo' } } })
    expect(parseCliLine(line)).toEqual([{ kind: 'text_delta', text: 'yo' }])
  })
  it('returns [] for blank or non-JSON lines', () => {
    expect(parseCliLine('')).toEqual([])
    expect(parseCliLine('not json')).toEqual([])
  })
})
