import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { InlineInput } from './InlineInput'
import type { TreeNode } from '../../../shared/types'

function Node({ node }: { node: TreeNode }): React.JSX.Element {
  const select = useStore((s) => s.select)
  const active = useStore((s) => s.activeSessionId)
  const loadTree = useStore((s) => s.loadTree)
  const [addingSession, setAddingSession] = useState(false)
  const addSessionBtn = useRef<HTMLButtonElement>(null)
  const addSession = async (name: string): Promise<void> => {
    setAddingSession(false)
    await window.workphlo.createSession(node.id, name)
    await loadTree()
  }
  const [addingCliSession, setAddingCliSession] = useState(false)
  const addCliSessionBtn = useRef<HTMLButtonElement>(null)
  const addCliSession = async (name: string): Promise<void> => {
    setAddingCliSession(false)
    await window.workphlo.createSession(node.id, name, 'cli')
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
            ref={addSessionBtn}
            aria-label={`Add session to ${node.name}`}
            title="New session"
            className="px-1 text-xs text-slate-400 opacity-0 hover:text-slate-700 group-hover:opacity-100"
            // Idempotent: clicking again while the input is open is a no-op, so
            // it never blows away text the user has already typed.
            onClick={() => setAddingSession(true)}
          >
            + Session
          </button>
        )}
        {node.type === 'project' && (
          <button
            ref={addCliSessionBtn}
            aria-label={`Add CLI session to ${node.name}`}
            title="New CLI session"
            className="px-1 text-xs text-slate-400 opacity-0 hover:text-slate-700 group-hover:opacity-100"
            // Idempotent: clicking again while the input is open is a no-op, so
            // it never blows away text the user has already typed.
            onClick={() => setAddingCliSession(true)}
          >
            + CLI
          </button>
        )}
      </span>
      {addingSession && (
        <InlineInput
          placeholder="Session name"
          onSubmit={(name) => void addSession(name)}
          onCancel={() => setAddingSession(false)}
          restoreFocusRef={addSessionBtn}
        />
      )}
      {addingCliSession && (
        <InlineInput
          placeholder="CLI session name"
          onSubmit={(name) => void addCliSession(name)}
          onCancel={() => setAddingCliSession(false)}
          restoreFocusRef={addCliSessionBtn}
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
  const addProjectBtn = useRef<HTMLButtonElement>(null)
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
          ref={addProjectBtn}
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
              restoreFocusRef={addProjectBtn}
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
