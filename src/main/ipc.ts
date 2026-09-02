import { ipcMain, type BrowserWindow } from 'electron'
import {
  createProject,
  createSession,
  loadTree,
  loadDocument,
  loadSessionMeta,
  setSectionModel
} from './workspace/workspace'
import { runSessionPrompt, generateSection, generateAll, type SectionMessage } from './session'
import { createEngine } from './engine'
import type {
  AgentEngine,
  EngineKind,
  SectionStatus,
  SessionDoc,
  SessionMeta
} from '../shared/types'

export function registerIpc(root: string, getWindow: () => BrowserWindow | null): void {
  // Active engine per session, so wf:interrupt can stop the in-flight run. We
  // register the engine through the same DI seam generateSection already uses.
  const activeEngines = new Map<string, AgentEngine>()
  // Per-session abort controllers so wf:interrupt can stop a generateAll run
  // between sections (and be threaded down as deps.signal).
  const aborters = new Map<string, AbortController>()
  // Per-session in-flight guard: only one generate run per session at a time.
  // This prevents lost-update doc clobbers and the activeEngines[sessionId]
  // collision where one handler's finally deletes the other's registration.
  const inFlight = new Set<string>()
  const trackingDeps = (
    sessionId: string
  ): { createEngine: (k: EngineKind) => AgentEngine; signal: AbortSignal } => {
    const controller = new AbortController()
    aborters.set(sessionId, controller)
    return {
      createEngine: (kind) => {
        const engine = createEngine(kind)
        activeEngines.set(sessionId, engine)
        return engine
      },
      signal: controller.signal
    }
  }

  // Run `fn` under the per-session in-flight guard, cleaning up tracking state
  // afterwards. Rejects if a run is already active for the session.
  const withGuard = async (sessionId: string, fn: () => Promise<void>): Promise<void> => {
    if (inFlight.has(sessionId)) {
      throw new Error(`a generation is already running for session: ${sessionId}`)
    }
    inFlight.add(sessionId)
    try {
      await fn()
    } finally {
      inFlight.delete(sessionId)
      activeEngines.delete(sessionId)
      aborters.delete(sessionId)
    }
  }

  // Fan a section-scoped message out to the correct renderer channel.
  const sendSectionMessage = (sessionId: string, sectionId: string, m: SectionMessage): void => {
    const win = getWindow()
    if (!win) return
    if (m.type === 'event') {
      win.webContents.send('wf:sectionEvent', { sessionId, sectionId, event: m.event })
    } else {
      win.webContents.send('wf:sectionStatus', { sessionId, sectionId, status: m.status })
    }
  }

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

  ipcMain.handle('wf:generateSection', async (_e, sessionId: string, sectionId: string) =>
    withGuard(sessionId, () =>
      generateSection(
        root,
        sessionId,
        sectionId,
        (m) => sendSectionMessage(sessionId, sectionId, m),
        trackingDeps(sessionId)
      )
    )
  )

  ipcMain.handle('wf:generateAll', async (_e, sessionId: string) =>
    withGuard(sessionId, () =>
      generateAll(
        root,
        sessionId,
        (sectionId, m) => sendSectionMessage(sessionId, sectionId, m),
        trackingDeps(sessionId)
      )
    )
  )

  ipcMain.handle(
    'wf:setSectionModel',
    async (_e, sessionId: string, sectionId: string, model?: string): Promise<SessionMeta> =>
      setSectionModel(root, sessionId, sectionId, model)
  )

  ipcMain.handle('wf:interrupt', (_e, sessionId: string) => {
    // Signal generateAll to stop between sections, and interrupt the in-flight
    // engine so the current section's stream ends.
    aborters.get(sessionId)?.abort()
    activeEngines.get(sessionId)?.interrupt()
  })
}
