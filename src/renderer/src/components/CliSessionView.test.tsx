import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
vi.mock('./TerminalPane', () => ({ TerminalPane: () => <div>TERM</div> }))
vi.mock('./ArtifactPane', () => ({ ArtifactPane: () => <div>ART</div> }))
import { CliSessionView } from './CliSessionView'

describe('CliSessionView', () => {
  it('renders both the terminal and artifact panes', () => {
    render(<CliSessionView sessionId="s1" />)
    expect(screen.getByText('TERM')).toBeInTheDocument()
    expect(screen.getByText('ART')).toBeInTheDocument()
  })
})
