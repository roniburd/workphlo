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
  status
}: {
  section: Section
  status: SectionStatus
}): JSX.Element {
  return (
    <section data-testid={`section-${section.id}`} className="rounded border bg-white shadow-sm">
      <header className="flex items-center justify-between border-b px-3 py-1.5">
        <h2 className="text-sm font-semibold">{section.title}</h2>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-400">{section.hat}</span>
          <StatusBadge status={status} />
        </div>
      </header>
      <div className="p-3">
        {section.body.trim() === '' ? (
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

  if (!activeSessionId || !doc) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
        Select a session to see its document.
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-auto p-4">
      {doc.sections.map((section) => (
        <SectionCell
          key={section.id}
          section={section}
          status={sectionStatus[section.id] ?? 'empty'}
        />
      ))}
    </div>
  )
}
