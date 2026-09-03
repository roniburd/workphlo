import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import { SectionCanvas } from './SectionCanvas'
import { useStore } from '../store'
import type { SessionDoc } from '../../../shared/types'

const doc: SessionDoc = {
  sections: [
    {
      id: 'summary',
      type: 'summary',
      title: 'Summary',
      hat: 'summarizer',
      format: 'html',
      body: '<p>All good</p>'
    },
    {
      id: 'design',
      type: 'code',
      title: 'Design',
      hat: 'architect',
      format: 'md',
      body: 'const x = 1'
    },
    {
      id: 'delta',
      type: 'diff',
      title: 'Changes',
      hat: 'differ',
      format: 'md',
      body: '--- a\n+++ b\n-old line\n+new line\n unchanged'
    },
    {
      id: 'open-qs',
      type: 'open-qs',
      title: 'Open Questions',
      hat: 'architect',
      format: 'md',
      body: ''
    }
  ]
}

beforeEach(() => {
  window.workphlo = {
    getTree: vi.fn(),
    getDocument: vi.fn().mockResolvedValue({ doc: { sections: [] }, sectionStatus: {} }),
    createProject: vi.fn(),
    createSession: vi.fn(),
    runPrompt: vi.fn(),
    generateSection: vi.fn().mockResolvedValue(undefined),
    generateAll: vi.fn().mockResolvedValue(undefined),
    setSectionModel: vi.fn().mockResolvedValue({}),
    interrupt: vi.fn().mockResolvedValue(undefined),
    onEngineEvent: vi.fn().mockReturnValue(() => {}),
    onSectionEvent: vi.fn().mockReturnValue(() => {}),
    onSectionStatus: vi.fn().mockReturnValue(() => {}),
    refreshSection: vi.fn().mockResolvedValue(undefined),
    refreshAll: vi.fn().mockResolvedValue(undefined),
    askSection: vi.fn().mockResolvedValue(undefined),
    appendSection: vi.fn(),
    splitSection: vi.fn(),
    onThreadEvent: vi.fn().mockReturnValue(() => {}),
    onThreadStatus: vi.fn().mockReturnValue(() => {}),
    onDocChanged: vi.fn().mockReturnValue(() => {})
  }
  useStore.setState({
    tree: [],
    activeSessionId: 'projects/p/sessions/s',
    transcript: '',
    doc,
    sectionStatus: { summary: 'ready', design: 'generating', delta: 'ready', 'open-qs': 'empty' }
  })
})

