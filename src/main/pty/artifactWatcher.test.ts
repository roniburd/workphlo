import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
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
})
