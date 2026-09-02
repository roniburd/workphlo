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
  // Generation commands — all scoped to the active session.
  generateSection: (sectionId: string) => Promise<void>
  generateAll: () => Promise<void>
  setSectionModel: (sectionId: string, model?: string) => Promise<void>
  interrupt: () => Promise<void>
  // Routing of main→renderer section streams into the live document. Guarded by
  // activeSessionId so stale sessions cannot mutate the visible doc.
  applySectionEvent: (p: { sessionId: string; sectionId: string; event: EngineEvent }) => void
  applySectionStatus: (p: { sessionId: string; sectionId: string; status: SectionStatus }) => void
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
  clearTranscript: () => set({ transcript: '' }),
  generateSection: async (sectionId) => {
    const id = get().activeSessionId
    if (!id) return
    await window.workphlo.generateSection(id, sectionId)
  },
  generateAll: async () => {
    const id = get().activeSessionId
    if (!id) return
    await window.workphlo.generateAll(id)
  },
  setSectionModel: async (sectionId, model) => {
    const id = get().activeSessionId
    if (!id) return
    const meta = await window.workphlo.setSectionModel(id, sectionId, model)
    // Ignore a stale response if the selection changed while awaiting.
    if (get().activeSessionId !== id || !meta.sectionStatus) return
    set({ sectionStatus: meta.sectionStatus })
  },
  interrupt: async () => {
    const id = get().activeSessionId
    if (!id) return
    await window.workphlo.interrupt(id)
  },
  applySectionEvent: ({ sessionId, sectionId, event }) =>
    set((s) => {
      if (sessionId !== s.activeSessionId || !s.doc || event.kind !== 'text_delta') return s
      return {
        doc: {
          ...s.doc,
          sections: s.doc.sections.map((sec) =>
            sec.id === sectionId ? { ...sec, body: sec.body + event.text } : sec
          )
        }
      }
    }),
  applySectionStatus: ({ sessionId, sectionId, status }) =>
    set((s) => {
      if (sessionId !== s.activeSessionId) return s
      return { sectionStatus: { ...s.sectionStatus, [sectionId]: status } }
    })
}))
