import { useEffect, useRef, useState, type JSX } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useStore } from '../store'

export function TerminalPane({ sessionId }: { sessionId: string }): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const ptyExit = useStore((s) => s.ptyExit)
  const [startError, setStartError] = useState<string | null>(null)

  useEffect(() => {
    const term = new Terminal({ convertEol: true, fontSize: 13 })
    const fit = new FitAddon()
    term.loadAddon(fit)
    if (hostRef.current) term.open(hostRef.current)
    try {
      fit.fit()
    } catch {
      /* jsdom / zero-size: keep default cols/rows */
    }

    window.workphlo.ptyStart(sessionId, term.cols, term.rows).catch((err: unknown) => {
      setStartError(String(err instanceof Error ? err.message : err))
    })
    const offData = window.workphlo.onPtyData((p) => {
      if (p.sessionId === sessionId) term.write(p.data)
    })
    term.onData((d) => window.workphlo.ptyInput(sessionId, d))
    term.onResize(({ cols, rows }) => window.workphlo.ptyResize(sessionId, cols, rows))

    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        /* ignore */
      }
    })
    if (hostRef.current) ro.observe(hostRef.current)

    return () => {
      offData()
      ro.disconnect()
      term.dispose()
    }
  }, [sessionId])

  return (
    <div className="flex h-full flex-col bg-black">
      {startError && (
        <div className="bg-amber-100 px-3 py-1 text-xs text-amber-900">
          Could not start CLI session: {startError}
        </div>
      )}
      {ptyExit && (
        <div className="bg-amber-100 px-3 py-1 text-xs text-amber-900">
          Session ended (code {ptyExit.code}
          {ptyExit.signal ? `, signal ${ptyExit.signal}` : ''}).
        </div>
      )}
      <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden p-1" />
    </div>
  )
}
