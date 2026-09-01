export type NodeType = 'project' | 'session'
export interface TreeNode {
  id: string
  type: NodeType
  name: string
  children: TreeNode[]
}
export interface ProjectMeta {
  id: string
  name: string
  children: string[] // child ids, ordered
}
export type EngineKind = 'cli' | 'sdk'
export interface SessionMeta {
  id: string
  name: string
  templateId: string
  engine: EngineKind
  status: string
}
export type SectionType =
  'summary' | 'requirements' | 'diff' | 'code' | 'review' | 'perf' | 'open-qs'
export type SectionFormat = 'html' | 'md'
export interface Section {
  id: string
  type: SectionType
  title: string
  hat: string
  format: SectionFormat
  body: string
}
export interface SessionDoc {
  sections: Section[]
}
export interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
}
export type EngineEvent =
  | { kind: 'text_delta'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool_use'; id: string; name: string }
  | { kind: 'tool_result'; id: string; isError: boolean }
  | { kind: 'needs_input'; prompt: string } // reserved for P3; not emitted in P0
  | { kind: 'turn_end'; sessionId: string; usage?: TokenUsage }
  | { kind: 'error'; message: string }
export interface RunRequest {
  prompt: string
  model?: string
  systemPrompt?: string
  allowedTools?: string[]
  cwd?: string
  resume?: string
}
export interface AgentEngine {
  run(req: RunRequest): AsyncIterable<EngineEvent>
  interrupt(): void
}
