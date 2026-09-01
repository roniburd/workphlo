import type { JSX } from 'react'
import type { Section, SectionType } from '../../../shared/types'

// Agent-authored HTML is rendered inside a locked-down sandboxed iframe (spec
// §8): no scripts, no same-origin, no network — just formatted markup.
function HtmlBody({ body }: { body: string }): JSX.Element {
  return (
    <iframe
      title="section-html"
      sandbox=""
      className="w-full min-h-24 border-0 bg-white"
      srcDoc={body}
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
