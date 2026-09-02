import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useStore, STREAMING_MSG_ID } from './store'
import type { Thread } from '../../shared/types'

beforeEach(() =>
  useStore.setState({ transcript: '', activeSessionId: null, tree: [], threads: {} })
)

describe('store renderEvent', () => {
  it('surfaces thinking text in the transcript', () => {
    useStore.getState().appendEvent({ kind: 'thinking', text: 'pondering…' })
    expect(useStore.getState().transcript).toContain('pondering…')
  })
  it('marks a failed tool_result and drops a successful one', () => {
    useStore.getState().appendEvent({ kind: 'tool_result', id: 't1', isError: true })
    expect(useStore.getState().transcript).toContain('[tool failed]')
    useStore.setState({ transcript: '' })
    useStore.getState().appendEvent({ kind: 'tool_result', id: 't2', isError: false })
    expect(useStore.getState().transcript).toBe('')
  })
})

describe('store section-event routing', () => {
  beforeEach(() =>
    useStore.setState({
      activeSessionId: 's1',
      doc: {
        sections: [
          { id: 'summary', type: 'summary', title: 'S', hat: 'h', format: 'md', body: '' },
          { id: 'design', type: 'code', title: 'D', hat: 'h', format: 'md', body: '' }
        ]
      },
      sectionStatus: {}
    })
  )

  it('appends text_delta into the matching section body live', () => {
    const p = { sessionId: 's1', sectionId: 'summary' as const }
    useStore.getState().applySectionEvent({ ...p, event: { kind: 'text_delta', text: 'Hel' } })
    useStore.getState().applySectionEvent({ ...p, event: { kind: 'text_delta', text: 'lo' } })
    const doc = useStore.getState().doc!
    expect(doc.sections.find((s) => s.id === 'summary')!.body).toBe('Hello')
    expect(doc.sections.find((s) => s.id === 'design')!.body).toBe('')
  })

  it('ignores events for a non-active session', () => {
    useStore.getState().applySectionEvent({
      sessionId: 'other',
      sectionId: 'summary',
      event: { kind: 'text_delta', text: 'X' }
    })
    expect(useStore.getState().doc!.sections[0].body).toBe('')
  })

  it('updates sectionStatus on status events for the active session', () => {
    useStore
      .getState()
      .applySectionStatus({ sessionId: 's1', sectionId: 'summary', status: 'generating' })
    expect(useStore.getState().sectionStatus.summary).toBe('generating')
    useStore
      .getState()
      .applySectionStatus({ sessionId: 'other', sectionId: 'design', status: 'ready' })
    expect(useStore.getState().sectionStatus.design).toBeUndefined()
  })
})

describe('store thread routing', () => {
  const thread: Thread = {
    id: 't1',
    sectionId: 'summary',
    kind: 'explain',
    status: 'generating',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    messages: [{ id: 'u1', role: 'user', text: 'explain', ts: '2026-01-01T00:00:00.000Z' }]
  }
  beforeEach(() => useStore.setState({ activeSessionId: 's1', threads: {} }))

  it('inserts a new thread from the creation payload (full thread)', () => {
    useStore
      .getState()
      .applyThreadStatus({ sessionId: 's1', threadId: 't1', status: 'generating', thread })
    expect(useStore.getState().threads.t1.messages).toHaveLength(1)
  })

  it('ignores thread messages for a non-active session', () => {
    useStore
      .getState()
      .applyThreadStatus({ sessionId: 'other', threadId: 't1', status: 'generating', thread })
    expect(useStore.getState().threads.t1).toBeUndefined()
  })

  it('accumulates streaming deltas into one trailing agent message', () => {
    useStore
      .getState()
      .applyThreadStatus({ sessionId: 's1', threadId: 't1', status: 'generating', thread })
    useStore.getState().applyThreadEvent({
      sessionId: 's1',
      threadId: 't1',
      event: { kind: 'text_delta', text: 'Be' }
    })
    useStore.getState().applyThreadEvent({
      sessionId: 's1',
      threadId: 't1',
      event: { kind: 'text_delta', text: 'cause…' }
    })
    const msgs = useStore.getState().threads.t1.messages
    expect(msgs).toHaveLength(2)
    expect(msgs[1]).toMatchObject({ id: STREAMING_MSG_ID, role: 'agent', text: 'Because…' })
  })

  it('updates status without a thread payload (leaves messages intact)', () => {
    useStore
      .getState()
      .applyThreadStatus({ sessionId: 's1', threadId: 't1', status: 'generating', thread })
    useStore.getState().applyThreadStatus({ sessionId: 's1', threadId: 't1', status: 'ready' })
    expect(useStore.getState().threads.t1.status).toBe('ready')
    expect(useStore.getState().threads.t1.messages).toHaveLength(1)
  })
})

