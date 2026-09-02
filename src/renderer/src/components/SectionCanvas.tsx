import type { JSX } from 'react'
import { useStore } from '../store'
import { SectionBody } from '../sections/renderers'
import type { Section, SectionStatus } from '../../../shared/types'

const STATUS_STYLES: Record<SectionStatus, string> = {
  empty: 'bg-slate-100 text-slate-500',
  generating: 'bg-amber-100 text-amber-800',
  ready: 'bg-green-100 text-green-800',
  stale: 'bg-orange-100 text-orange-800',
  error: 'bg-red-100 text-red-800'
}

// Model-override choices for a section (spec §2.2). The empty value inherits
// the hat default; the rest pin a specific model for this section only.
const MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'default (inherit)' },
  { value: 'claude-sonnet-5', label: 'claude-sonnet-5' },
  { value: 'claude-opus-5', label: 'claude-opus-5' },
  { value: 'claude-haiku-4-5-20251001', label: 'claude-haiku-4-5-20251001' }
]

function StatusBadge({ status }: { status: SectionStatus }): JSX.Element {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  )
}

function SectionCell({
  section,
  status,
  anyGenerating
}: {
  section: Section
  status: SectionStatus
  anyGenerating: boolean
}): JSX.Element {
  const generateSection = useStore((s) => s.generateSection)
  const setSectionModel = useStore((s) => s.setSectionModel)
  const generating = status === 'generating'
  const hasBody = section.body.trim() !== ''
  return (
    <section data-testid={`section-${section.id}`} className="rounded border bg-white shadow-sm">
      <header className="flex items-center justify-between border-b px-3 py-1.5">
        <h2 className="text-sm font-semibold">{section.title}</h2>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-400">{section.hat}</span>
          <StatusBadge status={status} />
          <select
            aria-label={`Model for ${section.title}`}
            className="rounded border px-1 py-0.5 text-[10px]"
            defaultValue=""
            onChange={(e) => void setSectionModel(section.id, e.target.value || undefined)}
          >
            {MODEL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            className="rounded bg-blue-600 px-2 py-0.5 text-[10px] text-white disabled:opacity-50"
            // Disable every section's Generate while any section is generating,
            // so a second run can't collide with the in-flight one.
            disabled={anyGenerating}
            onClick={() => void generateSection(section.id)}
          >
            {generating ? 'Generating…' : hasBody ? 'Refresh' : 'Generate'}
          </button>
        </div>
      </header>
      <div className="p-3">
        {!hasBody ? (
          <p className="text-sm italic text-slate-400">Not generated yet.</p>
        ) : (
          <SectionBody section={section} />
        )}
      </div>
    </section>
  )
}

export function SectionCanvas(): JSX.Element {
  const doc = useStore((s) => s.doc)
  const activeSessionId = useStore((s) => s.activeSessionId)
  const sectionStatus = useStore((s) => s.sectionStatus)
  const generateAll = useStore((s) => s.generateAll)

  if (!activeSessionId || !doc) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
        Select a session to see its document.
      </div>
    )
  }

  const anyGenerating = doc.sections.some((s) => (sectionStatus[s.id] ?? 'empty') === 'generating')

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-auto p-4">
      <header className="flex items-center justify-end">
        <button
          className="rounded bg-blue-600 px-3 py-1 text-xs text-white disabled:opacity-50"
          disabled={anyGenerating}
          onClick={() => void generateAll()}
        >
          Generate all
        </button>
      </header>
      {doc.sections.map((section) => (
        <SectionCell
          key={section.id}
          section={section}
          status={sectionStatus[section.id] ?? 'empty'}
          anyGenerating={anyGenerating}
        />
      ))}
    </div>
  )
}
