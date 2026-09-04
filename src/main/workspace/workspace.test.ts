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
  appendTranscript,
  upsertThread,
  appendThreadMessage,
  setThreadStatus,
  markDependentsStale
} from './workspace'
import type { Hat, Thread } from '../../shared/types'

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

  it('createSession mode=cli scaffolds the skill and skips document.md', async () => {
    await createWorkspace(root)
    const p = await createProject(root, 'Proj')
    const meta = await createSession(root, p.id, 'S', 'spec-design', 'cli', 'cli')
    expect(meta.mode).toBe('cli')
    const skill = await readFile(
      join(root, meta.id, '.claude/skills/workphlo-html-report/SKILL.md'),
      'utf8'
    )
    expect(skill).toContain('result.html')
    // No document sections were scaffolded.
    const doc = await loadDocument(root, meta.id)
    expect(doc.sections).toHaveLength(0)
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

  it('scope-tags transcript lines when a scope is supplied', async () => {
    const id = await seed()
    await appendTranscript(root, id, { kind: 'text_delta', text: 'hi' }, { threadId: 't1' })
    await appendTranscript(root, id, { kind: 'text_delta', text: 'bare' })
    const lines = (await readFile(join(root, id, 'transcript.jsonl'), 'utf8')).trim().split('\n')
    expect(JSON.parse(lines[0])).toEqual({ kind: 'text_delta', text: 'hi', threadId: 't1' })
    // no scope => byte-identical to the P0 format
    expect(JSON.parse(lines[1])).toEqual({ kind: 'text_delta', text: 'bare' })
  })
})

describe('workspace thread persistence', () => {
  async function seed(): Promise<string> {
    await createWorkspace(root)
    const p = await createProject(root, 'Proj')
    const s = await createSession(root, p.id, 'S', 'spec-design', 'cli')
    return s.id
  }

  function makeThread(id: string, sectionId: string): Thread {
    return {
      id,
      sectionId,
      kind: 'free',
      status: 'idle',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: []
    }
  }

  it('upserts a thread into session.json keyed by id', async () => {
    const id = await seed()
    await upsertThread(root, id, makeThread('t1', 'summary'))
    const meta = await loadSessionMeta(root, id)
    expect(meta?.threads?.t1).toMatchObject({ id: 't1', sectionId: 'summary', status: 'idle' })
  })

  it('appends a message and bumps updatedAt', async () => {
    const id = await seed()
    await upsertThread(root, id, makeThread('t1', 'summary'))
    await appendThreadMessage(root, id, 't1', {
      id: 'm1',
      role: 'user',
      text: 'explain this',
      ts: '2026-02-02T00:00:00.000Z'
    })
    const meta = await loadSessionMeta(root, id)
    expect(meta?.threads?.t1.messages).toHaveLength(1)
    expect(meta?.threads?.t1.messages[0].text).toBe('explain this')
    expect(meta?.threads?.t1.updatedAt).not.toBe('2026-01-01T00:00:00.000Z')
  })

  it('sets thread status', async () => {
    const id = await seed()
    await upsertThread(root, id, makeThread('t1', 'summary'))
    await setThreadStatus(root, id, 't1', 'generating')
    expect((await loadSessionMeta(root, id))?.threads?.t1.status).toBe('generating')
  })

  it('throws when appending/setting status on a missing thread', async () => {
    const id = await seed()
    await expect(
      appendThreadMessage(root, id, 'nope', { id: 'm', role: 'user', text: 'x', ts: 'now' })
    ).rejects.toThrow()
    await expect(setThreadStatus(root, id, 'nope', 'ready')).rejects.toThrow()
  })
})

describe('markDependentsStale', () => {
  async function seed(): Promise<string> {
    await createWorkspace(root)
    const p = await createProject(root, 'Proj')
    const s = await createSession(root, p.id, 'S', 'spec-design', 'cli')
    return s.id
  }

  it('marks ready dependents stale and returns their ids', async () => {
    const id = await seed()
    // spec-design deps: summary <- [requirements, design], open-qs <- [design]
    await setSectionStatus(root, id, 'summary', 'ready')
    await setSectionStatus(root, id, 'open-qs', 'ready')
    const staled = await markDependentsStale(root, id, 'design')
    expect(staled.sort()).toEqual(['open-qs', 'summary'])
    const meta = await loadSessionMeta(root, id)
    expect(meta?.sectionStatus?.summary).toBe('stale')
    expect(meta?.sectionStatus?.['open-qs']).toBe('stale')
  })

  it('skips empty and generating dependents', async () => {
    const id = await seed()
    await setSectionStatus(root, id, 'summary', 'generating')
    await setSectionStatus(root, id, 'open-qs', 'ready')
    // summary stays 'empty'? no, it's generating; requirements untouched
    const staled = await markDependentsStale(root, id, 'design')
    expect(staled).toEqual(['open-qs'])
    const meta = await loadSessionMeta(root, id)
    expect(meta?.sectionStatus?.summary).toBe('generating') // skipped
  })

  it('returns [] when the changed section has no dependents', async () => {
    const id = await seed()
    await setSectionStatus(root, id, 'summary', 'ready')
    // summary is a target (dependsOn), nothing depends on it
    expect(await markDependentsStale(root, id, 'summary')).toEqual([])
  })
})
