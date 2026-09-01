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