describe('SectionCanvas', () => {
  it('renders a titled cell per section', () => {
    render(<SectionCanvas />)
    expect(screen.getByText('Summary')).toBeInTheDocument()
    expect(screen.getByText('Design')).toBeInTheDocument()
    expect(screen.getByText('Changes')).toBeInTheDocument()
    expect(screen.getByText('Open Questions')).toBeInTheDocument()
  })

  it('renders a code section body in a code block', () => {
    render(<SectionCanvas />)
    const cell = screen.getByTestId('section-design')
    expect(within(cell).getByText('const x = 1')).toBeInTheDocument()
    expect(cell.querySelector('pre')).not.toBeNull()
  })

  it('renders diff added/removed lines with distinct roles', () => {
    render(<SectionCanvas />)
    const cell = screen.getByTestId('section-delta')
    expect(within(cell).getByText('+new line')).toBeInTheDocument()
    expect(within(cell).getByText('-old line')).toBeInTheDocument()
    expect(cell.querySelectorAll('[data-diff="add"]').length).toBe(1)
    expect(cell.querySelectorAll('[data-diff="del"]').length).toBe(1)
  })

  it('shows a per-section status badge', () => {
    render(<SectionCanvas />)
    const cell = screen.getByTestId('section-design')
    // Exact match hits only the status badge, not the "Generating…" button label.
    expect(within(cell).getByText('generating')).toBeInTheDocument()
  })

  it('shows a placeholder for an empty section body', () => {
    render(<SectionCanvas />)
    const cell = screen.getByTestId('section-open-qs')
    expect(within(cell).getByText(/not generated yet/i)).toBeInTheDocument()
  })

  it('renders nothing but a hint when no session is active', () => {
    useStore.setState({ activeSessionId: null, doc: null })
    render(<SectionCanvas />)
    expect(screen.getByText(/select a session/i)).toBeInTheDocument()
  })

  it('shows Generate for an empty section and Refresh for a filled one', () => {
    render(<SectionCanvas />)
    const empty = screen.getByTestId('section-open-qs')
    expect(within(empty).getByRole('button', { name: /generate/i })).toBeInTheDocument()
    const filled = screen.getByTestId('section-summary')
    expect(within(filled).getByRole('button', { name: /refresh/i })).toBeInTheDocument()
  })

  it('generate button calls the store action for that section', () => {
    // Nothing generating, so per-section buttons are enabled.
    useStore.setState({
      sectionStatus: { summary: 'ready', design: 'ready', delta: 'ready', 'open-qs': 'empty' }
    })
    render(<SectionCanvas />)
    const cell = screen.getByTestId('section-open-qs')
    fireEvent.click(within(cell).getByRole('button', { name: /generate/i }))
    expect(window.workphlo.generateSection).toHaveBeenCalledWith('projects/p/sessions/s', 'open-qs')
  })

  it('disables the generate button while a section is generating', () => {
    render(<SectionCanvas />)
    const cell = screen.getByTestId('section-design')
    expect(within(cell).getByRole('button', { name: /generating/i })).toBeDisabled()
  })

  it('disables ALL per-section generate buttons while any section is generating', () => {
    // design is 'generating' in the default state, so every other section's
    // Generate/Refresh button must also be disabled (prevents run collisions).
    render(<SectionCanvas />)
    for (const id of ['summary', 'delta', 'open-qs']) {
      const cell = screen.getByTestId(`section-${id}`)
      expect(within(cell).getByRole('button', { name: /generate|refresh/i })).toBeDisabled()
    }
  })

  it('model select calls setSectionModel for that section', () => {
    render(<SectionCanvas />)
    const cell = screen.getByTestId('section-summary')
    fireEvent.change(within(cell).getByRole('combobox'), { target: { value: 'claude-opus-5' } })
    expect(window.workphlo.setSectionModel).toHaveBeenCalledWith(
      'projects/p/sessions/s',
      'summary',
      'claude-opus-5'
    )
  })

  it('Generate all header button triggers generateAll', () => {
    // No section generating, so the header button is enabled.
    useStore.setState({ sectionStatus: { summary: 'ready', design: 'ready' } })
    render(<SectionCanvas />)
    fireEvent.click(screen.getByRole('button', { name: /generate all/i }))
    expect(window.workphlo.generateAll).toHaveBeenCalledWith('projects/p/sessions/s')
  })
})

