import type { SectionTemplate, SessionDoc, Section } from '../../shared/types'

// Built-in session templates seeded on first run. Pure data + helpers — no fs.
// Mirrors spec §4 (Spec / Design). The app owns this scaffold; bodies are
// agent-authored later.
const SPEC_DESIGN: SectionTemplate = {
  id: 'spec-design',
  name: 'Spec / Design',
  sections: [
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
  ],
  dependencies: { summary: ['requirements', 'design'], 'open-qs': ['design'] }
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
