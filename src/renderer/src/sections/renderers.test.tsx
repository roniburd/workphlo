import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { SectionBody } from './renderers'
import type { Section } from '../../../shared/types'

const htmlSection = (body: string): Section => ({
  id: 'summary',
  type: 'summary',
  title: 'Summary',
  hat: 'summarizer',
  format: 'html',
  body
})

describe('HtmlBody sandbox lockdown (§8)', () => {
  it('renders agent HTML in a sandbox that NEVER grants same-origin', () => {
    const { container } = render(<SectionBody section={htmlSection('<p>hi</p>')} />)
    const iframe = container.querySelector('iframe')!
    const sandbox = iframe.getAttribute('sandbox') ?? ''
    expect(sandbox).toBe('allow-scripts')
    expect(sandbox).not.toContain('allow-same-origin')
  })

  it('gates scripts behind a per-render nonce CSP so agent scripts cannot run', () => {
    const { container } = render(
      <SectionBody section={htmlSection('<p>ok</p><script>window.__pwned=1</script>')} />
    )
    const srcdoc = container.querySelector('iframe')!.getAttribute('srcdoc') ?? ''
    // default-src 'none' → no network/egress; scripts pinned to a nonce.
    expect(srcdoc).toContain("default-src 'none'")
    const m = srcdoc.match(/script-src 'nonce-([0-9a-f]+)'/)
    expect(m).not.toBeNull()
    const nonce = m![1]
    // The agent-authored <script> has NO nonce → blocked under the CSP.
    expect(srcdoc).toContain('<script>window.__pwned=1</script>')
    // Only our trusted reporter carries the nonce.
    expect(srcdoc).toContain(`<script nonce="${nonce}">`)
  })

  it('uses a fresh, unguessable nonce per distinct body', () => {
    const { container: a } = render(<SectionBody section={htmlSection('<p>a</p>')} />)
    const { container: b } = render(<SectionBody section={htmlSection('<p>b</p>')} />)
    const nonceOf = (c: HTMLElement): string =>
      (c.querySelector('iframe')!.getAttribute('srcdoc') ?? '').match(/nonce-([0-9a-f]+)/)![1]
    const na = nonceOf(a)
    const nb = nonceOf(b)
    expect(na).toHaveLength(32)
    expect(na).not.toBe(nb)
  })
})
