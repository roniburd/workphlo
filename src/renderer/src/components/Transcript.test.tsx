import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { Transcript } from './Transcript'
import { useStore } from '../store'

beforeEach(() => useStore.setState({ transcript: '', activeSessionId: null, tree: [] }))

describe('Transcript', () => {
  it('renders the store transcript and updates on appendEvent', () => {
    render(<Transcript />)
    act(() => useStore.getState().appendEvent({ kind: 'text_delta', text: 'Hello world' }))
    expect(screen.getByText(/Hello world/)).toBeInTheDocument()
  })
})
