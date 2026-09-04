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
// Workspace-level config persisted in workphlo.json. Supplies the final
// fallback tier for model resolution (spec §2.2): section override → hat
// default → workspace default.
export interface WorkspaceConfig {
  version: number
  defaultEngine: EngineKind
  defaultModel?: string
}
// A hat models an agent role (spec §5): a system prompt + engine/model defaults
// + allowed tools. App-defined built-ins live in code; users can add more later.
export interface Hat {
  id: string
  name: string
  systemPrompt: string
  engine: EngineKind
  model?: string
  allowedTools?: string[]
}
export interface SessionMeta {
  id: string
  name: string
  templateId: string
  engine: EngineKind
  // Session experience mode. 'document' (default) = the live-section document.
  // 'cli' = embedded interactive `claude` terminal + live HTML artifact pane.
  // Distinct from `engine` (the headless execution adapter kind). Optional so
  // pre-existing session.json (no field) reads back as 'document'.
  mode?: 'document' | 'cli'
  status: string
  sectionStatus?: Record<string, SectionStatus>
  // Per-section model overrides (spec §2.2). Section override wins over the
  // hat default during model resolution. Keyed by section id.
  sectionOverrides?: Record<string, { model?: string }>
  // Threads (P2): section-scoped conversations, keyed by threadId. Stored here
  // (not in document.md) so the diffable/human-editable body stays clean and
  // anchors live alongside their thread. Per-section views = filter on
  // thread.sectionId. See Thread / SelectionAnchor below.
  threads?: Record<string, Thread>
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
// Per-section lifecycle state. Lives in session.json (volatile), keyed by section id.
export type SectionStatus = 'empty' | 'generating' | 'ready' | 'stale' | 'error'
// A template section: the scaffold the app owns (id/type/title/hat + context recipe).
export interface TemplateSection {
  id: string
  type: SectionType
  title: string
  hat: string
  format?: SectionFormat
  context?: string[]
}
export interface SectionTemplate {
  id: string
  name: string
  sections: TemplateSection[]
  dependencies?: Record<string, string[]>
}
export interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
}
// --- Threads + anchors (P2 §3.1/§11) -------------------------------------
// A quote-based text selector for anchoring a Thread to a span of a section's
// RENDERED plain text. Anchors are RECOMPUTED at render time (never persisted
// in document.md); the resolved shape is stored under a Thread in session.json.
// prefix/suffix (≈32 chars of surrounding rendered text) + startHint (char
// offset) disambiguate duplicate quotes; bodyHash gives a fast exact path when
// the rendered text is unchanged. When resolution fails, state = 'orphaned'
// (the thread stays section-scoped via sectionId — never silently mis-points).
export interface SelectionAnchor {
  sectionId: string
  quote: string
  prefix: string
  suffix: string
  startHint: number
  bodyHash: string
  state: 'anchored' | 'orphaned'
}
// One turn in a Thread. user = the ask (kind label + optional free text);
// agent = the accumulated/final answer.
export interface ThreadMessage {
  id: string
  role: 'user' | 'agent'
  text: string
  ts: string
  usage?: TokenUsage
}
// A section-scoped conversation. anchor undefined = whole-section thread.
// kind = a precanned AskIntent (or 'free'); status mirrors the streaming
// lifecycle broadcast over wf:threadStatus.
export interface Thread {
  id: string
  sectionId: string
  anchor?: SelectionAnchor
  kind: string
  status: 'idle' | 'generating' | 'ready' | 'error'
  createdAt: string
  updatedAt: string
  messages: ThreadMessage[]
}
// The precanned ask actions offered on a selection (plus 'free' for free text).
export type AskIntent = 'add-detail' | 'disagree' | 'explain' | 'expand' | 'free'
// The payload of an "ask" against a section (P2). `anchor` is the resolved
// quote-based selector (null = whole-section ask); `selectedText` is the verbatim
// selection; `intent` chooses the precanned action; `freeText` carries the user's
// own words (required for intent 'free', optional otherwise). Routing per intent:
//   'expand'    → appends a new section and generates into it (new cell)
//   'add-detail'→ rewrites the section body in place, then stales dependents
//   otherwise   → a section-scoped Thread turn (streamed conversational answer)
export interface AskRequest {
  anchor: SelectionAnchor | null
  selectedText: string
  intent: AskIntent
  freeText?: string
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
  // Resolved context recipe for the run (spec §2.1): section bodies, goal, and
  // repo notes concatenated into a single bundle prepended to the prompt.
  contextBundle?: string
}
export interface AgentEngine {
  run(req: RunRequest): AsyncIterable<EngineEvent>
  interrupt(): void
}
