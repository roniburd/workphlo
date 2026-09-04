import { mkdir, writeFile, readFile, readdir, stat, rename, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { slugify } from './slug'
import { abs, manifestPath, projectsDir } from './paths'
import type {
  ProjectMeta,
  SessionMeta,
  TreeNode,
  EngineKind,
  SessionDoc,
  SectionStatus,
  Hat,
  EngineEvent,
  WorkspaceConfig,
  Thread,
  ThreadMessage
} from '../../shared/types'
import { getTemplate, scaffoldDocument } from '../templates/templates'
import { parseDocument, serializeDocument, appendSection, splitSection } from '../document/document'
import type { SectionType, SectionFormat } from '../../shared/types'
import { scaffoldCliSession } from '../pty/scaffold'

export async function createWorkspace(root: string): Promise<void> {
  await mkdir(projectsDir(root), { recursive: true })
  await mkdir(join(root, 'templates'), { recursive: true })
  await mkdir(join(root, 'hats'), { recursive: true })
  // Persist the workspace-level defaults (spec §2.2 final fallback tier).
  // defaultModel is intentionally left undefined so the engine's own default
  // applies until a user configures one.
  const config: WorkspaceConfig = { version: 1, defaultEngine: 'cli', defaultModel: undefined }
  await writeFile(manifestPath(root), JSON.stringify(config, null, 2))
}

// Load workphlo.json. Returns sensible defaults when the file is missing or
// unreadable so callers always get a usable config.
export async function loadWorkspaceConfig(root: string): Promise<WorkspaceConfig> {
  const cfg = await readMeta<WorkspaceConfig>(root, 'workphlo.json')
  return { version: 1, defaultEngine: 'cli', defaultModel: undefined, ...(cfg ?? {}) }
}

export async function createProject(
  root: string,
  name: string,
  parentId?: string
): Promise<ProjectMeta> {
  const base = parentId ? join(parentId) : 'projects'
  const id = join(base, slugify(name)).replaceAll('\\', '/')
  await mkdir(abs(root, id), { recursive: true })
  const meta: ProjectMeta = { id, name, children: [] }
  await writeFile(join(abs(root, id), 'project.json'), JSON.stringify(meta, null, 2))
  return meta
}

export async function createSession(
  root: string,
  projectId: string,
  name: string,
  templateId: string,
  engine: EngineKind,
  mode: 'document' | 'cli' = 'document'
): Promise<SessionMeta> {
  const id = join(projectId, 'sessions', slugify(name)).replaceAll('\\', '/')
  const dir = abs(root, id)
  await mkdir(join(dir, 'artifacts'), { recursive: true })

  if (mode === 'cli') {
    // CLI mode: no document scaffold; instead seed the cwd steering (skill +
    // hook settings). The cwd IS the session dir.
    await scaffoldCliSession(dir)
    const meta: SessionMeta = { id, name, templateId, engine, status: 'empty', mode }
    await writeFile(join(dir, 'session.json'), JSON.stringify(meta, null, 2))
    await writeFile(join(dir, 'transcript.jsonl'), '')
    return meta
  }

  // Seed the document from the template scaffold (empty typed sections) and
  // initialize a per-section status map. Unknown templates yield an empty doc.
  const template = getTemplate(templateId)
  const doc = template ? scaffoldDocument(template) : { sections: [] }
  const sectionStatus: Record<string, SectionStatus> = {}
  for (const s of doc.sections) sectionStatus[s.id] = 'empty'

  const meta: SessionMeta = { id, name, templateId, engine, status: 'empty', sectionStatus, mode }
  await writeFile(join(dir, 'session.json'), JSON.stringify(meta, null, 2))
  await writeFile(join(dir, 'document.md'), doc.sections.length ? serializeDocument(doc) : '')
  await writeFile(join(dir, 'transcript.jsonl'), '')
  return meta
}

// Read a session's metadata (engine, status, per-section status), or null.
export async function loadSessionMeta(
  root: string,
  sessionId: string
): Promise<SessionMeta | null> {
  return readMeta<SessionMeta>(abs(root, sessionId), 'session.json')
}

// Read and parse a session's document.md into its typed sections.
export async function loadDocument(root: string, sessionId: string): Promise<SessionDoc> {
  let md = ''
  try {
    md = await readFile(join(abs(root, sessionId), 'document.md'), 'utf8')
  } catch {
    return { sections: [] }
  }
  return parseDocument(md)
}

async function readMeta<T>(dir: string, file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(join(dir, file), 'utf8')) as T
  } catch {
    return null
  }
}

