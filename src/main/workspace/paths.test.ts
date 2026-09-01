import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { abs, projectsDir, manifestPath } from './paths'

describe('abs path containment', () => {
  const root = '/ws'

  it('resolves a normal workspace-relative id under root', () => {
    expect(abs(root, 'projects/p/sessions/s')).toBe(resolve(root, 'projects/p/sessions/s'))
  })

  it('allows the root itself', () => {
    expect(abs(root, '')).toBe(resolve(root))
    expect(abs(root, '.')).toBe(resolve(root))
  })

  it('rejects ids that escape the workspace root', () => {
    expect(() => abs(root, '../../etc/passwd')).toThrow(/escapes workspace root/)
    expect(() => abs(root, 'projects/../../secret')).toThrow(/escapes workspace root/)
  })

  it('rejects a sibling-prefix path that is not actually inside root', () => {
    // `/ws-evil` shares the `/ws` prefix but is not under `/ws/`
    expect(() => abs(root, '../ws-evil')).toThrow(/escapes workspace root/)
  })
})

describe('other path helpers', () => {
  it('derives projectsDir and manifestPath under root', () => {
    expect(projectsDir('/ws')).toBe(resolve('/ws/projects'))
    expect(manifestPath('/ws')).toBe(resolve('/ws/workphlo.json'))
  })
})
