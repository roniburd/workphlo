import { query as realQuery } from '@anthropic-ai/claude-agent-sdk'
import type { AgentEngine, EngineEvent, RunRequest } from '../../shared/types'
import { messageToEvents, type RawMessage } from './events'

export type SdkQueryFn = (args: {
  prompt: string
  options?: Record<string, unknown>
}) => AsyncIterable<unknown>

export function createSdkEngine(deps: { query?: SdkQueryFn } = {}): AgentEngine {
  const queryFn: SdkQueryFn = deps.query ?? (realQuery as unknown as SdkQueryFn)
  let aborted = false
  return {
    async *run(req: RunRequest): AsyncIterable<EngineEvent> {
      aborted = false
      let iterable: AsyncIterable<unknown>
      try {
        iterable = queryFn({
          prompt: req.prompt,
          options: {
            model: req.model,
            systemPrompt: req.systemPrompt,
            allowedTools: req.allowedTools ?? [],
            cwd: req.cwd,
            resume: req.resume,
            includePartialMessages: true
          }
        })
      } catch (err) {
        yield { kind: 'error', message: (err as Error).message }
        yield { kind: 'turn_end', sessionId: '' }
        return
      }
      let sawTurnEnd = false
      try {
        for await (const msg of iterable) {
          if (aborted) return
          for (const ev of messageToEvents(msg as RawMessage)) {
            if (ev.kind === 'turn_end') sawTurnEnd = true
            yield ev
          }
        }
      } catch (err) {
        yield { kind: 'error', message: (err as Error).message }
        if (!sawTurnEnd) yield { kind: 'turn_end', sessionId: '' }
      }
    },
    interrupt() {
      aborted = true
    }
  }
}
