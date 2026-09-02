import { describe, it, expect } from 'vitest'
import { resolveContext } from './resolve'
import type { SessionDoc } from '../../shared/types'

const doc: SessionDoc = {
  sections: [
    {
      id: 'requirements',
      type: 'requirements',
      title: 'Requirements',
      hat: 'analyst',
      format: 'html',
      body: '<p>must be fast</p>'
    },
    { id: 'design', type: 'code', title: 'Design', hat: 'architect', format: 'md', body: '' }
  ]
}

describe('resolveContext', () => {
  it('returns an empty string for an undefined or empty recipe', () => {
    expect(resolveContext(undefined, doc, 'goal')).toBe('')
    expect(resolveContext([], doc, 'goal')).toBe('')
  })

  it('resolves the session goal', () => {
    const out = resolveContext(['session.goal'], doc, 'Build a thing')
    expect(out).toContain('Session goal')
    expect(out).toContain('Build a thing')
  })

  it('resolves a section body labeled by title and id', () => {
    const out = resolveContext(['section:requirements'], doc, 'g')
    expect(out).toContain('Requirements')
    expect(out).toContain('(requirements)')
    expect(out).toContain('must be fast')
  })

  it('skips missing and empty sections', () => {
    expect(resolveContext(['section:nope'], doc, 'g')).toBe('')
    expect(resolveContext(['section:design'], doc, 'g')).toBe('')
  })

  it('emits a placeholder note for repo.paths', () => {
    expect(resolveContext(['repo.paths'], doc, 'g')).toContain('Repository')
  })

  it('concatenates multiple tokens in order and ignores unknowns', () => {
    const out = resolveContext(['session.goal', 'section:requirements', 'mystery'], doc, 'The goal')
    expect(out.indexOf('The goal')).toBeLessThan(out.indexOf('must be fast'))
    expect(out).not.toContain('mystery')
  })
})
