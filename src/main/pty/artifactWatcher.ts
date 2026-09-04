import { watch, type FSWatcher } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { ARTIFACT_FILE } from './scaffold'

export function createArtifactWatcher(o: {
  cwd: string
  onHtml: (html: string) => void
  pollMs?: number
  debounceMs?: number
}): { check(): Promise<void>; stop(): void } {
  const file = join(o.cwd, ARTIFACT_FILE)
  const pollMs = o.pollMs ?? 1000
  const debounceMs = o.debounceMs ?? 40
  let last = '' // `${mtimeMs}:${size}` of the last pushed version
  let stopped = false
  let debounce: NodeJS.Timeout | null = null
  let poll: NodeJS.Timeout | null = null
  let fsw: FSWatcher | null = null

  const check = async (): Promise<void> => {
    if (stopped) return
    let st: import('node:fs').Stats
    try {
      st = await stat(file)
    } catch {
      return // not written yet — silent no-op
    }
    const sig = `${st.mtimeMs}:${st.size}`
    if (sig === last) return
    let html: string
    try {
      html = await readFile(file, 'utf8')
    } catch {
      return // transient mid-write read failure; a later poll retries
    }
    last = sig
    o.onHtml(html)
  }

  // fs.watch on the PARENT dir survives atomic-replace writes (macOS); it is
  // best-effort acceleration only — the poll below is the liveness guarantee.
  try {
    fsw = watch(o.cwd, (_e, name) => {
      if (name && name !== ARTIFACT_FILE) return
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => void check(), debounceMs)
    })
  } catch {
    fsw = null
  }
  if (pollMs > 0) poll = setInterval(() => void check(), pollMs)

  return {
    check,
    stop() {
      stopped = true
      if (debounce) clearTimeout(debounce)
      if (poll) clearInterval(poll)
      fsw?.close()
    }
  }
}
