import { join, resolve, sep } from 'node:path'

export function projectsDir(root: string): string {
  return join(root, 'projects')
}

/**
 * Resolve a workspace-relative id to an absolute path, rejecting any id that
 * escapes the workspace root (e.g. `../../etc`). ids originate server-side from
 * `loadTree` today, but this guard is the trust boundary for the IPC handlers
 * (`wf:runPrompt`/`wf:createProject`/`wf:createSession`) and must hold before
 * any untrusted content becomes renderable.
 */
export function abs(root: string, id: string): string {
  const resolvedRoot = resolve(root)
  const resolved = resolve(resolvedRoot, id)
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + sep)) {
    throw new Error(`path escapes workspace root: ${id}`)
  }
  return resolved
}

export function manifestPath(root: string): string {
  return join(root, 'workphlo.json')
}
