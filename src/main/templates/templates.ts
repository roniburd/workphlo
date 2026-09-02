import type { SectionTemplate, SessionDoc, Section, TemplateSection } from '../../shared/types'

// Derive the staling dependency map (section → [sections it reads]) directly from
// each section's `section:<id>` context entries, so dependencies can never drift
// from the context recipe that actually drives resolveContext. A section that
// reads no sibling section produces no edge.
function contextDependencies(sections: TemplateSection[]): Record<string, string[]> {
  const deps: Record<string, string[]> = {}
  for (const s of sections) {
    const upstream = (s.context ?? [])
      .filter((c) => c.startsWith('section:'))
      .map((c) => c.slice('section:'.length))
    if (upstream.length) deps[s.id] = upstream
  }
  return deps
}

// Built-in session templates seeded on first run. Pure data + helpers — no fs.
// Mirrors spec §4 (Spec / Design). The app owns this scaffold; bodies are
// agent-authored later.
const SPEC_DESIGN_SECTIONS: TemplateSection[] = [
  {
    id: 'summary',
    type: 'summary',
    title: 'Summary',
    hat: 'summarizer',
    format: 'html',
    context: ['session.goal', 'section:requirements', 'section:design']
  },
  {
    id: 'requirements',
    type: 'requirements',
    title: 'Requirements',
    hat: 'analyst',
    format: 'html',
    context: ['session.goal']
  },
  {
    id: 'design',
    type: 'code',
    title: 'Design',
    hat: 'architect',
    format: 'md',
    context: ['section:requirements', 'repo.paths']
  },
  {
    id: 'open-qs',
    type: 'open-qs',
    title: 'Open Questions',
    hat: 'architect',
    format: 'md',
    context: ['section:design']
  }
]
const SPEC_DESIGN: SectionTemplate = {
  id: 'spec-design',
  name: 'Spec / Design',
  sections: SPEC_DESIGN_SECTIONS,
  // { summary: ['requirements','design'], design: ['requirements'], 'open-qs': ['design'] }
  dependencies: contextDependencies(SPEC_DESIGN_SECTIONS)
}

const BUILTINS: SectionTemplate[] = [SPEC_DESIGN]

export function builtinTemplates(): SectionTemplate[] {
  return BUILTINS
}

export function getTemplate(id: string): SectionTemplate | null {
  return BUILTINS.find((t) => t.id === id) ?? null
}

// Expand a template into an empty typed document — one Section per template
// section, stable ids preserved, bodies blank until a hat fills them in.
export function scaffoldDocument(template: SectionTemplate): SessionDoc {
  const sections: Section[] = template.sections.map((s) => ({
    id: s.id,
    type: s.type,
    title: s.title,
    hat: s.hat,
    format: s.format ?? 'md',
    body: ''
  }))
  return { sections }
}
