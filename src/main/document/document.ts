import type { Section, SessionDoc, SectionType, SectionFormat } from '../../shared/types'

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
