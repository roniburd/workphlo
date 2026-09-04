import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'

const writes: string[] = []
const onDataCbs: Array<(d: string) => void> = []
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    write(d: string) { writes.push(d) }
    onData(cb: (d: string) => void) { onDataCbs.push(cb) }
    onResize() {}
    open() {}
    loadAddon() {}
    dispose() {}
  }
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} activate() {} dispose() {} } }))

const ptyStart = vi.fn(async () => {})
let dataListener: ((p: { sessionId: string; data: string }) => void) | null = null
beforeEach(() => {
  writes.length = 0
  onDataCbs.length = 0
  ;(globalThis as any).window.workphlo = {
    ptyStart,
    ptyInput: vi.fn(),
    ptyResize: vi.fn(),
    onPtyData: (cb: any) => { dataListener = cb; return () => {} },
    onPtyExit: () => () => {}
  }
})

import { TerminalPane } from './TerminalPane'

describe('TerminalPane', () => {
  it('starts the pty on mount and writes inbound data to the terminal', () => {
    render(<TerminalPane sessionId="s1" />)
    expect(ptyStart).toHaveBeenCalledWith('s1', 80, 24)
    dataListener!({ sessionId: 's1', data: 'hi' })
    expect(writes).toContain('hi')
  })

  it('shows an error banner when the pty fails to start', async () => {
    ;(globalThis as any).window.workphlo.ptyStart = vi.fn(async () => {
      throw new Error('nope')
    })
    const { findByText } = render(<TerminalPane sessionId="s1" />)
    expect(await findByText(/could not start cli session: nope/i)).toBeInTheDocument()
  })

  it('clears a stale start-error banner when switching to a healthy session', async () => {
    ;(globalThis as any).window.workphlo.ptyStart = vi.fn(async (id: string) => {
      if (id === 's1') throw new Error('nope')
    })
    const { rerender, findByText, queryByText } = render(<TerminalPane sessionId="s1" />)
    expect(await findByText(/could not start cli session: nope/i)).toBeInTheDocument()
    rerender(<TerminalPane sessionId="s2" />)
    await waitFor(() =>
      expect(queryByText(/could not start cli session/i)).not.toBeInTheDocument()
    )
  })
})
