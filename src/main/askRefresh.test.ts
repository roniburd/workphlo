import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createWorkspace,
  createProject,
  createSession,
  loadSessionMeta,
  loadDocument,
  setSectionStatus
} from './workspace/workspace'
import { refreshSection, refreshAll, askSection, type AskMessage } from './session'
import { abs } from './workspace/paths'
import type { AgentEngine, EngineEvent, AskRequest } from '../shared/types'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wf-'))
})

const fakeEngine = (events: EngineEvent[]): AgentEngine => ({
  async *run() {
    for (const e of events) yield e
  },
  interrupt() {
    /* no-op */
  }
})

const ready = (text: string): EngineEvent[] => [
  { kind: 'text_delta', text },
  { kind: 'turn_end', sessionId: 'x' }
]

describe('refreshSection', () => {
  it('re-runs a stale section and flips it back to ready', async () => {
    await createWorkspace(root)
    const p = await createProject(root, 'P')
    const s = await createSession(root, p.id, 'S', 'spec-design', 'cli')
    await setSectionStatus(root, s.id, 'requirements', 'stale')

    const statuses: string[] = []
    await refreshSection(
      root,
      s.id,
      'requirements',
      (m) => {
        if (m.type === 'status') statuses.push(m.status)
      },
      { createEngine: () => fakeEngine(ready('<p>fresh reqs</p>')) }
    )

    expect(statuses).toEqual(['generating', 'ready'])
    const meta = await loadSessionMeta(root, s.id)
    expect(meta?.sectionStatus?.requirements).toBe('ready')
    const md = await readFile(join(abs(root, s.id), 'document.md'), 'utf8')
    expect(md).toContain('<p>fresh reqs</p>')
  })
})

describe('refreshAll', () => {
  it('regenerates only stale/error sections, in dependency order', async () => {
    await createWorkspace(root)
    const p = await createProject(root, 'P')
    const s = await createSession(root, p.id, 'S', 'spec-design', 'cli')
    // requirements is stale; design is error; summary/open-qs stay empty (skipped).
    await setSectionStatus(root, s.id, 'requirements', 'stale')
    await setSectionStatus(root, s.id, 'design', 'error')

    const generated: string[] = []
    await refreshAll(
      root,
      s.id,
      (sectionId, m) => {
        if (m.type === 'status' && m.status === 'generating') generated.push(sectionId)
      },
      { createEngine: () => fakeEngine(ready('<p>x</p>')) }
    )

    // requirements before design (design depends on requirements); empty ones skipped.
    expect(generated).toEqual(['requirements', 'design'])
    const meta = await loadSessionMeta(root, s.id)
    expect(meta?.sectionStatus?.requirements).toBe('ready')
    // design's own dependents (summary/open-qs) are 'empty', so design stays ready.
    expect(meta?.sectionStatus?.design).toBe('ready')
    expect(meta?.sectionStatus?.summary).toBe('empty')
  })
})

