import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from './store'

beforeEach(() => useStore.setState({ transcript: '', activeSessionId: null, tree: [] }))

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
