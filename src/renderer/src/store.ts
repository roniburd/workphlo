import { create } from 'zustand'
import type { TreeNode, EngineEvent } from '../../shared/types'

interface State {
  tree: TreeNode[]
  activeSessionId: string | null
  transcript: string
  loadTree: () => Promise<void>
  select: (id: string) => void
  appendEvent: (e: EngineEvent) => void
  clearTranscript: () => void
}

function renderEvent(e: EngineEvent): string {
  switch (e.kind) {
    case 'text_delta':
      return e.text
    case 'tool_use':
      return `\n[tool: ${e.name}]\n`
    case 'error':
      return `\n[error: ${e.message}]\n`
    case 'turn_end':
      return `\n`
    default:
      return ''
  }
}

export const useStore = create<State>()((set) => ({
  tree: [],
  activeSessionId: null,
  transcript: '',
  loadTree: async () => set({ tree: await window.workphlo.getTree() }),
  select: (id) => set({ activeSessionId: id, transcript: '' }),
  appendEvent: (e) => set((s) => ({ transcript: s.transcript + renderEvent(e) })),
  clearTranscript: () => set({ transcript: '' })
}))
