import type { JSX } from 'react'
import type { Section, SectionType } from '../../../shared/types'

// Restrictive CSP prepended to agent HTML so it can't beacon out: the empty
// sandbox already blocks scripts and same-origin, but subresource loads (img,
// css @import, fetch of remote assets) would still leak. `default-src 'none'`
// denies all network; inline styles and data: images are allowed so the markup
// can still render richly.
const HTML_CSP =
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:">'

// Agent-authored HTML is rendered inside a locked-down sandboxed iframe (spec
// §8): the empty sandbox blocks scripts and same-origin, and the injected CSP
// blocks all subresource network loads — just formatted markup.
function HtmlBody({ body }: { body: string }): JSX.Element {
  return (
    <iframe
      title="section-html"
      sandbox=""
      className="w-full min-h-24 border-0 bg-white"
      srcDoc={HTML_CSP + body}
    />
  )
}

function TextBody({ body }: { body: string }): JSX.Element {
  return <pre className="whitespace-pre-wrap text-sm">{body}</pre>
}

function CodeBody({ body }: { body: string }): JSX.Element {
  return (
    <pre className="overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100">
      <code>{body}</code>
    </pre>
  )
}

function DiffBody({ body }: { body: string }): JSX.Element {
  const lines = body.split('\n')
  return (
    <div className="overflow-auto rounded border font-mono text-xs">
      {lines.map((line, i) => {
        const meta = line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')
        const kind = meta
          ? 'meta'
          : line.startsWith('+')
            ? 'add'
            : line.startsWith('-')
              ? 'del'
              : 'ctx'
        const cls =
          kind === 'add'
            ? 'bg-green-100 text-green-900'
            : kind === 'del'
              ? 'bg-red-100 text-red-900'
              : kind === 'meta'
                ? 'bg-slate-100 text-slate-500'
                : 'text-slate-700'
        return (
          <div key={i} data-diff={kind} className={`whitespace-pre px-2 ${cls}`}>
            {line || ' '}
          </div>
        )
      })}
    </div>
  )
}

// The extensible type → renderer registry (spec §3.2). New section types add a
// row here without touching the canvas.
const REGISTRY: Partial<Record<SectionType, (s: Section) => JSX.Element>> = {
  summary: (s) => (s.format === 'html' ? <HtmlBody body={s.body} /> : <TextBody body={s.body} />),
  requirements: (s) =>
    s.format === 'html' ? <HtmlBody body={s.body} /> : <TextBody body={s.body} />,
  code: (s) => <CodeBody body={s.body} />,
  diff: (s) => <DiffBody body={s.body} />
}

export function SectionBody({ section }: { section: Section }): JSX.Element {
  const render = REGISTRY[section.type]
  if (render) return render(section)
  // Fallback: honour the declared format, default to plain text.
  return section.format === 'html' ? (
    <HtmlBody body={section.body} />
  ) : (
    <TextBody body={section.body} />
  )
}
