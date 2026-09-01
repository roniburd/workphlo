import { useStore } from '../store'

export function Transcript(): React.JSX.Element {
  const transcript = useStore((s) => s.transcript)
  return <pre className="flex-1 overflow-auto whitespace-pre-wrap p-3 text-sm">{transcript}</pre>
}
