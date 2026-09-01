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
    createProject: vi.fn(),
    createSession: vi.fn(),
    runPrompt: vi.fn(),
    onEngineEvent: vi.fn().mockReturnValue(() => {})
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
})
