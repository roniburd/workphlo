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
  WorkspaceConfig
} from '../../shared/types'
import { getTemplate, scaffoldDocument } from '../templates/templates'
import { parseDocument, serializeDocument } from '../document/document'

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
  engine: EngineKind
): Promise<SessionMeta> {
  const id = join(projectId, 'sessions', slugify(name)).replaceAll('\\', '/')
  await mkdir(join(abs(root, id), 'artifacts'), { recursive: true })

  // Seed the document from the template scaffold (empty typed sections) and
  // initialize a per-section status map. Unknown templates yield an empty doc.
  const template = getTemplate(templateId)
  const doc = template ? scaffoldDocument(template) : { sections: [] }
  const sectionStatus: Record<string, SectionStatus> = {}
  for (const s of doc.sections) sectionStatus[s.id] = 'empty'

  const meta: SessionMeta = { id, name, templateId, engine, status: 'empty', sectionStatus }
  await writeFile(join(abs(root, id), 'session.json'), JSON.stringify(meta, null, 2))
  await writeFile(
    join(abs(root, id), 'document.md'),
    doc.sections.length ? serializeDocument(doc) : ''
  )
  await writeFile(join(abs(root, id), 'transcript.jsonl'), '')
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
// (spec §8 audit/resume log). Creates the file if absent.
export async function appendTranscript(
  root: string,
  sessionId: string,
  event: EngineEvent
): Promise<void> {
  await appendFile(join(abs(root, sessionId), 'transcript.jsonl'), JSON.stringify(event) + '\n')
}
