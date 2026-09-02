import type { JSX } from 'react'
import type { Thread } from '../../../shared/types'

const THREAD_STATUS_STYLES: Record<Thread['status'], string> = {
  idle: 'bg-slate-100 text-slate-500',
  generating: 'bg-amber-100 text-amber-800',
  ready: 'bg-green-100 text-green-800',
  error: 'bg-red-100 text-red-800'
}

// Threads scoped to one section, rendered beneath its body. Each thread shows the
// verbatim quote it anchors to (or a whole-section note), an "anchor lost" badge
// when the anchor orphaned, the ask, and the agent's streamed/final answer.
export function ThreadPanel({ threads }: { threads: Thread[] }): JSX.Element | null {
  if (threads.length === 0) return null
  return (
    <div data-testid="thread-panel" className="mt-2 flex flex-col gap-2 border-t pt-2">
      {threads.map((t) => (
        <div key={t.id} data-testid={`thread-${t.id}`} className="rounded border bg-slate-50 p-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
              {t.kind}
            </span>
            <div className="flex items-center gap-1">
              {t.anchor?.state === 'orphaned' && (
                <span
                  className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] text-orange-800"
                  title="The selected text changed; this thread is still attached to the section."
                >
                  anchor lost
                </span>
              )}
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] ${THREAD_STATUS_STYLES[t.status]}`}
              >
                {t.status}
              </span>
            </div>
          </div>
          {t.anchor?.quote && (
            <blockquote className="mb-1 border-l-2 border-slate-300 pl-2 text-[11px] italic text-slate-500">
              “{t.anchor.quote}”
            </blockquote>
          )}
          <div className="flex flex-col gap-1">
            {t.messages.map((m) => (
              <div
                key={m.id}
                data-role={m.role}
                className={`text-xs ${m.role === 'user' ? 'font-medium text-slate-700' : 'whitespace-pre-wrap text-slate-600'}`}
              >
                <span className="mr-1 text-[10px] uppercase text-slate-400">
                  {m.role === 'user' ? 'you' : 'agent'}
                </span>
                {m.text}
              </div>
            ))}
            {t.status === 'generating' && !t.messages.some((m) => m.role === 'agent' && m.text) && (
              <div className="text-xs italic text-slate-400">Thinking…</div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
