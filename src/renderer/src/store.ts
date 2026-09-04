import { create } from 'zustand'
import { resolveAnchor } from './sections/anchor'
import type {
  TreeNode,
  EngineEvent,
  SessionDoc,
  SectionStatus,
  Thread,
  AskRequest,
  SectionType,
  SectionFormat
} from '../../shared/types'

// Id used for the trailing agent message while a thread turn is still streaming.
// On turn_end the main process persists the final answer under a real id, but the
// renderer keeps this ephemeral message as the displayed answer (no refetch).
export const STREAMING_MSG_ID = '__streaming__'

interface State {
  tree: TreeNode[]
  activeSessionId: string | null
  transcript: string
  doc: SessionDoc | null
  sectionStatus: Record<string, SectionStatus>
  // Section-scoped conversations (P2), keyed by threadId. Populated from the
  // wf:threadStatus creation payload and grown by wf:threadEvent deltas.
  threads: Record<string, Thread>
  mode: 'document' | 'cli'
  artifactHtml: string
  ptyExit: { code: number; signal?: number } | null
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
  // P2 live-doc commands (all scoped to activeSessionId like generateSection).
  refreshSection: (sectionId: string) => Promise<void>
  refreshAll: () => Promise<void>
  askSection: (sectionId: string, ask: AskRequest) => Promise<void>
  appendSection: (spec: {
    afterId?: string
    type: SectionType
    title: string
    hat: string
    format: SectionFormat
    body?: string
  }) => Promise<void>
  splitSection: (
    sectionId: string,
    at: number,
    tail?: { title?: string; type?: SectionType; hat?: string; format?: SectionFormat }
  ) => Promise<void>
  // Routing of main→renderer section streams into the live document. Guarded by
  // activeSessionId so stale sessions cannot mutate the visible doc.
  applySectionEvent: (p: { sessionId: string; sectionId: string; event: EngineEvent }) => void
  applySectionStatus: (p: { sessionId: string; sectionId: string; status: SectionStatus }) => void
  // Thread stream routing (P2), guarded by activeSessionId like the section
  // channels. Creation carries the full Thread; deltas accumulate into a trailing
  // streaming agent message; status transitions mirror the thread lifecycle.
  applyThreadEvent: (p: { sessionId: string; threadId: string; event: EngineEvent }) => void
  applyThreadStatus: (p: {
    sessionId: string
    threadId: string
    status: Thread['status']
    thread?: Thread
  }) => void
  // Anchor re-resolution (P2 §11): after a section's body changes, re-locate each
  // thread's quote and flip thread.anchor.state anchored/orphaned so the "anchor
  // lost" badge reflects reality (never silently mis-points). `resolveAnchors`
  // drives the md/code path (rendered text === body); `setThreadAnchorState` is
  // driven by the html iframe's wf:anchorStates round-trip.
  resolveAnchors: (sectionId: string, renderedText: string) => void
  setThreadAnchorState: (threadId: string, state: 'anchored' | 'orphaned') => void
  // CLI session state — artifact HTML and pty exit, guarded by activeSessionId.
  applyArtifactUpdate: (p: { sessionId: string; html: string }) => void
  applyPtyExit: (p: { sessionId: string; code: number; signal?: number }) => void
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
  threads: {},
  mode: 'document',
  artifactHtml: '',
  ptyExit: null,
  loadTree: async () => set({ tree: await window.workphlo.getTree() }),
  select: (id) => {
    set({ activeSessionId: id, transcript: '', doc: null, sectionStatus: {}, threads: {}, artifactHtml: '', ptyExit: null, mode: 'document' })
    void get().loadDoc()
  },
  loadDoc: async () => {
    const id = get().activeSessionId
    if (!id) return
    const { doc, sectionStatus, mode } = await window.workphlo.getDocument(id)
    // Ignore a stale response if the selection changed while awaiting.
    if (get().activeSessionId !== id) return
    // Merge, don't clobber: a section streaming live (status 'generating') has a
    // partial body in the store from wf:sectionEvent deltas that the on-disk
    // document.md doesn't yet carry. A reload triggered mid-stream (e.g. by a
    // sibling's wf:docChanged) must keep the live body for those sections, or the
    // in-flight text would flicker away and be overwritten on turn_end anyway.
    set((s) => {
      const prev = s.doc
      const merged: SessionDoc = {
        ...doc,
        sections: doc.sections.map((sec) => {
          if (sectionStatus[sec.id] === 'generating') {
            const live = prev?.sections.find((p) => p.id === sec.id)
            if (live) return { ...sec, body: live.body }
          }
          return sec
        })
      }
      return { doc: merged, sectionStatus, mode }
    })
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
  refreshSection: async (sectionId) => {
    const id = get().activeSessionId
    if (!id) return
    await window.workphlo.refreshSection(id, sectionId)
  },
  refreshAll: async () => {
    const id = get().activeSessionId
    if (!id) return
    await window.workphlo.refreshAll(id)
  },
  askSection: async (sectionId, ask) => {
    const id = get().activeSessionId
    if (!id) return
    await window.workphlo.askSection(id, sectionId, ask)
  },
  appendSection: async (spec) => {
    const id = get().activeSessionId
    if (!id) return
    const res = await window.workphlo.appendSection(id, spec)
    // Apply the returned doc directly (the wf:docChanged broadcast also triggers
    // a reload, but doing it here keeps the store self-consistent immediately and
    // testable without the IPC push).
    if (get().activeSessionId !== id) return
    set({ doc: res.doc, sectionStatus: res.sectionStatus })
  },
  splitSection: async (sectionId, at, tail) => {
    const id = get().activeSessionId
    if (!id) return
    const res = await window.workphlo.splitSection(id, sectionId, at, tail)
    if (get().activeSessionId !== id || !res.newSectionId) return
    set({ doc: res.doc, sectionStatus: res.sectionStatus })
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
    }),
  applyThreadEvent: ({ sessionId, threadId, event }) =>
    set((s) => {
      if (sessionId !== s.activeSessionId || event.kind !== 'text_delta') return s
      const t = s.threads[threadId]
      if (!t) return s
      const msgs = [...t.messages]
      const last = msgs[msgs.length - 1]
      if (last && last.role === 'agent' && last.id === STREAMING_MSG_ID) {
        msgs[msgs.length - 1] = { ...last, text: last.text + event.text }
      } else {
        msgs.push({
          id: STREAMING_MSG_ID,
          role: 'agent',
          text: event.text,
          ts: new Date().toISOString()
        })
      }
      return { threads: { ...s.threads, [threadId]: { ...t, messages: msgs } } }
    }),
  applyThreadStatus: ({ sessionId, threadId, status, thread }) =>
    set((s) => {
      if (sessionId !== s.activeSessionId) return s
      // Creation payload carries the full Thread → insert it wholesale.
      if (thread) return { threads: { ...s.threads, [threadId]: thread } }
      const existing = s.threads[threadId]
      if (!existing) return s
      return {
        threads: {
          ...s.threads,
          [threadId]: { ...existing, status, updatedAt: new Date().toISOString() }
        }
      }
    }),
  resolveAnchors: (sectionId, renderedText) =>
    set((s) => {
      // Re-locate every anchored thread of this section against the new rendered
      // text and flip its state anchored/orphaned. md/code sections render their
      // body as plain text, so `renderedText` IS the resolution coordinate space;
      // html sections drive this via setThreadAnchorState (iframe round-trip).
      let changed = false
      const next: Record<string, Thread> = {}
      for (const [tid, t] of Object.entries(s.threads)) {
        if (t.sectionId !== sectionId || !t.anchor) {
          next[tid] = t
          continue
        }
        const { state } = resolveAnchor(t.anchor, renderedText)
        if (state !== t.anchor.state) {
          changed = true
          next[tid] = { ...t, anchor: { ...t.anchor, state } }
        } else {
          next[tid] = t
        }
      }
      return changed ? { threads: next } : s
    }),
  setThreadAnchorState: (threadId, state) =>
    set((s) => {
      const t = s.threads[threadId]
      if (!t || !t.anchor || t.anchor.state === state) return s
      return { threads: { ...s.threads, [threadId]: { ...t, anchor: { ...t.anchor, state } } } }
    }),
  applyArtifactUpdate: ({ sessionId, html }) =>
    set((s) => (sessionId === s.activeSessionId ? { artifactHtml: html } : s)),
  applyPtyExit: ({ sessionId, code, signal }) =>
    set((s) => (sessionId === s.activeSessionId ? { ptyExit: { code, signal } } : s))
}))
