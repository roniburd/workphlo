import type { Section, SessionDoc, SectionType, SectionFormat } from '../../shared/types'
import { slugify } from '../workspace/slug'

const OPEN = /<!--\s*wf:section\s+(.*?)\s*-->/g
const CLOSE = '<!-- wf:/section -->'

function parseAttrs(s: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /(\w+)=(?:"((?:[^"\\]|\\.)*)"|(\S+))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    const [, key, quoted, bare] = m
    attrs[key] = quoted !== undefined ? quoted.replace(/\\(.)/g, '$1') : bare
  }
  return attrs
}

export function parseDocument(md: string): SessionDoc {
  const sections: Section[] = []
  OPEN.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = OPEN.exec(md))) {
    const attrs = parseAttrs(m[1])
    const bodyStart = m.index + m[0].length
    // Known P0 limitation: if a section body contains the literal close
    // delimiter string ("<!-- wf:/section -->"), parsing truncates at that
    // occurrence instead of the real close tag. Body-delimiter escaping is
    // deferred to the P1 plan (a body-escaping codec would conflict with the
    // spec's human-editable/diffable body property, and no P0 consumer
    // generates bodies containing this string).
    const closeIdx = md.indexOf(CLOSE, bodyStart)
    if (closeIdx === -1) break
    sections.push({
      id: attrs.id,
      type: attrs.type as SectionType,
      title: attrs.title ?? '',
      hat: attrs.hat ?? '',
      format: (attrs.format as SectionFormat) ?? 'md',
      body: md.slice(bodyStart, closeIdx).replace(/^\n/, '').replace(/\n$/, '')
    })
    OPEN.lastIndex = closeIdx + CLOSE.length
  }
  return { sections }
}

// Immutable update of a single section's body by id. Returns the doc unchanged
// (same reference) when no section matches, so callers can cheaply detect a
// no-op. Other section objects are preserved by reference.
export function updateSectionBody(doc: SessionDoc, id: string, body: string): SessionDoc {
  let changed = false
  const sections = doc.sections.map((s) => {
    if (s.id !== id) return s
    changed = true
    return { ...s, body }
  })
  return changed ? { sections } : doc
}

// Mint a collision-free section id from a base string (source id/title). The
// base is slugified, then suffixed -2, -3, … until unique against every current
// section id. Guarantees new/split sections never cross-bind existing anchors
// or threads (which are keyed by section id).
export function mintSectionId(doc: SessionDoc, base: string): string {
  const existing = new Set(doc.sections.map((s) => s.id))
  const slug = slugify(base)
  if (!existing.has(slug)) return slug
  let n = 2
  while (existing.has(`${slug}-${n}`)) n++
  return `${slug}-${n}`
}

// Append a first-class section. The id is minted internally; the section is
// inserted immediately after `afterId` (or at the end when afterId is absent or
// unknown). Immutable: returns a new doc and never mutates the input. spec.type
// must be one of the fixed SectionType union values — no new type is introduced.
export function appendSection(
  doc: SessionDoc,
  spec: { type: SectionType; title: string; hat: string; format: SectionFormat; body?: string },
  afterId?: string
): { doc: SessionDoc; newSectionId: string } {
  const newSectionId = mintSectionId(doc, spec.title || spec.type)
  const section: Section = {
    id: newSectionId,
    type: spec.type,
    title: spec.title,
    hat: spec.hat,
    format: spec.format,
    body: spec.body ?? ''
  }
  const sections = [...doc.sections]
  const idx = afterId ? sections.findIndex((s) => s.id === afterId) : -1
  if (idx >= 0) sections.splice(idx + 1, 0, section)
  else sections.push(section)
  return { doc: { sections }, newSectionId }
}

// Split a section at rendered/char offset `at`. The original KEEPS its id and
// body.slice(0, at) (so existing anchors/threads/deps on it survive); a new tail
// section (freshly minted id, inheriting type/hat/format/title unless overridden
// via `tail`) takes body.slice(at) and is inserted immediately after. Immutable.
// When `id` is absent, returns the same doc reference and newSectionId '' (no-op,
// matching updateSectionBody's return-same-ref convention).
// NOTE: `at` is a char offset into the RENDERED text, and the slice is taken on
// the raw `body`. These coincide only for md/code (body === rendered text). For
// html-format cells the rendered text differs from the HTML source, so slicing at
// a rendered offset would cut markup mid-tag — the renderer therefore only offers
// "Split here" on md/code sections (see SectionCanvas canSplit).
export function splitSection(
  doc: SessionDoc,
  id: string,
  at: number,
  tail?: { title?: string; type?: SectionType; hat?: string; format?: SectionFormat }
): { doc: SessionDoc; newSectionId: string } {
  const idx = doc.sections.findIndex((s) => s.id === id)
  if (idx === -1) return { doc, newSectionId: '' }
  const original = doc.sections[idx]
  // Defense-in-depth: `at` is a rendered-text offset, valid against raw `body`
  // only for md/code. Slicing html here would cut markup mid-tag, so refuse
  // (no-op) even if a caller bypasses the renderer's canSplit gate.
  if (original.format === 'html') return { doc, newSectionId: '' }
  const newSectionId = mintSectionId(doc, tail?.title ?? original.title)
  const head: Section = { ...original, body: original.body.slice(0, at) }
  const tailSection: Section = {
    id: newSectionId,
    type: tail?.type ?? original.type,
    title: tail?.title ?? original.title,
    hat: tail?.hat ?? original.hat,
    format: tail?.format ?? original.format,
    body: original.body.slice(at)
  }
  const sections = [...doc.sections]
  sections.splice(idx, 1, head, tailSection)
  return { doc: { sections }, newSectionId }
}

export function serializeDocument(doc: SessionDoc): string {
  return (
    doc.sections
      .map((s) => {
        const title = s.title.replace(/\\/g, '\\\\').replace(/>/g, '\\>').replace(/"/g, '\\"')
        return `<!-- wf:section id=${s.id} type=${s.type} title="${title}" hat=${s.hat} format=${s.format} -->\n${s.body}\n${CLOSE}`
      })
      .join('\n') + '\n'
  )
}
