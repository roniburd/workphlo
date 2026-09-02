import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, readFile, stat, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createWorkspace,
  createProject,
  createSession,
  loadTree,
  loadDocument,
  loadSessionMeta,
  writeDocument,
  setSectionStatus,
  setSectionModel,
  resolveModel,
  loadWorkspaceConfig,
  appendTranscript
} from './workspace'
import type { Hat } from '../../shared/types'

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
    // Workspace-level defaults (spec §2.2 final fallback tier) are persisted.
    // defaultModel is undefined and thus dropped by JSON.stringify; the loader
    // re-supplies it (covered below).
    expect(manifest.defaultEngine).toBe('cli')
  })

  it('loads the workspace config with defaults', async () => {
    await createWorkspace(root)
    const cfg = await loadWorkspaceConfig(root)
    expect(cfg.version).toBe(1)
    expect(cfg.defaultEngine).toBe('cli')
    expect(cfg.defaultModel).toBeUndefined()
  })

  it('creates a project folder + project.json', async () => {
    await createWorkspace(root)
    const p = await createProject(root, 'My First Project')
    expect(p.id).toBe('projects/my-first-project')
    const meta = JSON.parse(await readFile(join(root, p.id, 'project.json'), 'utf8'))
    expect(meta.name).toBe('My First Project')
  })

  it('creates a nested session with a template-seeded document.md', async () => {
    await createWorkspace(root)
    const p = await createProject(root, 'Proj')
    const s = await createSession(root, p.id, 'Spec Round 1', 'spec-design', 'cli')
    expect(s.id).toBe('projects/proj/sessions/spec-round-1')
    expect((await stat(join(root, s.id, 'document.md'))).isFile()).toBe(true)
    expect((await stat(join(root, s.id, 'artifacts'))).isDirectory()).toBe(true)
    // document.md is scaffolded from the template's sections.
    const doc = await loadDocument(root, s.id)
    expect(doc.sections.map((x) => x.id)).toEqual(['summary', 'requirements', 'design', 'open-qs'])
    // session.json tracks a per-section status, all empty initially.
    const meta = JSON.parse(await readFile(join(root, s.id, 'session.json'), 'utf8'))
    expect(meta.sectionStatus).toEqual({
      summary: 'empty',
      requirements: 'empty',
      design: 'empty',
      'open-qs': 'empty'
    })
  })

  it('seeds an empty document for an unknown template id', async () => {
    await createWorkspace(root)
    const p = await createProject(root, 'Proj')
    const s = await createSession(root, p.id, 'Freeform', 'nope', 'cli')
    const doc = await loadDocument(root, s.id)
    expect(doc.sections).toEqual([])
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

describe('workspace section writers', () => {
  async function seed(): Promise<string> {
    await createWorkspace(root)
    const p = await createProject(root, 'Proj')
    const s = await createSession(root, p.id, 'S', 'spec-design', 'cli')
    return s.id
  }

  it('writes document.md atomically and reads it back', async () => {
    const id = await seed()
    const doc = await loadDocument(root, id)
    doc.sections[0].body = '<p>filled</p>'
    await writeDocument(root, id, doc)
    // no leftover temp files in the session dir
    const dir = join(root, id)
    expect((await readFile(join(dir, 'document.md'), 'utf8')).includes('<p>filled</p>')).toBe(true)
    const leftovers = (await readdir(dir)).filter((f) => f.endsWith('.tmp'))
    expect(leftovers).toEqual([])
    const reparsed = await loadDocument(root, id)
    expect(reparsed.sections[0].body).toBe('<p>filled</p>')
  })

  it('updates a section status in session.json', async () => {
    const id = await seed()
    const meta = await setSectionStatus(root, id, 'summary', 'generating')
    expect(meta.sectionStatus?.summary).toBe('generating')
    const persisted = await loadSessionMeta(root, id)
    expect(persisted?.sectionStatus?.summary).toBe('generating')
    expect(persisted?.sectionStatus?.requirements).toBe('empty') // others untouched
  })

  it('sets and clears a per-section model override', async () => {
    const id = await seed()
    await setSectionModel(root, id, 'summary', 'haiku')
    expect((await loadSessionMeta(root, id))?.sectionOverrides?.summary?.model).toBe('haiku')
    await setSectionModel(root, id, 'summary', undefined)
    expect((await loadSessionMeta(root, id))?.sectionOverrides?.summary).toBeUndefined()
  })

  it('resolves model with override → hat default → undefined', async () => {
    const id = await seed()
    const hat: Hat = {
      id: 'summarizer',
      name: 'S',
      systemPrompt: 'x',
      engine: 'cli',
      model: 'sonnet'
    }
    let meta = (await loadSessionMeta(root, id))!
    expect(resolveModel(meta, 'summary', hat)).toBe('sonnet') // hat default
    expect(resolveModel(meta, 'summary', null)).toBeUndefined() // no hat, no override
    meta = await setSectionModel(root, id, 'summary', 'haiku')
    expect(resolveModel(meta, 'summary', hat)).toBe('haiku') // override wins
  })

  it('falls back to the workspace default when override and hat.model are absent', async () => {
    const id = await seed()
    const meta = (await loadSessionMeta(root, id))!
    const hatNoModel: Hat = { id: 'x', name: 'X', systemPrompt: 'x', engine: 'cli' }
    // No section override, hat has no model → workspace default tier is used.
    expect(resolveModel(meta, 'summary', hatNoModel, 'workspace-default')).toBe('workspace-default')
    expect(resolveModel(meta, 'summary', null, 'workspace-default')).toBe('workspace-default')
  })

  it('appends normalized events to transcript.jsonl', async () => {
    const id = await seed()
    await appendTranscript(root, id, { kind: 'text_delta', text: 'hi' })
    await appendTranscript(root, id, { kind: 'turn_end', sessionId: 'abc' })
    const lines = (await readFile(join(root, id, 'transcript.jsonl'), 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0])).toEqual({ kind: 'text_delta', text: 'hi' })
    expect(JSON.parse(lines[1]).kind).toBe('turn_end')
  })
})
