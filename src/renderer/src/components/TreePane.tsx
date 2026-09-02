import { useEffect, useState } from 'react'
import { useStore } from '../store'
import type { TreeNode } from '../../../shared/types'

// Inline single-line text entry used in place of window.prompt, which Electron
// does not support (it throws "prompt() is not supported."). Enter submits a
// non-empty trimmed value; Escape or blur cancels.
function InlineInput({
  placeholder,
  onSubmit,
  onCancel
}: {
  placeholder: string
  onSubmit: (value: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [value, setValue] = useState('')
  return (
    <input
      autoFocus
      className="mt-1 w-full rounded border px-1 py-0.5 text-sm"
      placeholder={placeholder}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          const name = value.trim()
          if (name) onSubmit(name)
        } else if (e.key === 'Escape') {
          onCancel()
        }
      }}
      onBlur={onCancel}
    />
  )
}

function Node({ node }: { node: TreeNode }): React.JSX.Element {
  const select = useStore((s) => s.select)
  const active = useStore((s) => s.activeSessionId)
  const loadTree = useStore((s) => s.loadTree)
  const [addingSession, setAddingSession] = useState(false)
  const addSession = async (name: string): Promise<void> => {
    setAddingSession(false)
    await window.workphlo.createSession(node.id, name)
    await loadTree()
  }
  return (
    <li>
      <span className="group flex items-center justify-between gap-1">
        <span
          className={`cursor-pointer ${active === node.id ? 'font-bold' : ''}`}
          onClick={() => node.type === 'session' && select(node.id)}
        >
          <span aria-hidden="true">{node.type === 'project' ? '📁' : '📄'}</span>{' '}
          <span>{node.name}</span>
        </span>
        {node.type === 'project' && (
          <button
            aria-label={`Add session to ${node.name}`}
            title="New session"
            className="px-1 text-xs text-slate-400 opacity-0 hover:text-slate-700 group-hover:opacity-100"
            onClick={() => setAddingSession(true)}
          >
            + Session
          </button>
        )}
      </span>
      {addingSession && (
        <InlineInput
          placeholder="Session name"
          onSubmit={(name) => void addSession(name)}
          onCancel={() => setAddingSession(false)}
        />
      )}
      {node.children.length > 0 && (
        <ul className="pl-4">
          {node.children.map((c) => (
            <Node key={c.id} node={c} />
          ))}
        </ul>
      )}
    </li>
  )
}

export function TreePane(): React.JSX.Element {
  const tree = useStore((s) => s.tree)
  const loadTree = useStore((s) => s.loadTree)
  const [addingProject, setAddingProject] = useState(false)
  useEffect(() => {
    void loadTree()
  }, [loadTree])
  const addProject = async (name: string): Promise<void> => {
    setAddingProject(false)
    await window.workphlo.createProject(name)
    await loadTree()
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-2 py-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Projects
        </span>
        <button
          className="rounded bg-blue-600 px-2 py-0.5 text-xs text-white"
          onClick={() => setAddingProject(true)}
        >
          + Project
        </button>
      </div>
      <ul className="flex-1 overflow-auto p-2 text-sm">
        {addingProject && (
          <li>
            <InlineInput
              placeholder="Project name"
              onSubmit={(name) => void addProject(name)}
              onCancel={() => setAddingProject(false)}
            />
          </li>
        )}
        {tree.map((n) => (
          <Node key={n.id} node={n} />
        ))}
      </ul>
    </div>
  )
}
