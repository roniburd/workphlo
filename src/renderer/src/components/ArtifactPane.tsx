import { type JSX } from 'react'
import { HtmlBody } from '../sections/renderers'
import { useStore } from '../store'

export function ArtifactPane(): JSX.Element {
  const html = useStore((s) => s.artifactHtml)
  return (
    <div className="flex h-full flex-col overflow-auto bg-white">
      <div className="border-b bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
        Result
      </div>
      {html ? (
        // Reuse the locked-down sandbox. A synthetic id is fine: the ask-menu
        // reporter's postMessages are simply ignored by this pane. HtmlBody's
        // iframe is w-full min-h-24 (shared with document sections — do not
        // change HtmlBody); force it to fill this pane instead.
        <div className="min-h-0 flex-1 [&>iframe]:h-full">
          <HtmlBody body={html} sectionId="__artifact__" />
        </div>
      ) : (
        <div className="p-6 text-sm text-slate-400">
          No result yet — the agent will write <code>result.html</code> here as it works.
        </div>
      )}
    </div>
  )
}
