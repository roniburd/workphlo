import { useEffect } from 'react'
import { useStore } from '../store'
import type { TreeNode } from '../../../shared/types'

function Node({ node }: { node: TreeNode }): React.JSX.Element {
  const select = useStore((s) => s.select)
  const active = useStore((s) => s.activeSessionId)
  return (
    <li>
      <span
        className={`cursor-pointer ${active === node.id ? 'font-bold' : ''}`}
        onClick={() => node.type === 'session' && select(node.id)}
      >
        <span aria-hidden="true">{node.type === 'project' ? '📁' : '📄'}</span>{' '}
        <span>{node.name}</span>
      </span>
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
  useEffect(() => {
    void loadTree()
  }, [loadTree])
  return (
    <ul className="p-2 text-sm">
      {tree.map((n) => (
        <Node key={n.id} node={n} />
      ))}
    </ul>
  )
}