describe('SectionCanvas P2 — stale / refresh / append', () => {
  it('shows the stale badge and refreshes that section on click', () => {
    useStore.setState({
      sectionStatus: { summary: 'stale', design: 'ready', delta: 'ready', 'open-qs': 'ready' }
    })
    render(<SectionCanvas />)
    const cell = screen.getByTestId('section-summary')
    expect(within(cell).getByText('stale')).toBeInTheDocument()
    fireEvent.click(within(cell).getByRole('button', { name: /refresh/i }))
    expect(window.workphlo.refreshSection).toHaveBeenCalledWith('projects/p/sessions/s', 'summary')
  })

  it('enables "Refresh stale" only when a section is stale and wires refreshAll', () => {
    useStore.setState({ sectionStatus: { summary: 'ready', design: 'ready' } })
    const { rerender } = render(<SectionCanvas />)
    expect(screen.getByRole('button', { name: /refresh stale/i })).toBeDisabled()
    useStore.setState({ sectionStatus: { summary: 'stale', design: 'ready' } })
    rerender(<SectionCanvas />)
    const btn = screen.getByRole('button', { name: /refresh stale/i })
    expect(btn).not.toBeDisabled()
    fireEvent.click(btn)
    expect(window.workphlo.refreshAll).toHaveBeenCalledWith('projects/p/sessions/s')
  })

  it('appends a new section via the + Add section control', async () => {
    ;(window.workphlo.appendSection as ReturnType<typeof vi.fn>).mockResolvedValue({
      doc,
      sectionStatus: {},
      newSectionId: 'summary-2'
    })
    useStore.setState({ sectionStatus: { summary: 'ready' } })
    render(<SectionCanvas />)
    fireEvent.click(screen.getByRole('button', { name: /add section/i }))
    const input = screen.getByLabelText('New section title')
    fireEvent.change(input, { target: { value: 'Notes' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(window.workphlo.appendSection).toHaveBeenCalledWith('projects/p/sessions/s', {
      type: 'summary',
      title: 'Notes',
      hat: 'summarizer',
      format: 'md',
      body: ''
    })
  })

  it('does not append on empty Enter, and Escape dismisses the input', () => {
    useStore.setState({ sectionStatus: { summary: 'ready' } })
    render(<SectionCanvas />)
    fireEvent.click(screen.getByRole('button', { name: /add section/i }))
    const input = screen.getByLabelText('New section title')
    // Empty Enter is a no-op; the input stays open.
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(window.workphlo.appendSection).not.toHaveBeenCalled()
    expect(screen.getByLabelText('New section title')).toBeInTheDocument()
    // Escape dismisses it without appending.
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByLabelText('New section title')).not.toBeInTheDocument()
    expect(window.workphlo.appendSection).not.toHaveBeenCalled()
  })

  it('cancels the add-section input on blur only when empty', () => {
    useStore.setState({ sectionStatus: { summary: 'ready' } })
    render(<SectionCanvas />)
    fireEvent.click(screen.getByRole('button', { name: /add section/i }))
    // Empty blur tidies the input away.
    fireEvent.blur(screen.getByLabelText('New section title'))
    expect(screen.queryByLabelText('New section title')).not.toBeInTheDocument()
    expect(window.workphlo.appendSection).not.toHaveBeenCalled()
    // Typed text survives a blur (not silently discarded).
    fireEvent.click(screen.getByRole('button', { name: /add section/i }))
    const input = screen.getByLabelText('New section title')
    fireEvent.change(input, { target: { value: 'Keep' } })
    fireEvent.blur(input)
    expect(screen.getByLabelText('New section title')).toBeInTheDocument()
    expect(window.workphlo.appendSection).not.toHaveBeenCalled()
  })

  it('appends via the ✓ confirm button', async () => {
    ;(window.workphlo.appendSection as ReturnType<typeof vi.fn>).mockResolvedValue({
      doc,
      sectionStatus: {},
      newSectionId: 'summary-2'
    })
    useStore.setState({ sectionStatus: { summary: 'ready' } })
    render(<SectionCanvas />)
    fireEvent.click(screen.getByRole('button', { name: /add section/i }))
    fireEvent.change(screen.getByLabelText('New section title'), { target: { value: 'Notes' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() =>
      expect(window.workphlo.appendSection).toHaveBeenCalledWith(
        'projects/p/sessions/s',
        expect.objectContaining({ title: 'Notes' })
      )
    )
  })

  it('hides the add-section input and disables the trigger while a run is in flight', () => {
    // Open the input with nothing generating...
    useStore.setState({ sectionStatus: { summary: 'ready', design: 'ready' } })
    const { rerender } = render(<SectionCanvas />)
    fireEvent.click(screen.getByRole('button', { name: /add section/i }))
    expect(screen.getByLabelText('New section title')).toBeInTheDocument()
    // ...then a section starts generating: the input must unmount (so a late
    // Enter can't append mid-run) and the + Add section trigger must disable.
    useStore.setState({ sectionStatus: { summary: 'ready', design: 'generating' } })
    rerender(<SectionCanvas />)
    expect(screen.queryByLabelText('New section title')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add section/i })).toBeDisabled()
    expect(window.workphlo.appendSection).not.toHaveBeenCalled()
  })
})

describe('SectionCanvas P2 — threads', () => {
  it('renders a section-scoped thread with its quote and agent answer', () => {
    useStore.setState({
      sectionStatus: { summary: 'ready' },
      threads: {
        t1: {
          id: 't1',
          sectionId: 'summary',
          kind: 'explain',
          status: 'ready',
          createdAt: 'x',
          updatedAt: 'x',
          anchor: {
            sectionId: 'summary',
            quote: 'All good',
            prefix: '',
            suffix: '',
            startHint: 0,
            bodyHash: 'h',
            state: 'orphaned'
          },
          messages: [
            { id: 'u', role: 'user', text: 'explain', ts: 'x' },
            { id: 'a', role: 'agent', text: 'Because it is fine.', ts: 'x' }
          ]
        }
      }
    })
    render(<SectionCanvas />)
    const cell = screen.getByTestId('section-summary')
    expect(within(cell).getByText('Because it is fine.')).toBeInTheDocument()
    expect(within(cell).getByText(/all good/i)).toBeInTheDocument()
    // Orphaned anchor is badged, never silently dropped.
    expect(within(cell).getByText(/anchor lost/i)).toBeInTheDocument()
  })
})

describe('SectionCanvas P2 — ask menu (selection)', () => {
  const fakeSelection = (quote: string): Selection =>
    ({
      isCollapsed: false,
      rangeCount: 1,
      toString: () => quote,
      getRangeAt: () => ({
        cloneRange: () => ({
          selectNodeContents: () => {},
          setEnd: () => {},
          toString: () => ''
        }),
        getBoundingClientRect: () => ({
          top: 0,
          left: 5,
          bottom: 10,
          right: 0,
          width: 0,
          height: 0
        })
      })
    }) as unknown as Selection

  it('md/code selection opens the ask menu and Explain calls askSection with the anchor', () => {
    useStore.setState({ sectionStatus: { summary: 'ready', design: 'ready' } })
    vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('const'))
    render(<SectionCanvas />)
    const cell = screen.getByTestId('section-design')
    fireEvent.mouseUp(within(cell).getByText('const x = 1'))
    const menu = screen.getByRole('menu', { name: /ask about selection/i })
    fireEvent.click(within(menu).getByRole('button', { name: /explain/i }))
    expect(window.workphlo.askSection).toHaveBeenCalledWith(
      'projects/p/sessions/s',
      'design',
      expect.objectContaining({
        intent: 'explain',
        selectedText: 'const',
        anchor: expect.objectContaining({ sectionId: 'design', quote: 'const', startHint: 0 })
      })
    )
  })

  it('free-text ask submits intent "free" with the typed note', () => {
    useStore.setState({ sectionStatus: { design: 'ready' } })
    vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('const'))
    render(<SectionCanvas />)
    const cell = screen.getByTestId('section-design')
    fireEvent.mouseUp(within(cell).getByText('const x = 1'))
    const menu = screen.getByRole('menu', { name: /ask about selection/i })
    fireEvent.change(within(menu).getByRole('textbox'), { target: { value: 'why const?' } })
    fireEvent.click(within(menu).getByRole('button', { name: /^ask$/i }))
    expect(window.workphlo.askSection).toHaveBeenCalledWith(
      'projects/p/sessions/s',
      'design',
      expect.objectContaining({ intent: 'free', freeText: 'why const?' })
    )
  })

  it('Split here calls splitSection at the selection offset', () => {
    ;(window.workphlo.splitSection as ReturnType<typeof vi.fn>).mockResolvedValue({
      doc,
      sectionStatus: {},
      newSectionId: 'design-2'
    })
    useStore.setState({ sectionStatus: { design: 'ready' } })
    vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('x = 1'))
    render(<SectionCanvas />)
    const cell = screen.getByTestId('section-design')
    fireEvent.mouseUp(within(cell).getByText('const x = 1'))
    const menu = screen.getByRole('menu', { name: /ask about selection/i })
    fireEvent.click(within(menu).getByRole('button', { name: /split here/i }))
    expect(window.workphlo.splitSection).toHaveBeenCalledWith(
      'projects/p/sessions/s',
      'design',
      6,
      undefined
    )
  })

  it('ignores postMessage selections whose source is not this section iframe', () => {
    useStore.setState({ sectionStatus: { summary: 'ready' } })
    render(<SectionCanvas />)
    // Spoofed source (window, not the iframe) → no menu.
    const evt = new MessageEvent('message', {
      data: { type: 'wf:selection', sectionId: 'summary', quote: 'All good', startHint: 0 }
    })
    Object.defineProperty(evt, 'source', { value: window })
    window.dispatchEvent(evt)
    expect(screen.queryByRole('menu', { name: /ask about selection/i })).not.toBeInTheDocument()
  })
})
