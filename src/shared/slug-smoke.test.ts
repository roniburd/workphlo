import { describe, it, expect } from 'vitest'
import { echo } from './slug-smoke'

describe('test harness', () => {
  it('runs a pure module test', () => {
    expect(echo('workphlo')).toBe('workphlo')
  })
})
