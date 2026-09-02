import { create } from 'zustand'
import type { TreeNode, EngineEvent, SessionDoc, SectionStatus } from '../../shared/types'

interface State {
  tree: TreeNode[]
  activeSessionId: string | null
  transcript: string
  doc: SessionDoc | null
  sectionStatus: Record<string, SectionStatus>
  loadTree: () => Promise<void>
  select: (id: string) => void
  loadDoc: () => Promise<void>
  appendEvent: (e: EngineEvent) => void
  clearTranscript: () => void
}

function renderEvent(e: EngineEvent): string {
  switch (e.kind) {
    case 'text_delta':
      return e.text
    case 'thinking':
      return e.text
    case 'tool_use':
      return `\n[tool: ${e.name}]\n`
    case 'tool_result':
      return e.isError ? '\n[tool failed]\n' : ''
    case 'error':
      return `\n[error: ${e.message}]\n`
    case 'turn_end':
      return `\n`
    default:
      return ''
  }
}

export const useStore = create<State>()((set, get) => ({
  tree: [],
  activeSessionId: null,
  transcript: '',
  doc: null,
  sectionStatus: {},
  loadTree: async () => set({ tree: await window.workphlo.getTree() }),
  select: (id) => {
    set({ activeSessionId: id, transcript: '', doc: null, sectionStatus: {} })
    void get().loadDoc()
  },
  loadDoc: async () => {
    const id = get().activeSessionId
    if (!id) return
    const { doc, sectionStatus } = await window.workphlo.getDocument(id)
    // Ignore a stale response if the selection changed while awaiting.
    if (get().activeSessionId !== id) return
    set({ doc, sectionStatus })
  },
  appendEvent: (e) => set((s) => ({ transcript: s.transcript + renderEvent(e) })),
  clearTranscript: () => set({ transcript: '' })
}))
