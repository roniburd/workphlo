import { useEffect } from 'react'
import { TreePane } from './components/TreePane'
import { Transcript } from './components/Transcript' // built in Task 8
import { PromptBar } from './components/PromptBar' // built in Task 8
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
    <div className="flex h-screen">
      <aside className="w-64 border-r overflow-auto">
        <TreePane />
      </aside>
      <main className="flex flex-1 flex-col">
        <Transcript />
        <PromptBar />
      </main>
    </div>
  )
}
