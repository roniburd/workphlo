import type { EngineEvent } from '../../shared/types'
import { messageToEvents, type RawMessage } from './events'

export function parseCliLine(line: string): EngineEvent[] {
  const t = line.trim()
  if (!t) return []
  let msg: unknown
  try {
    msg = JSON.parse(t)
  } catch {
    return []
  }
  if (typeof msg !== 'object' || msg === null) return []
  return messageToEvents(msg as RawMessage)
}