describe('store P2 commands scope to the active session', () => {
  beforeEach(() => {
    useStore.setState({ activeSessionId: 's1', doc: { sections: [] }, sectionStatus: {} })
    window.workphlo = {
      refreshSection: vi.fn().mockResolvedValue(undefined),
      refreshAll: vi.fn().mockResolvedValue(undefined),
      askSection: vi.fn().mockResolvedValue(undefined),
      appendSection: vi.fn().mockResolvedValue({
        doc: { sections: [{ id: 'x' }] },
        sectionStatus: { x: 'empty' },
        newSectionId: 'x'
      }),
      splitSection: vi.fn().mockResolvedValue({
        doc: { sections: [{ id: 'y' }] },
        sectionStatus: {},
        newSectionId: 'y'
      })
      // Only the methods these actions touch are needed here.
    } as unknown as typeof window.workphlo
  })

  it('askSection forwards to the IPC surface with the active session id', async () => {
    await useStore.getState().askSection('summary', {
      anchor: null,
      selectedText: 'x',
      intent: 'explain'
    })
    expect(window.workphlo.askSection).toHaveBeenCalledWith('s1', 'summary', {
      anchor: null,
      selectedText: 'x',
      intent: 'explain'
    })
  })

  it('refreshSection / refreshAll forward with the active session id', async () => {
    await useStore.getState().refreshSection('summary')
    await useStore.getState().refreshAll()
    expect(window.workphlo.refreshSection).toHaveBeenCalledWith('s1', 'summary')
    expect(window.workphlo.refreshAll).toHaveBeenCalledWith('s1')
  })

  it('appendSection applies the returned doc + status', async () => {
    await useStore
      .getState()
      .appendSection({ type: 'summary', title: 'T', hat: 'summarizer', format: 'md' })
    expect(useStore.getState().doc).toEqual({ sections: [{ id: 'x' }] })
    expect(useStore.getState().sectionStatus).toEqual({ x: 'empty' })
  })

  it('does nothing without an active session', async () => {
    useStore.setState({ activeSessionId: null })
    await useStore.getState().refreshAll()
    await useStore.getState().askSection('s', { anchor: null, selectedText: '', intent: 'free' })
    expect(window.workphlo.refreshAll).not.toHaveBeenCalled()
    expect(window.workphlo.askSection).not.toHaveBeenCalled()
  })
})

describe('store anchor re-resolution (P2 §11)', () => {
  const threadWith = (quote: string): Thread => ({
    id: 't1',
    sectionId: 'design',
    anchor: {
      sectionId: 'design',
      quote,
      prefix: '',
      suffix: '',
      startHint: 0,
      bodyHash: 'stale',
      state: 'anchored'
    },
    kind: 'free',
    status: 'ready',
    createdAt: 'now',
    updatedAt: 'now',
    messages: []
  })
  beforeEach(() => useStore.setState({ activeSessionId: 's1', threads: {} }))

  it('resolveAnchors flips an anchor to orphaned when the quote is gone', () => {
    useStore.setState({ threads: { t1: threadWith('vanished') } })
    useStore.getState().resolveAnchors('design', 'a body with no such text')
    expect(useStore.getState().threads.t1.anchor?.state).toBe('orphaned')
  })

  it('resolveAnchors keeps anchored when the quote is still present', () => {
    useStore.setState({ threads: { t1: threadWith('present') } })
    useStore.getState().resolveAnchors('design', 'text that is present here')
    expect(useStore.getState().threads.t1.anchor?.state).toBe('anchored')
  })

  it('resolveAnchors leaves threads of other sections untouched', () => {
    const other = { ...threadWith('gone'), id: 't2', sectionId: 'summary' }
    useStore.setState({ threads: { t2: other } })
    useStore.getState().resolveAnchors('design', 'unrelated')
    expect(useStore.getState().threads.t2.anchor?.state).toBe('anchored')
  })

  it('setThreadAnchorState flips a single thread (html iframe round-trip)', () => {
    useStore.setState({ threads: { t1: threadWith('x') } })
    useStore.getState().setThreadAnchorState('t1', 'orphaned')
    expect(useStore.getState().threads.t1.anchor?.state).toBe('orphaned')
  })
})

describe('store loadDoc merge for generating sections (P2 Fix 6)', () => {
  beforeEach(() => {
    useStore.setState({
      activeSessionId: 's1',
      doc: {
        sections: [
          { id: 'a', type: 'summary', title: 'A', hat: 'h', format: 'md', body: 'LIVE partial' },
          { id: 'b', type: 'code', title: 'B', hat: 'h', format: 'md', body: 'old b' }
        ]
      },
      sectionStatus: { a: 'generating', b: 'ready' }
    })
    // On-disk doc lags behind the live stream: 'a' has no body yet on disk.
    window.workphlo = {
      getDocument: vi.fn().mockResolvedValue({
        doc: {
          sections: [
            { id: 'a', type: 'summary', title: 'A', hat: 'h', format: 'md', body: '' },
            { id: 'b', type: 'code', title: 'B', hat: 'h', format: 'md', body: 'new b' }
          ]
        },
        sectionStatus: { a: 'generating', b: 'ready' }
      })
    } as unknown as typeof window.workphlo
  })

  it('keeps the live body for a generating section, takes disk for others', async () => {
    await useStore.getState().loadDoc()
    const doc = useStore.getState().doc!
    // 'a' is generating → keep the live partial body, not the empty disk body.
    expect(doc.sections.find((s) => s.id === 'a')!.body).toBe('LIVE partial')
    // 'b' is not generating → adopt the disk body.
    expect(doc.sections.find((s) => s.id === 'b')!.body).toBe('new b')
  })
})
