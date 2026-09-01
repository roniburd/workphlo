import { ipcMain, type BrowserWindow } from 'electron'
import {
  createProject,
  createSession,
  loadTree,
  loadDocument,
  loadSessionMeta
} from './workspace/workspace'
import { runSessionPrompt } from './session'
import type { SectionStatus, SessionDoc } from '../shared/types'

export function registerIpc(root: string, getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('wf:getTree', () => loadTree(root))

  ipcMain.handle(
    'wf:getDocument',
    async (
      _e,
      sessionId: string
    ): Promise<{ doc: SessionDoc; sectionStatus: Record<string, SectionStatus> }> => {
      const doc = await loadDocument(root, sessionId)
      const meta = await loadSessionMeta(root, sessionId)
      return { doc, sectionStatus: meta?.sectionStatus ?? {} }
    }
  )

  ipcMain.handle('wf:createProject', async (_e, name: string, parentId?: string) => {
    await createProject(root, name, parentId)
    return loadTree(root)
  })

  ipcMain.handle('wf:createSession', async (_e, projectId: string, name: string) => {
    await createSession(root, projectId, name, 'spec-design', 'cli')
    return loadTree(root)
  })

  ipcMain.handle('wf:runPrompt', async (_e, sessionId: string, prompt: string) => {
    await runSessionPrompt(root, sessionId, prompt, (event) => {
      getWindow()?.webContents.send('wf:engineEvent', { sessionId, event })
    })
  })
}
