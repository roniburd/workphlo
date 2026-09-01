import { join } from 'node:path'
export const projectsDir = (root: string) => join(root, 'projects')
export const abs = (root: string, id: string) => join(root, id)
export const manifestPath = (root: string) => join(root, 'workphlo.json')
