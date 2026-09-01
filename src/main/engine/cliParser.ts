import type { EngineEvent } from '../../shared/types'
import { messageToEvents, type RawMessage } from './events'

export function parseCliLine(line: string): EngineEvent[] {
  const t = line.trim()
  if (!t) return []
  let msg: RawMessage
  try {
    msg = JSON.parse(t)
  } catch {
    return []
  }
  return messageToEvents(msg)
}
