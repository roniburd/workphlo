import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useStore } from '../store'
import { ArtifactPane } from './ArtifactPane'

beforeEach(() => useStore.setState({ artifactHtml: '' }))

describe('ArtifactPane', () => {
  it('shows an empty state before the first artifact write', () => {
    render(<ArtifactPane />)
    expect(screen.getByText(/no result yet/i)).toBeInTheDocument()
  })

  it('renders the sandboxed iframe once html arrives', () => {
    useStore.setState({ artifactHtml: '<article>done</article>' })
    render(<ArtifactPane />)
    expect(screen.getByTitle('section-html')).toBeInTheDocument()
  })
})
