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
    onSectionStatus: vi.fn().mockReturnValue(() => {})
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
  it('creates a project via the + Project button', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('New Proj')
    render(<TreePane />)
    fireEvent.click(screen.getByRole('button', { name: /\+ project/i }))
    await waitFor(() => expect(window.workphlo.createProject).toHaveBeenCalledWith('New Proj'))
  })
  it('creates a session on a project via the + Session button', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('New Sess')
    render(<TreePane />)
    await waitFor(() => screen.getByText('P'))
    fireEvent.click(screen.getByRole('button', { name: /add session to p/i }))
    await waitFor(() =>
      expect(window.workphlo.createSession).toHaveBeenCalledWith('projects/p', 'New Sess')
    )
  })
  it('does not create a project when the prompt is cancelled', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null)
    render(<TreePane />)
    fireEvent.click(screen.getByRole('button', { name: /\+ project/i }))
    expect(window.workphlo.createProject).not.toHaveBeenCalled()
  })
})
