import { ipcMain, type BrowserWindow } from 'electron'
import {
  createProject,
  createSession,
  loadTree,
  loadDocument,
  loadSessionMeta,
  setSectionModel,
  appendDocumentSection,
  splitDocumentSection
} from './workspace/workspace'
import {
  runSessionPrompt,
  generateSection,
  generateAll,
  refreshSection,
  refreshAll,
  askSection,
  type SectionMessage,
  type AskMessage
} from './session'
import { createEngine } from './engine'
import type {
  AgentEngine,
  AskRequest,
  EngineKind,
  SectionFormat,
  SectionStatus,
  SectionType,
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
  // afterwards. Rejects if a run is already active for the session. Generic in
  // the result so doc-mutating handlers (append/split) can run under the same
  // guard and still return their payload.
  const withGuard = async <T>(sessionId: string, fn: () => Promise<T>): Promise<T> => {
    if (inFlight.has(sessionId)) {
      throw new Error(`a generation is already running for session: ${sessionId}`)
    }
    inFlight.add(sessionId)
    try {
      return await fn()
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
    } else if (m.type === 'stale') {
      // Dependents invalidated by this run — flip each to 'stale' on its own
      // section channel (NOT the running section's).
      for (const id of m.sectionIds) {
        win.webContents.send('wf:sectionStatus', { sessionId, sectionId: id, status: 'stale' })
      }
    } else {
      win.webContents.send('wf:sectionStatus', { sessionId, sectionId, status: m.status })
    }
  }

  // Fan an ask-scoped message out to the appropriate renderer channel. Section
  // and stale updates reuse the section channels; thread updates and docChanged
  // use the P2 push channels. Thread creation carries the full Thread in the
  // status payload so the renderer can insert it without a separate fetch.
  const sendAskMessage = (sessionId: string, m: AskMessage): void => {
    const win = getWindow()
    if (!win) return
    switch (m.type) {
      case 'section':
        sendSectionMessage(sessionId, m.sectionId, m.message)
        break
      case 'stale':
        for (const sectionId of m.sectionIds) {
          win.webContents.send('wf:sectionStatus', { sessionId, sectionId, status: 'stale' })
        }
        break
      case 'docChanged':
        win.webContents.send('wf:docChanged', { sessionId })
        break
      case 'threadCreated':
        win.webContents.send('wf:threadStatus', {
          sessionId,
          threadId: m.thread.id,
          status: m.thread.status,
          thread: m.thread
        })
        break
      case 'threadEvent':
        win.webContents.send('wf:threadEvent', {
          sessionId,
          threadId: m.threadId,
          event: m.event
        })
        break
      case 'threadStatus':
        win.webContents.send('wf:threadStatus', {
          sessionId,
          threadId: m.threadId,
          status: m.status
        })
        break
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

  // Re-run a single stale/edited section with the current context.
  ipcMain.handle('wf:refreshSection', async (_e, sessionId: string, sectionId: string) =>
    withGuard(sessionId, () =>
      refreshSection(
        root,
        sessionId,
        sectionId,
        (m) => sendSectionMessage(sessionId, sectionId, m),
        trackingDeps(sessionId)
      )
    )
  )

  // Re-run every stale/error section in dependency order.
  ipcMain.handle('wf:refreshAll', async (_e, sessionId: string) =>
    withGuard(sessionId, () =>
      refreshAll(
        root,
        sessionId,
        (sectionId, m) => sendSectionMessage(sessionId, sectionId, m),
        trackingDeps(sessionId)
      )
    )
  )

  // Ask a scoped question about a section (thread / in-place edit / new cell).
  ipcMain.handle(
    'wf:askSection',
    async (_e, sessionId: string, sectionId: string, ask: AskRequest) =>
      withGuard(sessionId, () =>
        askSection(
          root,
          sessionId,
          sectionId,
          ask,
          (m) => sendAskMessage(sessionId, m),
          trackingDeps(sessionId)
        )
      )
  )

  // Append a new first-class section; broadcast docChanged so the renderer reloads.
  ipcMain.handle(
    'wf:appendSection',
    async (
      _e,
      sessionId: string,
      spec: {
        afterId?: string
        type: SectionType
        title: string
        hat: string
        format: SectionFormat
        body?: string
      }
    ): Promise<{
      doc: SessionDoc
      sectionStatus: Record<string, SectionStatus>
      newSectionId: string
    }> =>
      // Guard against clobbering document.md/session.json while a generate run is
      // in flight (that run rewrites the doc from a start-of-run snapshot).
      withGuard(sessionId, async () => {
        const { afterId, ...rest } = spec
        const { doc, newSectionId, meta } = await appendDocumentSection(
          root,
          sessionId,
          rest,
          afterId
        )
        getWindow()?.webContents.send('wf:docChanged', { sessionId })
        return { doc, sectionStatus: meta.sectionStatus ?? {}, newSectionId }
      })
  )

  // Split a section at a rendered/char offset; broadcast docChanged.
  ipcMain.handle(
    'wf:splitSection',
    async (
      _e,
      sessionId: string,
      sectionId: string,
      at: number,
      tail?: { title?: string; type?: SectionType; hat?: string; format?: SectionFormat }
    ): Promise<{
      doc: SessionDoc
      sectionStatus: Record<string, SectionStatus>
      newSectionId: string
    }> =>
      // Same in-flight guard as append: never rewrite the doc under a live run.
      withGuard(sessionId, async () => {
        const { doc, newSectionId, meta } = await splitDocumentSection(
          root,
          sessionId,
          sectionId,
          at,
          tail
        )
        if (newSectionId) getWindow()?.webContents.send('wf:docChanged', { sessionId })
        return { doc, sectionStatus: meta.sectionStatus ?? {}, newSectionId }
      })
  )

  ipcMain.handle('wf:interrupt', (_e, sessionId: string) => {
    // Signal generateAll to stop between sections, and interrupt the in-flight
    // engine so the current section's stream ends.
    aborters.get(sessionId)?.abort()
    activeEngines.get(sessionId)?.interrupt()
  })
}
