import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createWorkspace,
  createProject,
  createSession,
  loadDocument,
  loadSessionMeta,
  writeDocument,
  upsertThread,
  appendDocumentSection,
  splitDocumentSection
} from './workspace'
import { updateSectionBody } from '../document/document'
import type { Thread } from '../../shared/types'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wf-'))
})

describe('appendDocumentSection', () => {
  it('appends after the source section, mints a unique id, seeds status', async () => {
    await createWorkspace(root)
    const p = await createProject(root, 'P')
    const s = await createSession(root, p.id, 'S', 'spec-design', 'cli')

    const { doc, newSectionId, meta } = await appendDocumentSection(
      root,
      s.id,
      { type: 'requirements', title: 'Extra', hat: 'analyst', format: 'html' },
      'requirements'
    )
    const idx = doc.sections.findIndex((x) => x.id === 'requirements')
    expect(doc.sections[idx + 1].id).toBe(newSectionId)
    expect(meta.sectionStatus?.[newSectionId]).toBe('empty')

    // persisted + round-trips
    const reloaded = await loadDocument(root, s.id)
    expect(reloaded.sections.some((x) => x.id === newSectionId)).toBe(true)
  })

  it('seeds status ready when a body is supplied', async () => {
    await createWorkspace(root)
    const p = await createProject(root, 'P')
    const s = await createSession(root, p.id, 'S', 'spec-design', 'cli')
    const { newSectionId, meta } = await appendDocumentSection(root, s.id, {
      type: 'code',
      title: 'Snippet',
      hat: 'architect',
      format: 'md',
      body: 'const x = 1'
    })
    expect(meta.sectionStatus?.[newSectionId]).toBe('ready')
  })
})

describe('splitDocumentSection', () => {
  it('keeps the original id + head body, mints a tail with the remainder', async () => {
    await createWorkspace(root)
    const p = await createProject(root, 'P')
    const s = await createSession(root, p.id, 'S', 'spec-design', 'cli')
    // Split needs a md/code section (rendered text === body); 'design' is md.
    const doc = await loadDocument(root, s.id)
    await writeDocument(root, s.id, updateSectionBody(doc, 'design', 'HEAD||TAIL'))

    const {
      doc: next,
      newSectionId,
      meta
    } = await splitDocumentSection(
      root,
      s.id,
      'design',
      6 // offset of "TAIL"
    )
    const head = next.sections.find((x) => x.id === 'design')
    const tail = next.sections.find((x) => x.id === newSectionId)
    expect(head?.body).toBe('HEAD||')
    expect(tail?.body).toBe('TAIL')
    expect(meta.sectionStatus?.[newSectionId]).toBe('ready')
  })

  it('re-anchors a thread to the tail when its quote moves into the tail body', async () => {
    await createWorkspace(root)
    const p = await createProject(root, 'P')
    const s = await createSession(root, p.id, 'S', 'spec-design', 'cli')
    const doc = await loadDocument(root, s.id)
    await writeDocument(root, s.id, updateSectionBody(doc, 'design', 'alpha beta gamma'))

    const thread: Thread = {
      id: 't1',
      sectionId: 'design',
      anchor: {
        sectionId: 'design',
        quote: 'gamma',
        prefix: 'beta ',
        suffix: '',
        startHint: 11,
        bodyHash: 'h',
        state: 'anchored'
      },
      kind: 'free',
      status: 'ready',
      createdAt: 'now',
      updatedAt: 'now',
      messages: []
    }
    await upsertThread(root, s.id, thread)

    // split so "gamma" lands in the tail
    const { newSectionId } = await splitDocumentSection(root, s.id, 'design', 11)
    const meta = await loadSessionMeta(root, s.id)
    expect(meta?.threads?.['t1'].sectionId).toBe(newSectionId)
    expect(meta?.threads?.['t1'].anchor?.sectionId).toBe(newSectionId)
  })

  it('is a no-op for an unknown section id', async () => {
    await createWorkspace(root)
    const p = await createProject(root, 'P')
    const s = await createSession(root, p.id, 'S', 'spec-design', 'cli')
    const { newSectionId } = await splitDocumentSection(root, s.id, 'nope', 3)
    expect(newSectionId).toBe('')
  })

  it('is a no-op for an html section (rendered offset ≠ source offset)', async () => {
    // Splitting html at a rendered-text offset would cut markup mid-tag, so the
    // split refuses (guarded in the renderer too, via AskMenu canSplit).
    await createWorkspace(root)
    const p = await createProject(root, 'P')
    const s = await createSession(root, p.id, 'S', 'spec-design', 'cli')
    const doc = await loadDocument(root, s.id)
    await writeDocument(root, s.id, updateSectionBody(doc, 'requirements', '<p>HEAD||TAIL</p>'))
    const { doc: next, newSectionId } = await splitDocumentSection(root, s.id, 'requirements', 6)
    expect(newSectionId).toBe('')
    expect(next.sections.find((x) => x.id === 'requirements')?.body).toBe('<p>HEAD||TAIL</p>')
  })
})
