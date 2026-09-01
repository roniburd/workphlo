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
export type SectionType = 'summary' | 'requirements' | 'diff' | 'code' | 'review' | 'perf' | 'open-qs'
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
