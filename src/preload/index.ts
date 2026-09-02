import { contextBridge, ipcRenderer } from 'electron'
import type { TreeNode, EngineEvent, SessionDoc, SectionStatus, SessionMeta } from '../shared/types'

// Custom APIs for renderer
const workphlo = {
  getTree: () => ipcRenderer.invoke('wf:getTree') as Promise<TreeNode[]>,
  getDocument: (sessionId: string) =>
    ipcRenderer.invoke('wf:getDocument', sessionId) as Promise<{
      doc: SessionDoc
      sectionStatus: Record<string, SectionStatus>
    }>,
  createProject: (name: string, parentId?: string) =>
    ipcRenderer.invoke('wf:createProject', name, parentId) as Promise<TreeNode[]>,
  createSession: (projectId: string, name: string) =>
    ipcRenderer.invoke('wf:createSession', projectId, name) as Promise<TreeNode[]>,
  runPrompt: (sessionId: string, prompt: string) =>
    ipcRenderer.invoke('wf:runPrompt', sessionId, prompt) as Promise<void>,
  generateSection: (sessionId: string, sectionId: string) =>
    ipcRenderer.invoke('wf:generateSection', sessionId, sectionId) as Promise<void>,
  generateAll: (sessionId: string) =>
    ipcRenderer.invoke('wf:generateAll', sessionId) as Promise<void>,
  setSectionModel: (sessionId: string, sectionId: string, model?: string) =>
    ipcRenderer.invoke('wf:setSectionModel', sessionId, sectionId, model) as Promise<SessionMeta>,
  interrupt: (sessionId: string) => ipcRenderer.invoke('wf:interrupt', sessionId) as Promise<void>,
  onEngineEvent: (cb: (p: { sessionId: string; event: EngineEvent }) => void) => {
    const listener = (_e: unknown, p: { sessionId: string; event: EngineEvent }): void => cb(p)
    ipcRenderer.on('wf:engineEvent', listener)
    return () => ipcRenderer.removeListener('wf:engineEvent', listener)
  },
  // Section-scoped engine stream (deltas, tool use, turn_end, ...).
  onSectionEvent: (
    cb: (p: { sessionId: string; sectionId: string; event: EngineEvent }) => void
  ) => {
    const listener = (
      _e: unknown,
      p: { sessionId: string; sectionId: string; event: EngineEvent }
    ): void => cb(p)
    ipcRenderer.on('wf:sectionEvent', listener)
    return () => ipcRenderer.removeListener('wf:sectionEvent', listener)
  },
  // Section lifecycle transitions (empty → generating → ready/error).
  onSectionStatus: (
    cb: (p: { sessionId: string; sectionId: string; status: SectionStatus }) => void
  ) => {
    const listener = (
      _e: unknown,
      p: { sessionId: string; sectionId: string; status: SectionStatus }
    ): void => cb(p)
    ipcRenderer.on('wf:sectionStatus', listener)
    return () => ipcRenderer.removeListener('wf:sectionStatus', listener)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('workphlo', workphlo)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.workphlo = workphlo
}

export type WorkphloApi = typeof workphlo
