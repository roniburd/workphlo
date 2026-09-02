import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createWorkspace,
  createProject,
  createSession,
  loadSessionMeta
} from './workspace/workspace'
import { generateSection } from './session'
import { abs } from './workspace/paths'
import type { AgentEngine, EngineEvent, SectionStatus } from '../shared/types'

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

describe('generateSection', () => {
  it('streams deltas into the body, flips status generating→ready, appends transcript', async () => {
    await createWorkspace(root)
    const p = await createProject(root, 'P')
    const s = await createSession(root, p.id, 'S', 'spec-design', 'cli')

    const statuses: SectionStatus[] = []
    const deltas: string[] = []
    await generateSection(
      root,
      s.id,
      'requirements',
      (m) => {
        if (m.type === 'status') statuses.push(m.status)
        else if (m.event.kind === 'text_delta') deltas.push(m.event.text)
      },
      {
        createEngine: () =>
          fakeEngine([
            { kind: 'text_delta', text: '<p>Req ' },
            { kind: 'text_delta', text: 'one</p>' },
            { kind: 'turn_end', sessionId: 'x' }
          ])
      }
    )

    const md = await readFile(join(abs(root, s.id), 'document.md'), 'utf8')
    expect(md).toContain('<p>Req one</p>')
    expect(statuses).toEqual(['generating', 'ready'])
    expect(deltas.join('')).toBe('<p>Req one</p>')

    const meta = await loadSessionMeta(root, s.id)
    expect(meta?.sectionStatus?.requirements).toBe('ready')

    const transcript = await readFile(join(abs(root, s.id), 'transcript.jsonl'), 'utf8')
    expect(transcript).toContain('text_delta')
    expect(transcript).toContain('turn_end')
  })

  it('sets status error when the engine emits an error event', async () => {
    await createWorkspace(root)
    const p = await createProject(root, 'P')
    const s = await createSession(root, p.id, 'S2', 'spec-design', 'cli')

    const statuses: SectionStatus[] = []
    await generateSection(
      root,
      s.id,
      'requirements',
      (m) => {
        if (m.type === 'status') statuses.push(m.status)
      },
      { createEngine: () => fakeEngine([{ kind: 'error', message: 'boom' }]) }
    )

    expect(statuses).toEqual(['generating', 'error'])
    const meta = await loadSessionMeta(root, s.id)
    expect(meta?.sectionStatus?.requirements).toBe('error')
  })

  it('recovers off generating when the stream ends without turn_end or error (interrupt)', async () => {
    // Mirrors the real CLI on SIGTERM interrupt: it closes with exit code null
    // and emits NEITHER turn_end NOR error. Without the settled-guard the
    // section would stay stuck 'generating'.
    await createWorkspace(root)
    const p = await createProject(root, 'P')
    const s = await createSession(root, p.id, 'S4', 'spec-design', 'cli')

    const statuses: SectionStatus[] = []
    await generateSection(
      root,
      s.id,
      'requirements',
      (m) => {
        if (m.type === 'status') statuses.push(m.status)
      },
      { createEngine: () => fakeEngine([{ kind: 'text_delta', text: '<p>partial' }]) }
    )

    expect(statuses).toEqual(['generating', 'error'])
    const meta = await loadSessionMeta(root, s.id)
    expect(meta?.sectionStatus?.requirements).toBe('error')
  })

  it('keeps error status and does not clobber the doc on error-then-turn_end', async () => {
    // Real CLI failure ordering: an 'error' event ALWAYS followed by a
    // 'turn_end'. The turn_end must NOT flip status to ready nor write the
    // partial body over the document.
    await createWorkspace(root)
    const p = await createProject(root, 'P')
    const s = await createSession(root, p.id, 'S5', 'spec-design', 'cli')

    const statuses: SectionStatus[] = []
    await generateSection(
      root,
      s.id,
      'requirements',
      (m) => {
        if (m.type === 'status') statuses.push(m.status)
      },
      {
        createEngine: () =>
          fakeEngine([
            { kind: 'text_delta', text: '<p>partial body</p>' },
            { kind: 'error', message: 'boom' },
            { kind: 'turn_end', sessionId: 'x' }
          ])
      }
    )

    expect(statuses).toEqual(['generating', 'error'])
    const meta = await loadSessionMeta(root, s.id)
    expect(meta?.sectionStatus?.requirements).toBe('error')
    const md = await readFile(join(abs(root, s.id), 'document.md'), 'utf8')
    expect(md).not.toContain('<p>partial body</p>')
  })

  it('throws and marks error when the engine run throws', async () => {
    await createWorkspace(root)
    const p = await createProject(root, 'P')
    const s = await createSession(root, p.id, 'S3', 'spec-design', 'cli')

    const throwingEngine: AgentEngine = {
      // eslint-disable-next-line require-yield
      async *run() {
        throw new Error('kaboom')
      },
      interrupt() {
        /* no-op */
      }
    }
    await expect(
      generateSection(root, s.id, 'requirements', () => {}, {
        createEngine: () => throwingEngine
      })
    ).rejects.toThrow('kaboom')

    const meta = await loadSessionMeta(root, s.id)
    expect(meta?.sectionStatus?.requirements).toBe('error')
  })
})
