import { useEffect } from 'react'
import { TreePane } from './components/TreePane'
import { SectionCanvas } from './components/SectionCanvas'
import { PromptBar } from './components/PromptBar'
import { useStore } from './store'

export default function App(): React.JSX.Element {
  const appendEvent = useStore((s) => s.appendEvent)
  useEffect(() => {
    const off = window.workphlo.onEngineEvent(({ event }) => appendEvent(event))
    return () => {
      off()
    }
  }, [appendEvent])
  return (
    <div className="flex h-screen bg-slate-50">
      <aside className="w-64 overflow-auto border-r bg-white">
        <TreePane />
      </aside>
      <main className="flex flex-1 flex-col">
        <SectionCanvas />
        <PromptBar />
      </main>
    </div>
  )
}
