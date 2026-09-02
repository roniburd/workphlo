import { describe, it, expect } from 'vitest'
import { buildAnchor, resolveAnchor, hashText } from './anchor'

describe('anchor build/resolve', () => {
  const text = 'The quick brown fox jumps over the lazy dog.'

  it('captures quote + surrounding context + hash', () => {
    const a = buildAnchor('sec', text, 4, 9) // "quick"
    expect(a.quote).toBe('quick')
    expect(a.prefix).toBe('The ')
    expect(a.suffix).toBe(' brown fox jumps over the lazy d')
    expect(a.startHint).toBe(4)
    expect(a.bodyHash).toBe(hashText(text))
    expect(a.state).toBe('anchored')
  })

  it('exact-hash fast path trusts the stored startHint', () => {
    const a = buildAnchor('sec', text, 4, 9)
    const r = resolveAnchor(a, text)
    expect(r).toEqual({ start: 4, end: 9, state: 'anchored' })
  })

  it('re-locates a unique quote after unrelated edits', () => {
    const a = buildAnchor('sec', text, 4, 9) // "quick"
    const edited = 'PREFIX. ' + text // shifts offsets, hash changes
    const r = resolveAnchor(a, edited)
    expect(edited.slice(r.start, r.end)).toBe('quick')
    expect(r.state).toBe('anchored')
  })

  it('disambiguates duplicate quotes via prefix/suffix', () => {
    const dup = 'alpha TARGET one ... beta TARGET two'
    const start = dup.indexOf('TARGET', dup.indexOf('beta'))
    const a = buildAnchor('sec', dup, start, start + 'TARGET'.length)
    // Re-resolve against the SAME text but force the slow path by mutating hash.
    const a2 = { ...a, bodyHash: 'deadbeef' }
    const r = resolveAnchor(a2, dup)
    expect(r.start).toBe(start) // picked the second (beta) occurrence, not the first
    expect(r.state).toBe('anchored')
  })

  it('orphans when the quote is gone', () => {
    const a = buildAnchor('sec', text, 4, 9)
    const r = resolveAnchor(a, 'completely different content')
    expect(r.state).toBe('orphaned')
    expect(r.start).toBe(-1)
  })
})
