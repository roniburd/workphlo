import { describe, it, expect } from 'vitest'
import { builtinTemplates, getTemplate, scaffoldDocument } from './templates'
import { parseDocument, serializeDocument } from '../document/document'

describe('builtin templates', () => {
  it('ships the spec-design template with stable section ids', () => {
    const t = getTemplate('spec-design')
    expect(t).toBeTruthy()
    expect(t!.name).toBe('Spec / Design')
    const ids = t!.sections.map((s) => s.id)
    expect(ids).toEqual(['summary', 'requirements', 'design', 'open-qs'])
  })

  it('every builtin template has a unique id and non-empty sections', () => {
    const ids = builtinTemplates().map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const t of builtinTemplates()) expect(t.sections.length).toBeGreaterThan(0)
  })

  it('getTemplate returns null for an unknown id', () => {
    expect(getTemplate('does-not-exist')).toBeNull()
  })
})

describe('scaffoldDocument', () => {
  it('turns a template into a SessionDoc of empty typed sections', () => {
    const t = getTemplate('spec-design')!
    const doc = scaffoldDocument(t)
    expect(doc.sections).toHaveLength(t.sections.length)
    expect(doc.sections[0]).toMatchObject({
      id: 'summary',
      type: 'summary',
      title: 'Summary',
      hat: 'summarizer'
    })
    for (const s of doc.sections) expect(s.body).toBe('')
  })

  it('produces a document.md that round-trips through the parser', () => {
    const doc = scaffoldDocument(getTemplate('spec-design')!)
    const reparsed = parseDocument(serializeDocument(doc))
    expect(reparsed.sections.map((s) => s.id)).toEqual(doc.sections.map((s) => s.id))
    expect(reparsed.sections.map((s) => s.type)).toEqual(doc.sections.map((s) => s.type))
  })
})
