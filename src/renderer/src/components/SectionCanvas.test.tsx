import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
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
    onSectionStatus: vi.fn().mockReturnValue(() => {})
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
