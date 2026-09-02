import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PromptBar } from './PromptBar'
import { useStore } from '../store'

beforeEach(() => {
  useStore.setState({ transcript: '', activeSessionId: 'projects/p/sessions/s', tree: [] })
  window.workphlo = {
    getTree: vi.fn(),
    getDocument: vi.fn().mockResolvedValue({ doc: { sections: [] }, sectionStatus: {} }),
    createProject: vi.fn(),
    createSession: vi.fn(),
    runPrompt: vi.fn().mockResolvedValue(undefined),
    generateSection: vi.fn().mockResolvedValue(undefined),
    generateAll: vi.fn().mockResolvedValue(undefined),
    setSectionModel: vi.fn(),
    interrupt: vi.fn().mockResolvedValue(undefined),
    onEngineEvent: vi.fn().mockReturnValue(() => {}),
    onSectionEvent: vi.fn().mockReturnValue(() => {}),
    onSectionStatus: vi.fn().mockReturnValue(() => {})
  }
})

describe('PromptBar', () => {
  it('sends the typed prompt for the active session', () => {
    render(<PromptBar />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'do it' } })
    fireEvent.click(screen.getByRole('button', { name: /send/i }))
    expect(window.workphlo.runPrompt).toHaveBeenCalledWith('projects/p/sessions/s', 'do it')
  })
  it('does nothing without an active session', () => {
    useStore.setState({ activeSessionId: null })
    render(<PromptBar />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: /send/i }))
    expect(window.workphlo.runPrompt).not.toHaveBeenCalled()
  })
})
