import { describe, it, expect } from 'vitest'
import { slugify } from './slug'

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('My First Project')).toBe('my-first-project')
  })
  it('strips punctuation and collapses hyphens', () => {
    expect(slugify('Spec / Design!!  v2')).toBe('spec-design-v2')
  })
  it('falls back to "untitled" when empty', () => {
    expect(slugify('   ')).toBe('untitled')
  })
})
