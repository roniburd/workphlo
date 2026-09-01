import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkspace, createProject, createSession, loadTree } from './workspace'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wf-'))
})

describe('workspace file model', () => {
  it('creates the base layout with a manifest', async () => {
    await createWorkspace(root)
    expect((await stat(join(root, 'projects'))).isDirectory()).toBe(true)
    expect((await stat(join(root, 'templates'))).isDirectory()).toBe(true)
    expect((await stat(join(root, 'hats'))).isDirectory()).toBe(true)
    const manifest = JSON.parse(await readFile(join(root, 'workphlo.json'), 'utf8'))
    expect(manifest.version).toBe(1)
  })

  it('creates a project folder + project.json', async () => {
    await createWorkspace(root)
    const p = await createProject(root, 'My First Project')
    expect(p.id).toBe('projects/my-first-project')
    const meta = JSON.parse(await readFile(join(root, p.id, 'project.json'), 'utf8'))
    expect(meta.name).toBe('My First Project')
  })

  it('creates a nested session with a stub document.md', async () => {
    await createWorkspace(root)
    const p = await createProject(root, 'Proj')
    const s = await createSession(root, p.id, 'Spec Round 1', 'spec-design', 'cli')
    expect(s.id).toBe('projects/proj/sessions/spec-round-1')
    expect((await stat(join(root, s.id, 'document.md'))).isFile()).toBe(true)
    expect((await stat(join(root, s.id, 'artifacts'))).isDirectory()).toBe(true)
  })

  it('loads a nested tree', async () => {
    await createWorkspace(root)
    const p = await createProject(root, 'Proj')
    await createSession(root, p.id, 'S1', 'spec-design', 'cli')
    const tree = await loadTree(root)
    expect(tree).toHaveLength(1)
    expect(tree[0].type).toBe('project')
    expect(tree[0].children[0].type).toBe('session')
    expect(tree[0].children[0].name).toBe('S1')
  })
})
