import { type JSX } from 'react'
import { TerminalPane } from './TerminalPane'
import { ArtifactPane } from './ArtifactPane'

export function CliSessionView({ sessionId }: { sessionId: string }): JSX.Element {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-2">
      <div className="min-h-0 border-r">
        <TerminalPane sessionId={sessionId} />
      </div>
      <div className="min-h-0">
        <ArtifactPane />
      </div>
    </div>
  )
}
