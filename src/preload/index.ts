import { contextBridge, ipcRenderer } from 'electron'
import type {
  TreeNode,
  EngineEvent,
  SessionDoc,
  SectionStatus,
  SessionMeta,
  AskRequest,
  SectionType,
  SectionFormat,
  Thread
} from '../shared/types'

// Shape returned by wf:appendSection / wf:splitSection — the updated doc + status
// map + the minted section id (empty string for a split no-op).
type DocMutation = {
  doc: SessionDoc
  sectionStatus: Record<string, SectionStatus>
  newSectionId: string
}

// Custom APIs for renderer
const workphlo = {
  getTree: () => ipcRenderer.invoke('wf:getTree') as Promise<TreeNode[]>,
  getDocument: (sessionId: string) =>
    ipcRenderer.invoke('wf:getDocument', sessionId) as Promise<{
      doc: SessionDoc
      sectionStatus: Record<string, SectionStatus>
      mode: 'document' | 'cli'
    }>,
  createProject: (name: string, parentId?: string) =>
    ipcRenderer.invoke('wf:createProject', name, parentId) as Promise<TreeNode[]>,
  createSession: (projectId: string, name: string, mode: 'document' | 'cli' = 'document') =>
    ipcRenderer.invoke('wf:createSession', projectId, name, mode) as Promise<TreeNode[]>,
  ptyStart: (sessionId: string, cols: number, rows: number) =>
    ipcRenderer.invoke('wf:pty:start', sessionId, cols, rows) as Promise<void>,
  ptyInput: (sessionId: string, data: string) => ipcRenderer.send('wf:pty:input', sessionId, data),
  ptyResize: (sessionId: string, cols: number, rows: number) =>
    ipcRenderer.send('wf:pty:resize', sessionId, cols, rows),
  ptyKill: (sessionId: string) => ipcRenderer.invoke('wf:pty:kill', sessionId) as Promise<void>,
  onPtyData: (cb: (p: { sessionId: string; data: string }) => void) => {
    const l = (_e: unknown, p: { sessionId: string; data: string }): void => cb(p)
    ipcRenderer.on('wf:pty:data', l)
    return () => ipcRenderer.removeListener('wf:pty:data', l)
  },
  onPtyExit: (cb: (p: { sessionId: string; code: number; signal?: number }) => void) => {
    const l = (_e: unknown, p: { sessionId: string; code: number; signal?: number }): void => cb(p)
    ipcRenderer.on('wf:pty:exit', l)
    return () => ipcRenderer.removeListener('wf:pty:exit', l)
  },
  onArtifactUpdate: (cb: (p: { sessionId: string; html: string }) => void) => {
    const l = (_e: unknown, p: { sessionId: string; html: string }): void => cb(p)
    ipcRenderer.on('wf:artifactUpdate', l)
    return () => ipcRenderer.removeListener('wf:artifactUpdate', l)
  },
  runPrompt: (sessionId: string, prompt: string) =>
    ipcRenderer.invoke('wf:runPrompt', sessionId, prompt) as Promise<void>,
  generateSection: (sessionId: string, sectionId: string) =>
    ipcRenderer.invoke('wf:generateSection', sessionId, sectionId) as Promise<void>,
  generateAll: (sessionId: string) =>
    ipcRenderer.invoke('wf:generateAll', sessionId) as Promise<void>,
  setSectionModel: (sessionId: string, sectionId: string, model?: string) =>
    ipcRenderer.invoke('wf:setSectionModel', sessionId, sectionId, model) as Promise<SessionMeta>,
  interrupt: (sessionId: string) => ipcRenderer.invoke('wf:interrupt', sessionId) as Promise<void>,
  // Re-run a single stale/edited section with the current context.
  refreshSection: (sessionId: string, sectionId: string) =>
    ipcRenderer.invoke('wf:refreshSection', sessionId, sectionId) as Promise<void>,
  // Re-run all stale/error sections in dependency order.
  refreshAll: (sessionId: string) =>
    ipcRenderer.invoke('wf:refreshAll', sessionId) as Promise<void>,
  // Ask a scoped question about a section (thread / in-place edit / new cell).
  askSection: (sessionId: string, sectionId: string, ask: AskRequest) =>
    ipcRenderer.invoke('wf:askSection', sessionId, sectionId, ask) as Promise<void>,
  // Append a new first-class section (returns the updated doc + status + new id).
  appendSection: (
    sessionId: string,
    spec: {
      afterId?: string
      type: SectionType
      title: string
      hat: string
      format: SectionFormat
      body?: string
    }
  ) => ipcRenderer.invoke('wf:appendSection', sessionId, spec) as Promise<DocMutation>,
  // Split a section at a rendered/char offset (returns the updated doc + new id).
  splitSection: (
    sessionId: string,
    sectionId: string,
    at: number,
    tail?: { title?: string; type?: SectionType; hat?: string; format?: SectionFormat }
  ) =>
    ipcRenderer.invoke('wf:splitSection', sessionId, sectionId, at, tail) as Promise<DocMutation>,
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
  },
  // Thread-scoped engine stream (deltas of an ask's agent answer).
  onThreadEvent: (cb: (p: { sessionId: string; threadId: string; event: EngineEvent }) => void) => {
    const listener = (
      _e: unknown,
      p: { sessionId: string; threadId: string; event: EngineEvent }
    ): void => cb(p)
    ipcRenderer.on('wf:threadEvent', listener)
    return () => ipcRenderer.removeListener('wf:threadEvent', listener)
  },
  // Thread lifecycle transitions. On creation the payload also carries the full
  // `thread` so the renderer can insert it without a separate fetch.
  onThreadStatus: (
    cb: (p: {
      sessionId: string
      threadId: string
      status: Thread['status']
      thread?: Thread
    }) => void
  ) => {
    const listener = (
      _e: unknown,
      p: { sessionId: string; threadId: string; status: Thread['status']; thread?: Thread }
    ): void => cb(p)
    ipcRenderer.on('wf:threadStatus', listener)
    return () => ipcRenderer.removeListener('wf:threadStatus', listener)
  },
  // Document structure changed (append/split/expand); renderer should reload the doc.
  onDocChanged: (cb: (p: { sessionId: string }) => void) => {
    const listener = (_e: unknown, p: { sessionId: string }): void => cb(p)
    ipcRenderer.on('wf:docChanged', listener)
    return () => ipcRenderer.removeListener('wf:docChanged', listener)
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
