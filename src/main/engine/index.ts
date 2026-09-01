import type { AgentEngine, EngineKind } from '../../shared/types'
import { createCliEngine } from './cliEngine'
import { createSdkEngine } from './sdkEngine'

export function createEngine(kind: EngineKind): AgentEngine {
  return kind === 'sdk' ? createSdkEngine() : createCliEngine()
}