export async function loadTree(root: string): Promise<TreeNode[]> {
  return listProjects(join(root, 'projects'), 'projects')
}

async function listProjects(dir: string, idBase: string): Promise<TreeNode[]> {
  let entries: string[] = []
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }
  const nodes: TreeNode[] = []
  for (const name of entries) {
    const full = join(dir, name)
    if (!(await stat(full)).isDirectory()) continue
    const id = `${idBase}/${name}`
    const proj = await readMeta<ProjectMeta>(full, 'project.json')
    if (!proj) continue
    const sessions = await listSessions(join(full, 'sessions'), `${id}/sessions`)
    const subprojects = await listProjects(full, id) // nested projects live alongside sessions/
    nodes.push({ id, type: 'project', name: proj.name, children: [...subprojects, ...sessions] })
  }
  return nodes
}

async function listSessions(dir: string, idBase: string): Promise<TreeNode[]> {
  let entries: string[] = []
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }
  const nodes: TreeNode[] = []
  for (const name of entries) {
    const meta = await readMeta<SessionMeta>(join(dir, name), 'session.json')
    if (!meta) continue
    nodes.push({ id: `${idBase}/${name}`, type: 'session', name: meta.name, children: [] })
  }
  return nodes
}

// Write `contents` to `file` atomically: write a sibling temp file, then rename
// over the target. rename(2) is atomic within a directory, so a crash never
// leaves a half-written file (spec §8). The temp lives in the same dir so the
// rename stays on one filesystem.
async function writeFileAtomic(file: string, contents: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, contents)
  await rename(tmp, file)
}

// Atomically (re)write a session's document.md from its typed sections.
export async function writeDocument(
  root: string,
  sessionId: string,
  doc: SessionDoc
): Promise<void> {
  const md = doc.sections.length ? serializeDocument(doc) : ''
  await writeFileAtomic(join(abs(root, sessionId), 'document.md'), md)
}

// Read session.json, set one section's lifecycle status, and write it back
// atomically. Returns the updated meta.
export async function setSectionStatus(
  root: string,
  sessionId: string,
  sectionId: string,
  status: SectionStatus
): Promise<SessionMeta> {
  const dir = abs(root, sessionId)
  const meta: SessionMeta = JSON.parse(await readFile(join(dir, 'session.json'), 'utf8'))
  meta.sectionStatus = { ...(meta.sectionStatus ?? {}), [sectionId]: status }
  await writeFileAtomic(join(dir, 'session.json'), JSON.stringify(meta, null, 2))
  return meta
}

// Read session.json, set (or clear) one section's model override, and write it
// back atomically. Passing `undefined` clears the override for that section.
export async function setSectionModel(
  root: string,
  sessionId: string,
  sectionId: string,
  model: string | undefined
): Promise<SessionMeta> {
  const dir = abs(root, sessionId)
  const meta: SessionMeta = JSON.parse(await readFile(join(dir, 'session.json'), 'utf8'))
  const overrides = { ...(meta.sectionOverrides ?? {}) }
  if (model === undefined) delete overrides[sectionId]
  else overrides[sectionId] = { ...overrides[sectionId], model }
  meta.sectionOverrides = overrides
  await writeFileAtomic(join(dir, 'session.json'), JSON.stringify(meta, null, 2))
  return meta
}

// Resolve the model for a section run (spec §2.2): section override →
// hat default → workspace default.
export function resolveModel(
  meta: SessionMeta,
  sectionId: string,
  hat: Hat | null,
  workspaceDefaultModel?: string
): string | undefined {
  return meta.sectionOverrides?.[sectionId]?.model ?? hat?.model ?? workspaceDefaultModel
}

