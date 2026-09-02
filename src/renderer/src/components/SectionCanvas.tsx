import { useEffect, useRef, useState, type JSX } from 'react'
import { useStore } from '../store'
import { SectionBody } from '../sections/renderers'
import { buildAnchor, selectionOffsets } from '../sections/anchor'
import { AskMenu, type MenuState } from './AskMenu'
import { ThreadPanel } from './ThreadPanel'
import type { AskIntent, Section, SectionStatus, Thread } from '../../../shared/types'

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

// Shape of the selection payload posted by the sandboxed HTML reporter.
interface SelectionMsg {
  type: 'wf:selection'
  sectionId: string
  quote: string
  prefix: string
  suffix: string
  startHint: number
  bodyHash: string
  rect: { top: number; left: number; bottom: number; right: number; width: number; height: number }
}

function SectionCell({
  section,
  status,
  anyGenerating,
  threads
}: {
  section: Section
  status: SectionStatus
  anyGenerating: boolean
  threads: Thread[]
}): JSX.Element {
  const generateSection = useStore((s) => s.generateSection)
  const refreshSection = useStore((s) => s.refreshSection)
  const setSectionModel = useStore((s) => s.setSectionModel)
  const askSection = useStore((s) => s.askSection)
  const splitSection = useStore((s) => s.splitSection)
  const resolveAnchors = useStore((s) => s.resolveAnchors)
  const setThreadAnchorState = useStore((s) => s.setThreadAnchorState)

  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)

  const generating = status === 'generating'
  const stale = status === 'stale'
  const hasBody = section.body.trim() !== ''
  const isHtml = section.format === 'html'

  // HTML selection: trust ONLY messages from this cell's own iframe (opaque
  // origin, so e.source identity is the security boundary) whose type is a wf:*
  // string. Translate the iframe-local rect into parent coordinates for the menu.
  useEffect(() => {
    if (!isHtml) return
    const handler = (e: MessageEvent): void => {
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return
      const d = e.data as { type?: unknown } | null
      if (!d || typeof d.type !== 'string' || !d.type.startsWith('wf:')) return
      if (d.type === 'wf:selection') {
        const m = d as unknown as SelectionMsg
        if (m.sectionId !== section.id || !m.quote) return
        const fr = iframeRef.current.getBoundingClientRect()
        setMenu({
          top: fr.top + m.rect.bottom,
          left: fr.left + m.rect.left,
          anchor: {
            sectionId: section.id,
            quote: m.quote,
            prefix: m.prefix,
            suffix: m.suffix,
            startHint: m.startHint,
            bodyHash: m.bodyHash,
            state: 'anchored'
          },
          selectedText: m.quote
        })
      } else if (d.type === 'wf:selectionCleared') {
        setMenu(null)
      } else if (d.type === 'wf:anchorStates') {
        // Reply to our wf:anchors probe: flip each thread's anchor state to
        // what the iframe found (quote still present → anchored, else orphaned).
        const m = d as unknown as {
          sectionId: string
          states: { anchorId: string; state: 'anchored' | 'orphaned' }[]
        }
        if (m.sectionId !== section.id || !Array.isArray(m.states)) return
        for (const st of m.states) setThreadAnchorState(st.anchorId, st.state)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [isHtml, section.id, setThreadAnchorState])

  // Anchor re-resolution after the body changes (P2 §11). md/code render the body
  // as plain text, so resolve directly against it. html sections are opaque
  // iframes: probe the (freshly reloaded) reporter with the stored quotes and let
  // its wf:anchorStates reply drive setThreadAnchorState. Posting on both 'load'
  // (body changed → iframe reloaded) and immediately (threads changed, frame live)
  // covers either ordering.
  const anchoredThreads = threads.filter((t) => t.anchor)
  useEffect(() => {
    if (isHtml || !anchoredThreads.length) return
    resolveAnchors(section.id, section.body)
  }, [isHtml, section.id, section.body, anchoredThreads.length, resolveAnchors])
  useEffect(() => {
    if (!isHtml) return
    const frame = iframeRef.current
    if (!frame || !anchoredThreads.length) return
    const anchors = anchoredThreads.map((t) => ({ anchorId: t.id, quote: t.anchor!.quote }))
    const post = (): void => frame.contentWindow?.postMessage({ type: 'wf:anchors', anchors }, '*')
    frame.addEventListener('load', post)
    post()
    return () => frame.removeEventListener('load', post)
  }, [isHtml, section.body, anchoredThreads])

  // md/code selection: native window.getSelection() over the main-DOM body,
  // feeding the SAME quote-anchor pipeline as the iframe reporter.
  const onMouseUp = (): void => {
    if (isHtml) return
    const sel = window.getSelection()
    const el = bodyRef.current
    if (!sel || sel.isCollapsed || !el) {
      setMenu(null)
      return
    }
    const res = selectionOffsets(el, sel)
    if (!res) {
      setMenu(null)
      return
    }
    const full = el.textContent ?? ''
    const anchor = buildAnchor(section.id, full, res.start, res.end)
    let rect = el.getBoundingClientRect()
    try {
      rect = sel.getRangeAt(0).getBoundingClientRect()
    } catch {
      /* keep element rect */
    }
    setMenu({ top: rect.bottom, left: rect.left, anchor, selectedText: res.quote })
  }

  const runAsk = (intent: AskIntent, freeText?: string): void => {
    if (!menu) return
    void askSection(section.id, {
      anchor: menu.anchor,
      selectedText: menu.selectedText,
      intent,
      freeText
    })
    setMenu(null)
  }
  const runSplit = (at: number): void => {
    void splitSection(section.id, at)
    setMenu(null)
  }

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
            className={`rounded px-2 py-0.5 text-[10px] text-white disabled:opacity-50 ${
              stale ? 'bg-orange-600' : 'bg-blue-600'
            }`}
            // Disable every section's Generate while any section is generating,
            // so a second run can't collide with the in-flight one.
            disabled={anyGenerating}
            // Empty → generate; filled/stale → refresh (re-runs with current
            // upstream context and clears the stale flag).
            onClick={() =>
              hasBody ? void refreshSection(section.id) : void generateSection(section.id)
            }
          >
            {generating ? 'Generating…' : hasBody ? 'Refresh' : 'Generate'}
          </button>
        </div>
      </header>
      <div className="p-3" ref={bodyRef} onMouseUp={onMouseUp}>
        {!hasBody ? (
          <p className="text-sm italic text-slate-400">Not generated yet.</p>
        ) : (
          <SectionBody section={section} frameRef={iframeRef} />
        )}
        <ThreadPanel threads={threads} />
      </div>
      {menu && (
        <AskMenu
          menu={menu}
          onAsk={runAsk}
          onSplit={runSplit}
          onClose={() => setMenu(null)}
          // Split only for md/code (rendered text === source) and not mid-run.
          canSplit={!isHtml && !anyGenerating}
        />
      )}
    </section>
  )
}

export function SectionCanvas(): JSX.Element {
  const doc = useStore((s) => s.doc)
  const activeSessionId = useStore((s) => s.activeSessionId)
  const sectionStatus = useStore((s) => s.sectionStatus)
  const threads = useStore((s) => s.threads)
  const generateAll = useStore((s) => s.generateAll)
  const refreshAll = useStore((s) => s.refreshAll)
  const appendSection = useStore((s) => s.appendSection)
  // Inline add-section entry (Electron has no window.prompt).
  const [addingSection, setAddingSection] = useState(false)
  const [newSectionTitle, setNewSectionTitle] = useState('')

  if (!activeSessionId || !doc) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
        Select a session to see its document.
      </div>
    )
  }

  const anyGenerating = doc.sections.some((s) => (sectionStatus[s.id] ?? 'empty') === 'generating')
  const anyStale = doc.sections.some((s) => sectionStatus[s.id] === 'stale')
  const threadList = Object.values(threads)

  const addSection = (title: string): void => {
    setAddingSection(false)
    // Append a plain text cell by default; type/hat routing is deferred (P3).
    void appendSection({ type: 'summary', title, hat: 'summarizer', format: 'md', body: '' })
  }

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-auto p-4">
      <header className="flex items-center justify-end gap-2">
        {addingSection && (
          <input
            autoFocus
            aria-label="New section title"
            className="rounded border px-2 py-1 text-xs"
            placeholder="New section title"
            value={newSectionTitle}
            onChange={(e) => setNewSectionTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const title = newSectionTitle.trim()
                if (title) addSection(title)
              } else if (e.key === 'Escape') {
                setAddingSection(false)
              }
            }}
            onBlur={() => setAddingSection(false)}
          />
        )}
        <button
          className="rounded border px-3 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          // No structural edits while a run is in flight — an append/split racing
          // an in-flight body write could interleave with the atomic doc write.
          disabled={anyGenerating}
          onClick={() => {
            setNewSectionTitle('')
            setAddingSection(true)
          }}
        >
          + Add section
        </button>
        <button
          className="rounded bg-orange-600 px-3 py-1 text-xs text-white disabled:opacity-50"
          disabled={anyGenerating || !anyStale}
          onClick={() => void refreshAll()}
        >
          Refresh stale
        </button>
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
          threads={threadList.filter((t) => t.sectionId === section.id)}
        />
      ))}
    </div>
  )
}
