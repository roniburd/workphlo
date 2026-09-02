import { describe, it, expect } from 'vitest'
import { parseDocument, serializeDocument, updateSectionBody } from './document'
import type { SessionDoc } from '../../shared/types'

const sample = `<!-- wf:section id=sum type=summary title="Summary" hat=summarizer format=html -->
<p>Hello</p>
<!-- wf:/section -->
<!-- wf:section id=req type=requirements title="Requirements" hat=analyst format=md -->
- one
- two
<!-- wf:/section -->
`

describe('document parser', () => {
  it('parses sections with attributes and body', () => {
    const doc = parseDocument(sample)
    expect(doc.sections).toHaveLength(2)
    expect(doc.sections[0]).toMatchObject({
      id: 'sum',
      type: 'summary',
      title: 'Summary',
      hat: 'summarizer',
      format: 'html'
    })
    expect(doc.sections[0].body.trim()).toBe('<p>Hello</p>')
    expect(doc.sections[1].body.trim()).toBe('- one\n- two')
  })

  it('round-trips parse -> serialize -> parse', () => {
    const doc = parseDocument(sample)
    const reparsed = parseDocument(serializeDocument(doc))
    expect(reparsed).toEqual(doc)
  })

  it('returns no sections for empty input', () => {
    expect(parseDocument('').sections).toEqual([])
  })

  it('escapes quotes in titles on serialize and reads them back', () => {
    const doc: SessionDoc = {
      sections: [
        { id: 'a', type: 'code', title: 'The "Design"', hat: 'architect', format: 'md', body: 'x' }
      ]
    }
    expect(parseDocument(serializeDocument(doc)).sections[0].title).toBe('The "Design"')
  })

  it('round-trips a title ending in a backslash', () => {
    const doc: SessionDoc = {
      sections: [
        { id: 'a', type: 'code', title: 'C:\\', hat: 'architect', format: 'md', body: 'x' }
      ]
    }
    expect(parseDocument(serializeDocument(doc)).sections[0].title).toBe('C:\\')
  })

  it('round-trips a title containing the close-delimiter arrow', () => {
    const doc: SessionDoc = {
      sections: [
        {
          id: 'a',
          type: 'code',
          title: 'Before --> After',
          hat: 'architect',
          format: 'md',
          body: 'x'
        }
      ]
    }
    expect(parseDocument(serializeDocument(doc)).sections[0].title).toBe('Before --> After')
  })

  it('round-trips a title containing a bare >', () => {
    const doc: SessionDoc = {
      sections: [
        { id: 'a', type: 'code', title: 'a > b', hat: 'architect', format: 'md', body: 'x' }
      ]
    }
    expect(parseDocument(serializeDocument(doc)).sections[0].title).toBe('a > b')
  })
})

describe('updateSectionBody', () => {
  const doc: SessionDoc = {
    sections: [
      { id: 'a', type: 'summary', title: 'A', hat: 'summarizer', format: 'html', body: 'old' },
      { id: 'b', type: 'code', title: 'B', hat: 'architect', format: 'md', body: 'keep' }
    ]
  }

  it('replaces the matching section body immutably', () => {
    const next = updateSectionBody(doc, 'a', 'new')
    expect(next).not.toBe(doc)
    expect(next.sections[0].body).toBe('new')
    expect(doc.sections[0].body).toBe('old') // original untouched
    expect(next.sections[1]).toBe(doc.sections[1]) // other sections preserved by ref
  })

  it('returns the same doc reference when the id is absent', () => {
    expect(updateSectionBody(doc, 'missing', 'x')).toBe(doc)
  })
})