// Append one normalized engine event as a JSON line to transcript.jsonl
// (spec §8 audit/resume log). Creates the file if absent. When `scope` is
// present the event is scope-tagged (sectionId/threadId) so thread turns share
// the ONE per-session transcript; when absent the line is byte-identical to the
// P0 format (so existing generateSection calls / tests are unaffected).
export async function appendTranscript(
  root: string,
  sessionId: string,
  event: EngineEvent,
  scope?: { sectionId?: string; threadId?: string }
): Promise<void> {
  const payload = scope ? { ...event, ...scope } : event
  await appendFile(join(abs(root, sessionId), 'transcript.jsonl'), JSON.stringify(payload) + '\n')
}

// Insert or replace a Thread in session.json (keyed by thread.id), written
// atomically. Threads — structure, anchors, status, per-turn text — live here
// (not in document.md) so the body stays clean/diffable. Returns updated meta.
export async function upsertThread(
  root: string,
  sessionId: string,
  thread: Thread
): Promise<SessionMeta> {
  const dir = abs(root, sessionId)
  const meta: SessionMeta = JSON.parse(await readFile(join(dir, 'session.json'), 'utf8'))
  meta.threads = { ...(meta.threads ?? {}), [thread.id]: thread }
  await writeFileAtomic(join(dir, 'session.json'), JSON.stringify(meta, null, 2))
  return meta
}

// Append one message to an existing thread and bump updatedAt. Throws if the
// thread does not exist. Returns updated meta.
export async function appendThreadMessage(
  root: string,
  sessionId: string,
  threadId: string,
  msg: ThreadMessage
): Promise<SessionMeta> {
  const dir = abs(root, sessionId)
  const meta: SessionMeta = JSON.parse(await readFile(join(dir, 'session.json'), 'utf8'))
  const thread = meta.threads?.[threadId]
  if (!thread) throw new Error(`thread not found: ${threadId}`)
  const updated: Thread = {
    ...thread,
    messages: [...thread.messages, msg],
    updatedAt: new Date().toISOString()
  }
  meta.threads = { ...(meta.threads ?? {}), [threadId]: updated }
  await writeFileAtomic(join(dir, 'session.json'), JSON.stringify(meta, null, 2))
  return meta
}

// Set a thread's streaming lifecycle status and bump updatedAt. Throws if the
// thread does not exist. Returns updated meta.
export async function setThreadStatus(
  root: string,
  sessionId: string,
  threadId: string,
  status: Thread['status']
): Promise<SessionMeta> {
  const dir = abs(root, sessionId)
  const meta: SessionMeta = JSON.parse(await readFile(join(dir, 'session.json'), 'utf8'))
  const thread = meta.threads?.[threadId]
  if (!thread) throw new Error(`thread not found: ${threadId}`)
  const updated: Thread = { ...thread, status, updatedAt: new Date().toISOString() }
  meta.threads = { ...(meta.threads ?? {}), [threadId]: updated }
  await writeFileAtomic(join(dir, 'session.json'), JSON.stringify(meta, null, 2))
  return meta
}

// Append a new first-class section to the document and persist. Loads the doc,
// applies the immutable appendSection pure op (mints a collision-free id), writes
// document.md atomically, and seeds the new id's status in session.json ('ready'
// when a body is supplied, else 'empty'). Returns the updated doc + new id + meta.
export async function appendDocumentSection(
  root: string,
  sessionId: string,
  spec: { type: SectionType; title: string; hat: string; format: SectionFormat; body?: string },
  afterId?: string
): Promise<{ doc: SessionDoc; newSectionId: string; meta: SessionMeta }> {
  const doc = await loadDocument(root, sessionId)
  const { doc: next, newSectionId } = appendSection(doc, spec, afterId)
  await writeDocument(root, sessionId, next)
  const status: SectionStatus = spec.body && spec.body.length > 0 ? 'ready' : 'empty'
  const meta = await setSectionStatus(root, sessionId, newSectionId, status)
  return { doc: next, newSectionId, meta }
}

