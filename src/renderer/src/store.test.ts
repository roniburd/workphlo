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
