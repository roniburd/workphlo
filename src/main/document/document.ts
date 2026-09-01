import type { Section, SessionDoc, SectionType, SectionFormat } from '../../shared/types'

const OPEN = /<!--\s*wf:section\s+([^>]*?)\s*-->/g
const CLOSE = '<!-- wf:/section -->'

function parseAttrs(s: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /(\w+)=(?:"((?:[^"\\]|\\.)*)"|(\S+))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    const [, key, quoted, bare] = m
    attrs[key] = quoted !== undefined ? quoted.replace(/\\"/g, '"') : bare
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
    const closeIdx = md.indexOf(CLOSE, bodyStart)
    if (closeIdx === -1) break
    sections.push({
      id: attrs.id,
      type: attrs.type as SectionType,
      title: attrs.title ?? '',
      hat: attrs.hat ?? '',
      format: (attrs.format as SectionFormat) ?? 'md',
      body: md.slice(bodyStart, closeIdx).replace(/^\n/, '').replace(/\n$/, ''),
    })
    OPEN.lastIndex = closeIdx + CLOSE.length
  }
  return { sections }
}

export function serializeDocument(doc: SessionDoc): string {
  return doc.sections
    .map((s) => {
      const title = s.title.replace(/"/g, '\\"')
      return `<!-- wf:section id=${s.id} type=${s.type} title="${title}" hat=${s.hat} format=${s.format} -->\n${s.body}\n${CLOSE}`
    })
    .join('\n') + '\n'
}
