import { useEffect, useState } from 'react'
import { TreePane } from './components/TreePane'
import { SectionCanvas } from './components/SectionCanvas'
import { PromptBar } from './components/PromptBar'
import { Transcript } from './components/Transcript'
import { CliSessionView } from './components/CliSessionView'
import { useStore } from './store'

export default function App(): React.JSX.Element {
  const appendEvent = useStore((s) => s.appendEvent)
  const applySectionEvent = useStore((s) => s.applySectionEvent)
  const applySectionStatus = useStore((s) => s.applySectionStatus)
  const applyThreadEvent = useStore((s) => s.applyThreadEvent)
  const applyThreadStatus = useStore((s) => s.applyThreadStatus)
  const applyArtifactUpdate = useStore((s) => s.applyArtifactUpdate)
  const applyPtyExit = useStore((s) => s.applyPtyExit)
  const mode = useStore((s) => s.mode)
  const activeSessionId = useStore((s) => s.activeSessionId)
  const [showTranscript, setShowTranscript] = useState(false)
  useEffect(() => {
    const offEngine = window.workphlo.onEngineEvent(({ event }) => appendEvent(event))
    const offSectionEvent = window.workphlo.onSectionEvent(applySectionEvent)
    const offSectionStatus = window.workphlo.onSectionStatus(applySectionStatus)
    const offThreadEvent = window.workphlo.onThreadEvent(applyThreadEvent)
    const offThreadStatus = window.workphlo.onThreadStatus(applyThreadStatus)
    const offArtifact = window.workphlo.onArtifactUpdate(applyArtifactUpdate)
    const offPtyExit = window.workphlo.onPtyExit(applyPtyExit)
    // append/split/expand changed the section list → reload the doc for the
    // affected session (guarded so a background session can't swap the view).
    const offDocChanged = window.workphlo.onDocChanged(({ sessionId }) => {
      if (useStore.getState().activeSessionId === sessionId) void useStore.getState().loadDoc()
    })
    return () => {
      offEngine()
      offSectionEvent()
      offSectionStatus()
      offThreadEvent()
      offThreadStatus()
      offArtifact()
      offPtyExit()
      offDocChanged()
    }
  }, [
    appendEvent,
    applySectionEvent,
    applySectionStatus,
    applyThreadEvent,
    applyThreadStatus,
    applyArtifactUpdate,
    applyPtyExit
  ])
  return (
    <div className="flex h-screen bg-slate-50">
      <aside className="w-64 overflow-auto border-r bg-white">
        <TreePane />
      </aside>
      <main className="flex flex-1 flex-col">
        {mode === 'cli' && activeSessionId ? (
          <CliSessionView sessionId={activeSessionId} />
        ) : (
          <>
            <SectionCanvas />
            <div className="flex flex-col border-t">
              <button
                className="flex items-center gap-1 border-b bg-slate-100 px-3 py-1 text-left text-xs font-medium text-slate-600"
                onClick={() => setShowTranscript((v) => !v)}
              >
                <span aria-hidden="true">{showTranscript ? '▾' : '▸'}</span> Transcript
              </button>
              {showTranscript && (
                <div className="flex h-48 flex-col bg-white">
                  <Transcript />
                </div>
              )}
            </div>
            <PromptBar />
          </>
        )}
      </main>
    </div>
  )
}
