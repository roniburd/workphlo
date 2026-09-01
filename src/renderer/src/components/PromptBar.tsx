import { useState } from 'react'
import { useStore } from '../store'

export function PromptBar(): React.JSX.Element {
  const [text, setText] = useState('')
  const activeSessionId = useStore((s) => s.activeSessionId)
  const send = (): void => {
    if (!activeSessionId || text.trim() === '') return
    void window.workphlo.runPrompt(activeSessionId, text)
    setText('')
  }
  return (
    <div className="flex gap-2 border-t p-2">
      <input
        className="flex-1 rounded border px-2 py-1 text-sm"
        value={text}
        placeholder="Ask the agent…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') send()
        }}
      />
      <button className="rounded bg-blue-600 px-3 py-1 text-sm text-white" onClick={send}>
        Send
      </button>
    </div>
  )
}