// Split a section at rendered/char offset `at` and persist. The original keeps
// its id + body.slice(0, at); a freshly-minted tail section takes body.slice(at).
// After writing, threads whose quote anchor now lives only in the tail body are
// re-anchored to the tail section (clean-separation payoff — threads/anchors live
// in session.json keyed by section id, never in document.md). When `id` is absent
// the op is a no-op (newSectionId ''). Returns the updated doc + new id + meta.
export async function splitDocumentSection(
  root: string,
  sessionId: string,
  id: string,
  at: number,
  tail?: { title?: string; type?: SectionType; hat?: string; format?: SectionFormat }
): Promise<{ doc: SessionDoc; newSectionId: string; meta: SessionMeta }> {
  const doc = await loadDocument(root, sessionId)
  const { doc: next, newSectionId } = splitSection(doc, id, at, tail)
  const dir = abs(root, sessionId)
  if (!newSectionId) {
    const meta: SessionMeta = JSON.parse(await readFile(join(dir, 'session.json'), 'utf8'))
    return { doc: next, newSectionId, meta }
  }
  await writeDocument(root, sessionId, next)
  const meta: SessionMeta = JSON.parse(await readFile(join(dir, 'session.json'), 'utf8'))
  const head = next.sections.find((s) => s.id === id)
  const tailSection = next.sections.find((s) => s.id === newSectionId)
  // Seed the tail status: 'ready' when it carries body text, else 'empty'.
  const status = { ...(meta.sectionStatus ?? {}) }
  status[newSectionId] = tailSection && tailSection.body.length > 0 ? 'ready' : 'empty'
  // Re-anchor: a thread anchored to `id` whose verbatim quote is now present only
  // in the tail body moves to the tail section (best-effort, raw-body match).
  const threads = { ...(meta.threads ?? {}) }
  for (const t of Object.values(meta.threads ?? {})) {
    if (t.sectionId !== id || !t.anchor) continue
    const q = t.anchor.quote
    const inHead = head?.body.includes(q) ?? false
    const inTail = tailSection?.body.includes(q) ?? false
    if (!inHead && inTail) {
      threads[t.id] = {
        ...t,
        sectionId: newSectionId,
        anchor: { ...t.anchor, sectionId: newSectionId },
        updatedAt: new Date().toISOString()
      }
    }
  }
  meta.sectionStatus = status
  meta.threads = threads
  await writeFileAtomic(join(dir, 'session.json'), JSON.stringify(meta, null, 2))
  return { doc: next, newSectionId, meta }
}

// Mark the transitive downstream dependents of `changedId` as 'stale' (spec §6:
// explicit staling, never silent). Reads the session template's dependencies
// (section → [dependsOn]), inverts it into a reverse map (dependsOn →
// [dependents]), then BFS's the downstream closure of changedId. Each reached
// section that EXISTS in the doc, is not 'generating', and is not 'empty' is set
// to 'stale'. session.json is rewritten once (atomic). Returns the newly-staled
// ids. Template-less / dynamic sections have no edges, so they never auto-stale.
export async function markDependentsStale(
  root: string,
  sessionId: string,
  changedId: string
): Promise<string[]> {
  const meta = await loadSessionMeta(root, sessionId)
  if (!meta) return []
  const deps = getTemplate(meta.templateId)?.dependencies
  if (!deps) return []
  // Invert section -> [dependsOn] into dependsOn -> [dependents].
  const reverse: Record<string, string[]> = {}
  for (const [section, dependsOn] of Object.entries(deps)) {
    for (const dep of dependsOn) (reverse[dep] ??= []).push(section)
  }
  const doc = await loadDocument(root, sessionId)
  const existing = new Set(doc.sections.map((s) => s.id))
  const status: Record<string, SectionStatus> = { ...(meta.sectionStatus ?? {}) }
  const staled: string[] = []
  // BFS the full downstream closure (traverse regardless of stale decision so a
  // skipped 'empty'/'generating' node's own dependents are still reached).
  const visited = new Set<string>([changedId])
  const queue = [...(reverse[changedId] ?? [])]
  while (queue.length) {
    const id = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)
    if (
      existing.has(id) &&
      status[id] !== 'generating' &&
      status[id] !== 'empty' &&
      status[id] !== 'stale'
    ) {
      status[id] = 'stale'
      staled.push(id)
    }
    for (const next of reverse[id] ?? []) queue.push(next)
  }
  if (staled.length) {
    meta.sectionStatus = status
    await writeFileAtomic(join(abs(root, sessionId), 'session.json'), JSON.stringify(meta, null, 2))
  }
  return staled
}
