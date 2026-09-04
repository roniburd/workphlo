import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, writeFile, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createArtifactWatcher } from './artifactWatcher'

describe('artifactWatcher', () => {
  it('check() pushes html once, then dedups until the file changes', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'wf-art-'))
    const seen: string[] = []
    const w = createArtifactWatcher({ cwd, onHtml: (h) => seen.push(h), pollMs: 0 })
    await w.check() // no file yet → no push
    expect(seen).toHaveLength(0)

    await writeFile(join(cwd, 'result.html'), '<article>one</article>')
    await w.check()
    await w.check() // unchanged → deduped
    expect(seen).toEqual(['<article>one</article>'])

    // A new write with different size is detected.
    await new Promise((r) => setTimeout(r, 10))
    await writeFile(join(cwd, 'result.html'), '<article>two-longer</article>')
    await w.check()
    expect(seen).toEqual(['<article>one</article>', '<article>two-longer</article>'])
    w.stop()
  })

  it('stop() halts the poll loop', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'wf-art-'))
    const onHtml = vi.fn()
    const w = createArtifactWatcher({ cwd, onHtml, pollMs: 5 })
    w.stop()
    await new Promise((r) => setTimeout(r, 20))
    expect(onHtml).not.toHaveBeenCalled()
  })

  it('re-stat guard: skips a push when the file changed mid-read (torn write)', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'wf-art-'))
    const file = join(cwd, 'result.html')
    await writeFile(file, '<article>stable</article>')
    const seen: string[] = []

    // Fake fs seam (injected via `deps`, mirroring ptyHost's injectable spawn):
    // the pre-read stat is real, but the post-read (verification) stat is
    // stubbed to report a different size — simulating a write landing between
    // the initial stat and the readFile call.
    const real = await stat(file)
    const queue: Array<{ mtimeMs: number; size: number }> = [
      real,
      { mtimeMs: real.mtimeMs, size: real.size + 1 }
    ]
    const fakeStat = vi.fn(async () => queue.shift() ?? real)
    const w = createArtifactWatcher({
      cwd,
      onHtml: (h) => seen.push(h),
      pollMs: 0,
      deps: { stat: fakeStat, readFile }
    })
    await w.check()
    expect(seen).toHaveLength(0) // torn read guarded, no push

    // Stable stat (pre- and post-read match, via the real fallback) → pushes.
    await w.check()
    expect(seen).toEqual(['<article>stable</article>'])
    w.stop()
  })
})
