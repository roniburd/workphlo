import { describe, it, expect } from 'vitest'
import { builtinHats, getHat } from './hats'

describe('built-in hats', () => {
  it('seeds the spec §5 roles', () => {
    const ids = builtinHats().map((h) => h.id)
    for (const id of [
      'summarizer',
      'analyst',
      'architect',
      'reviewer',
      'perf-analyst',
      'security',
      'differ'
    ]) {
      expect(ids).toContain(id)
    }
  })

  it('gives every hat a concrete system prompt and a valid engine', () => {
    for (const h of builtinHats()) {
      expect(h.systemPrompt.length).toBeGreaterThan(20)
      // Don't lock in engine === 'cli' for ALL hats: spec §5 puts the summarizer
      // on SDK, and P1 only defers that (see hats.ts). Assert a valid engine so
      // the invariant doesn't break if a hat later moves to sdk.
      expect(['cli', 'sdk']).toContain(h.engine)
      expect(h.name.length).toBeGreaterThan(0)
    }
  })

  it('scopes analysis roles to read-only tools', () => {
    for (const id of [
      'summarizer',
      'analyst',
      'architect',
      'reviewer',
      'perf-analyst',
      'security'
    ]) {
      expect(getHat(id)?.allowedTools).toEqual(['Read', 'Grep'])
    }
  })

  it('looks up a hat by id', () => {
    expect(getHat('summarizer')?.name).toBe('Summarizer')
  })

  it('returns null for an unknown hat id', () => {
    expect(getHat('nope')).toBeNull()
  })
})
