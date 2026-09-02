import { useState, type JSX } from 'react'
import type { AskIntent, SelectionAnchor } from '../../../shared/types'

// The floating "ask" menu shown over a live selection. Lives in the PARENT React
// tree (never inside the sandbox). Pre-canned follow-ups map to AskIntents; the
// free-text box maps to intent 'free'. "Split here" is not an ask — it slices the
// section at the selection's rendered-text offset (anchor.startHint).
const ACTIONS: { intent: AskIntent; label: string }[] = [
  { intent: 'add-detail', label: 'Add detail' },
  { intent: 'disagree', label: 'I disagree' },
  { intent: 'explain', label: 'Explain' },
  { intent: 'expand', label: 'Expand' }
]

export interface MenuState {
  top: number
  left: number
  anchor: SelectionAnchor
  selectedText: string
}

export function AskMenu({
  menu,
  onAsk,
  onSplit,
  onClose,
  canSplit = true
}: {
  menu: MenuState
  onAsk: (intent: AskIntent, freeText?: string) => void
  onSplit: (at: number) => void
  onClose: () => void
  // Split slices at a RENDERED-text offset; that only maps back to the source
  // for md/code (body === rendered text). For html the offset indexes rendered
  // text but the source is raw markup, so splitting there would cut mid-tag —
  // the cell disables it (canSplit=false).
  canSplit?: boolean
}): JSX.Element {
  const [free, setFree] = useState('')
  return (
    <div
      role="menu"
      aria-label="Ask about selection"
      className="fixed z-50 w-64 rounded-md border bg-white p-2 shadow-lg"
      style={{ top: menu.top, left: menu.left }}
      // Keep clicks inside from clearing the selection / closing the menu.
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="truncate text-[10px] italic text-slate-400" title={menu.selectedText}>
          “{menu.selectedText.slice(0, 40)}
          {menu.selectedText.length > 40 ? '…' : ''}”
        </span>
        <button
          aria-label="Close ask menu"
          className="px-1 text-xs text-slate-400 hover:text-slate-700"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        {ACTIONS.map((a) => (
          <button
            key={a.intent}
            className="rounded bg-slate-100 px-2 py-0.5 text-[11px] hover:bg-slate-200"
            onClick={() => onAsk(a.intent)}
          >
            {a.label}
          </button>
        ))}
        {canSplit && (
          <button
            className="rounded bg-slate-100 px-2 py-0.5 text-[11px] hover:bg-slate-200"
            onClick={() => onSplit(menu.anchor.startHint)}
          >
            Split here
          </button>
        )}
      </div>
      <form
        className="mt-1 flex gap-1"
        onSubmit={(e) => {
          e.preventDefault()
          if (free.trim() === '') return
          onAsk('free', free.trim())
          setFree('')
        }}
      >
        <input
          className="flex-1 rounded border px-1 py-0.5 text-[11px]"
          placeholder="Ask something…"
          aria-label="Free-text ask"
          value={free}
          onChange={(e) => setFree(e.target.value)}
        />
        <button className="rounded bg-blue-600 px-2 py-0.5 text-[11px] text-white" type="submit">
          Ask
        </button>
      </form>
    </div>
  )
}
