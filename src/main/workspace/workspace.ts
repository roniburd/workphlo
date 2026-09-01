import { mkdir, writeFile, readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { slugify } from './slug'
import { abs, manifestPath, projectsDir } from './paths'
import type { ProjectMeta, SessionMeta, TreeNode, EngineKind } from '../../shared/types'

export async function createWorkspace(root: string): Promise<void> {
  await mkdir(projectsDir(root), { recursive: true })
  await mkdir(join(root, 'templates'), { recursive: true })
  await mkdir(join(root, 'hats'), { recursive: true })
  await writeFile(manifestPath(root), JSON.stringify({ version: 1 }, null, 2))
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
  const meta: SessionMeta = { id, name, templateId, engine, status: 'empty' }
  await writeFile(join(abs(root, id), 'session.json'), JSON.stringify(meta, null, 2))
  await writeFile(join(abs(root, id), 'document.md'), '')
  await writeFile(join(abs(root, id), 'transcript.jsonl'), '')
  return meta
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