describe('askSection', () => {
  it('thread intent: creates a thread, streams the answer, persists messages + status', async () => {
    await createWorkspace(root)
    const p = await createProject(root, 'P')
    const s = await createSession(root, p.id, 'S', 'spec-design', 'cli')

    const msgs: AskMessage[] = []
    const ask: AskRequest = {
      anchor: null,
      selectedText: 'some clause',
      intent: 'explain',
      freeText: 'why this?'
    }
    await askSection(root, s.id, 'requirements', ask, (m) => msgs.push(m), {
      createEngine: () => fakeEngine(ready('Because reasons.'))
    })

    const created = msgs.find((m) => m.type === 'threadCreated')
    expect(created).toBeTruthy()
    const threadId = created && created.type === 'threadCreated' ? created.thread.id : ''
    expect(msgs.some((m) => m.type === 'threadStatus' && m.status === 'generating')).toBe(true)
    expect(msgs.some((m) => m.type === 'threadStatus' && m.status === 'ready')).toBe(true)
    expect(msgs.some((m) => m.type === 'threadEvent' && m.event.kind === 'text_delta')).toBe(true)

    const meta = await loadSessionMeta(root, s.id)
    const thread = meta?.threads?.[threadId]
    expect(thread?.sectionId).toBe('requirements')
    expect(thread?.kind).toBe('explain')
    expect(thread?.status).toBe('ready')
    // user ask + agent answer
    expect(thread?.messages.map((mm) => mm.role)).toEqual(['user', 'agent'])
    expect(thread?.messages[1].text).toBe('Because reasons.')

    // Thread turn is scope-tagged in the shared transcript.
    const transcript = await readFile(join(abs(root, s.id), 'transcript.jsonl'), 'utf8')
    expect(transcript).toContain(`"threadId":"${threadId}"`)

    // In-place body is NOT touched by a thread ask.
    const md = await readFile(join(abs(root, s.id), 'document.md'), 'utf8')
    expect(md).not.toContain('Because reasons.')
  })

  it('add-detail intent: rewrites the section body in place and stales dependents', async () => {
    await createWorkspace(root)
    const p = await createProject(root, 'P')
    const s = await createSession(root, p.id, 'S', 'spec-design', 'cli')
    // summary depends on requirements; make it 'ready' so it can be staled.
    await setSectionStatus(root, s.id, 'requirements', 'ready')
    await setSectionStatus(root, s.id, 'summary', 'ready')

    const msgs: AskMessage[] = []
    const ask: AskRequest = {
      anchor: null,
      selectedText: 'thing',
      intent: 'add-detail'
    }
    await askSection(root, s.id, 'requirements', ask, (m) => msgs.push(m), {
      createEngine: () => fakeEngine(ready('<p>rewritten body</p>'))
    })

    const md = await readFile(join(abs(root, s.id), 'document.md'), 'utf8')
    expect(md).toContain('<p>rewritten body</p>')
    const meta = await loadSessionMeta(root, s.id)
    expect(meta?.sectionStatus?.requirements).toBe('ready')
    expect(meta?.sectionStatus?.summary).toBe('stale')
    // stale ids are surfaced to the IPC layer.
    const stale = msgs.find((m) => m.type === 'stale')
    expect(stale && stale.type === 'stale' && stale.sectionIds).toContain('summary')
    // no thread created for an in-place ask.
    expect(msgs.some((m) => m.type === 'threadCreated')).toBe(false)
  })

  it('expand intent: appends a new section and generates into it (docChanged + new cell)', async () => {
    await createWorkspace(root)
    const p = await createProject(root, 'P')
    const s = await createSession(root, p.id, 'S', 'spec-design', 'cli')

    const msgs: AskMessage[] = []
    const ask: AskRequest = {
      anchor: null,
      selectedText: 'expand me',
      intent: 'expand'
    }
    await askSection(root, s.id, 'requirements', ask, (m) => msgs.push(m), {
      createEngine: () => fakeEngine(ready('<p>expanded cell</p>'))
    })

    expect(msgs.some((m) => m.type === 'docChanged')).toBe(true)
    const doc = await loadDocument(root, s.id)
    const newSection = doc.sections.find((sec) => sec.title.includes('(expanded)'))
    expect(newSection).toBeTruthy()
    expect(newSection?.body).toContain('<p>expanded cell</p>')
    // inserted immediately after the source section
    const reqIdx = doc.sections.findIndex((sec) => sec.id === 'requirements')
    const newIdx = doc.sections.findIndex((sec) => sec.id === newSection?.id)
    expect(newIdx).toBe(reqIdx + 1)
    const meta = await loadSessionMeta(root, s.id)
    expect(meta?.sectionStatus?.[newSection!.id]).toBe('ready')
    // original section body untouched.
    expect(doc.sections[reqIdx].body).toBe('')
  })

  it('thread intent: an error event flips the thread to error and does not append an agent message', async () => {
    await createWorkspace(root)
    const p = await createProject(root, 'P')
    const s = await createSession(root, p.id, 'S', 'spec-design', 'cli')

    const msgs: AskMessage[] = []
    const ask: AskRequest = { anchor: null, selectedText: 'x', intent: 'free', freeText: 'q' }
    await askSection(root, s.id, 'requirements', ask, (m) => msgs.push(m), {
      createEngine: () => fakeEngine([{ kind: 'error', message: 'boom' }])
    })

    const created = msgs.find((m) => m.type === 'threadCreated')
    const threadId = created && created.type === 'threadCreated' ? created.thread.id : ''
    const meta = await loadSessionMeta(root, s.id)
    const thread = meta?.threads?.[threadId]
    expect(thread?.status).toBe('error')
    expect(thread?.messages.map((mm) => mm.role)).toEqual(['user'])
  })
})
