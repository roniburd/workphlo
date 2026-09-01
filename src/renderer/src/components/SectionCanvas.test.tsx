import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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
    expect(within(cell).getByText(/generating/i)).toBeInTheDocument()
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
})
