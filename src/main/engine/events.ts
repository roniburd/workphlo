import type { EngineEvent } from '../../shared/types'

export interface RawMessage {
  type: string
  event?: any
  id?: string
  is_error?: boolean
  subtype?: string
  result?: string
  session_id?: string
  usage?: { input_tokens?: number; output_tokens?: number }
}

export function messageToEvents(msg: RawMessage): EngineEvent[] {
  switch (msg.type) {
    case 'stream_event': {
      const e = msg.event
      if (!e) return []
      if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta')
        return [{ kind: 'text_delta', text: e.delta.text }]
      if (e.type === 'content_block_start' && e.content_block?.type === 'thinking')
        return [{ kind: 'thinking', text: e.content_block.thinking ?? '' }]
      if (e.type === 'content_block_start' && e.content_block?.type === 'tool_use')
        return [{ kind: 'tool_use', id: e.content_block.id, name: e.content_block.name }]
      return []
    }
    case 'tool_result':
      return [{ kind: 'tool_result', id: msg.id ?? '', isError: Boolean(msg.is_error) }]
    case 'result': {
      const events: EngineEvent[] = []
      if (msg.subtype && msg.subtype !== 'success')
        events.push({ kind: 'error', message: msg.result ?? msg.subtype })
      events.push({
        kind: 'turn_end',
        sessionId: msg.session_id ?? '',
        usage: { inputTokens: msg.usage?.input_tokens, outputTokens: msg.usage?.output_tokens }
      })
      return events
    }
    default:
      return []
  }
}
