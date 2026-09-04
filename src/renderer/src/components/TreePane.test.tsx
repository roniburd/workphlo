import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { TreePane } from './TreePane'
import { useStore } from '../store'
import type { TreeNode } from '../../../shared/types'

const tree: TreeNode[] = [
  {
    id: 'projects/p',
    type: 'project',
    name: 'P',
    children: [{ id: 'projects/p/sessions/s', type: 'session', name: 'S', children: [] }]
  }
]

beforeEach(() => {
  useStore.setState({ tree: [], activeSessionId: null, transcript: '' })
  window.workphlo = {
    getTree: vi.fn().mockResolvedValue(tree),
    getDocument: vi.fn().mockResolvedValue({ doc: { sections: [] }, sectionStatus: {} }),
    createProject: vi.fn(),
    createSession: vi.fn(),
    runPrompt: vi.fn(),
    generateSection: vi.fn().mockResolvedValue(undefined),
    generateAll: vi.fn().mockResolvedValue(undefined),
    setSectionModel: vi.fn(),
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
    onDocChanged: vi.fn().mockReturnValue(() => {}),
    ptyStart: vi.fn().mockResolvedValue(undefined),
    ptyInput: vi.fn(),
    ptyResize: vi.fn(),
    ptyKill: vi.fn().mockResolvedValue(undefined),
    onPtyData: vi.fn().mockReturnValue(() => {}),
    onPtyExit: vi.fn().mockReturnValue(() => {}),
    onArtifactUpdate: vi.fn().mockReturnValue(() => {})
  }
})

describe('TreePane', () => {
  it('loads and renders projects and sessions', async () => {
    render(<TreePane />)
    await waitFor(() => expect(screen.getByText('P')).toBeInTheDocument())
    expect(screen.getByText('S')).toBeInTheDocument()
  })
  it('selects a session on click', async () => {
    render(<TreePane />)
    await waitFor(() => screen.getByText('S'))
    fireEvent.click(screen.getByText('S'))
    expect(useStore.getState().activeSessionId).toBe('projects/p/sessions/s')
  })
  it('creates a project via the inline + Project input', async () => {
    render(<TreePane />)
    fireEvent.click(screen.getByRole('button', { name: /\+ project/i }))
    const input = screen.getByPlaceholderText('Project name')
    fireEvent.change(input, { target: { value: 'New Proj' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(window.workphlo.createProject).toHaveBeenCalledWith('New Proj'))
  })
  it('creates a session on a project via the inline + Session input', async () => {
    render(<TreePane />)
    await waitFor(() => screen.getByText('P'))
    fireEvent.click(screen.getByRole('button', { name: /add session to p/i }))
    const input = screen.getByPlaceholderText('Session name')
    fireEvent.change(input, { target: { value: 'New Sess' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() =>
      expect(window.workphlo.createSession).toHaveBeenCalledWith('projects/p', 'New Sess')
    )
  })
  it('does not create a project when the inline input is empty or cancelled', async () => {
    render(<TreePane />)
    fireEvent.click(screen.getByRole('button', { name: /\+ project/i }))
    const input = screen.getByPlaceholderText('Project name')
    // Empty Enter is a no-op — nothing created AND the input stays open.
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(window.workphlo.createProject).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText('Project name')).toBeInTheDocument()
    // Escape actually dismisses the input (finding: assert dismissal, not just
    // that createProject wasn't called).
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByPlaceholderText('Project name')).not.toBeInTheDocument()
    expect(window.workphlo.createProject).not.toHaveBeenCalled()
  })
  it('cancels the project input on blur only when it is empty', async () => {
    render(<TreePane />)
    fireEvent.click(screen.getByRole('button', { name: /\+ project/i }))
    // Empty blur (e.g. clicking elsewhere) tidies the input away.
    fireEvent.blur(screen.getByPlaceholderText('Project name'))
    expect(screen.queryByPlaceholderText('Project name')).not.toBeInTheDocument()
    expect(window.workphlo.createProject).not.toHaveBeenCalled()

    // Re-open, type, then blur: typed text must NOT be silently discarded.
    fireEvent.click(screen.getByRole('button', { name: /\+ project/i }))
    const input = screen.getByPlaceholderText('Project name')
    fireEvent.change(input, { target: { value: 'Keep me' } })
    fireEvent.blur(input)
    expect(screen.getByPlaceholderText('Project name')).toBeInTheDocument()
    expect(window.workphlo.createProject).not.toHaveBeenCalled()
  })
  it('cancels the session input on blur when empty and never creates on blur', async () => {
    render(<TreePane />)
    await waitFor(() => screen.getByText('P'))
    fireEvent.click(screen.getByRole('button', { name: /add session to p/i }))
    fireEvent.blur(screen.getByPlaceholderText('Session name'))
    expect(screen.queryByPlaceholderText('Session name')).not.toBeInTheDocument()
    expect(window.workphlo.createSession).not.toHaveBeenCalled()
  })
  it('submits the project via the ✓ confirm button', async () => {
    render(<TreePane />)
    fireEvent.click(screen.getByRole('button', { name: /\+ project/i }))
    fireEvent.change(screen.getByPlaceholderText('Project name'), {
      target: { value: 'Via Button' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(window.workphlo.createProject).toHaveBeenCalledWith('Via Button'))
  })
})
