import type { SessionDoc } from '../../shared/types'

// Resolve a section's context recipe (spec §4) into a single context-bundle
// string to prepend to the prompt. Tokens:
//   'session.goal'  → the session goal text
//   'section:<id>'  → that section's current body, labeled by id (skipped if
//                     the section is missing or empty)
//   'repo.paths'    → a short placeholder note; real repo reading lands later
// Unknown tokens are ignored. An empty/undefined recipe yields ''.
export function resolveContext(
  recipe: string[] | undefined,
  doc: SessionDoc,
  sessionGoal: string
): string {
  if (!recipe || recipe.length === 0) return ''
  const blocks: string[] = []
  for (const token of recipe) {
    if (token === 'session.goal') {
      if (sessionGoal.trim()) blocks.push(`## Session goal\n${sessionGoal.trim()}`)
    } else if (token === 'repo.paths') {
      blocks.push(
        '## Repository paths\n(Repository file access is not wired up yet; rely on the goal and prior sections.)'
      )
    } else if (token.startsWith('section:')) {
      const id = token.slice('section:'.length)
      const section = doc.sections.find((s) => s.id === id)
      if (section && section.body.trim()) {
        blocks.push(`## Section "${section.title || id}" (${id})\n${section.body.trim()}`)
      }
    }
    // Unknown tokens are ignored so recipes can grow without breaking here.
  }
  return blocks.join('\n\n')
}
