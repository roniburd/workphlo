import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { TreeNode, EngineEvent } from '../shared/types'

// Custom APIs for renderer
const workphlo = {
  getTree: () => ipcRenderer.invoke('wf:getTree') as Promise<TreeNode[]>,
  createProject: (name: string, parentId?: string) =>
    ipcRenderer.invoke('wf:createProject', name, parentId) as Promise<TreeNode[]>,
  createSession: (projectId: string, name: string) =>
    ipcRenderer.invoke('wf:createSession', projectId, name) as Promise<TreeNode[]>,
  runPrompt: (sessionId: string, prompt: string) =>
    ipcRenderer.invoke('wf:runPrompt', sessionId, prompt) as Promise<void>,
  onEngineEvent: (cb: (p: { sessionId: string; event: EngineEvent }) => void) => {
    const listener = (_e: unknown, p: { sessionId: string; event: EngineEvent }): void => cb(p)
    ipcRenderer.on('wf:engineEvent', listener)
    return () => ipcRenderer.removeListener('wf:engineEvent', listener)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', {})
    contextBridge.exposeInMainWorld('workphlo', workphlo)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = {}
  // @ts-ignore (define in dts)
  window.workphlo = workphlo
}

export type WorkphloApi = typeof workphlo
