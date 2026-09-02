import { describe, it, expect } from 'vitest'
import {
  parseDocument,
  serializeDocument,
  updateSectionBody,
  mintSectionId,
  appendSection,
  splitSection
} from './document'
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

describe('mintSectionId', () => {
  const doc: SessionDoc = {
    sections: [
      { id: 'design', type: 'code', title: 'Design', hat: 'architect', format: 'md', body: '' },
      { id: 'design-2', type: 'code', title: 'Design', hat: 'architect', format: 'md', body: '' }
    ]
  }

  it('slugifies the base when unique', () => {
    expect(mintSectionId(doc, 'New Notes')).toBe('new-notes')
  })

  it('suffixes -N to avoid collisions, skipping taken suffixes', () => {
    expect(mintSectionId(doc, 'Design')).toBe('design-3')
  })
})

describe('appendSection', () => {
  const base: SessionDoc = {
    sections: [
      { id: 'a', type: 'summary', title: 'A', hat: 'summarizer', format: 'html', body: 'x' },
      { id: 'b', type: 'code', title: 'B', hat: 'architect', format: 'md', body: 'y' }
    ]
  }

  it('appends at the end by default with a minted id and empty body', () => {
    const { doc, newSectionId } = appendSection(base, {
      type: 'open-qs',
      title: 'Notes',
      hat: 'architect',
      format: 'md'
    })
    expect(newSectionId).toBe('notes')
    expect(doc.sections.map((s) => s.id)).toEqual(['a', 'b', 'notes'])
    expect(doc.sections[2].body).toBe('')
    expect(base.sections).toHaveLength(2) // input not mutated
  })

  it('inserts immediately after afterId when given', () => {
    const { doc, newSectionId } = appendSection(
      base,
      { type: 'code', title: 'Mid', hat: 'architect', format: 'md', body: 'seed' },
      'a'
    )
    expect(doc.sections.map((s) => s.id)).toEqual(['a', newSectionId, 'b'])
    expect(doc.sections[1].body).toBe('seed')
  })

  it('appends at the end when afterId is unknown', () => {
    const { doc, newSectionId } = appendSection(
      base,
      { type: 'code', title: 'End', hat: 'architect', format: 'md' },
      'missing'
    )
    expect(doc.sections[doc.sections.length - 1].id).toBe(newSectionId)
  })

  it('round-trips an appended section through serialize/parse', () => {
    const { doc } = appendSection(base, {
      type: 'code',
      title: 'Dyn',
      hat: 'architect',
      format: 'md',
      body: 'hello'
    })
    expect(parseDocument(serializeDocument(doc))).toEqual(doc)
  })
})

describe('splitSection', () => {
  const base: SessionDoc = {
    sections: [
      {
        id: 'design',
        type: 'code',
        title: 'Design',
        hat: 'architect',
        format: 'md',
        body: 'headTAIL'
      },
      { id: 'open-qs', type: 'open-qs', title: 'Q', hat: 'architect', format: 'md', body: 'q' }
    ]
  }

  it('keeps the original id + head slice and inserts a minted tail after it', () => {
    const { doc, newSectionId } = splitSection(base, 'design', 4)
    expect(doc.sections.map((s) => s.id)).toEqual(['design', newSectionId, 'open-qs'])
    expect(doc.sections[0].body).toBe('head')
    expect(doc.sections[1].body).toBe('TAIL')
    // tail inherits type/hat/format/title unless overridden
    expect(doc.sections[1]).toMatchObject({ type: 'code', hat: 'architect', format: 'md' })
    expect(newSectionId).toBe('design-2')
    expect(base.sections[0].body).toBe('headTAIL') // input not mutated
  })

  it('applies tail overrides', () => {
    const { doc } = splitSection(base, 'design', 4, {
      title: 'Follow up',
      type: 'open-qs',
      hat: 'analyst',
      format: 'html'
    })
    expect(doc.sections[1]).toMatchObject({
      title: 'Follow up',
      type: 'open-qs',
      hat: 'analyst',
      format: 'html'
    })
  })

  it('returns the same doc reference and empty id when the section is absent', () => {
    const res = splitSection(base, 'missing', 2)
    expect(res.doc).toBe(base)
    expect(res.newSectionId).toBe('')
  })

  it('round-trips a split document through serialize/parse', () => {
    const { doc } = splitSection(base, 'design', 4)
    expect(parseDocument(serializeDocument(doc))).toEqual(doc)
  })
})
