import { describe, it, expect, vi } from 'vitest'
import { createPtyHost, type PtyProc, type PtySpawn } from './ptyHost'

function fakeProc() {
  const proc: any = {
    written: [] as string[],
    resized: null as null | [number, number],
    killed: [] as string[],
    _data: null as null | ((d: string) => void),
    _exit: null as null | ((e: { exitCode: number; signal?: number }) => void),
    onData(cb: (d: string) => void) { proc._data = cb },
    onExit(cb: (e: { exitCode: number; signal?: number }) => void) { proc._exit = cb },
    write(d: string) { proc.written.push(d) },
    resize(c: number, r: number) { proc.resized = [c, r] },
    kill(sig?: string) { proc.killed.push(sig ?? 'SIGHUP') }
  }
  return proc as PtyProc & Record<string, any>
}

describe('PtyHost', () => {
  it('spawns claude interactively with model + append-system-prompt and forwards data', () => {
    const proc = fakeProc()
    const spawn = vi.fn(() => proc) as unknown as PtySpawn
    const host = createPtyHost({ spawn })
    const seen: string[] = []
    host.start({
      sessionId: 's1', cwd: '/tmp/s1', model: 'claude-opus-5',
      cols: 80, rows: 24, env: { PATH: '/usr/bin' },
      onData: (d) => seen.push(d), onExit: () => {}
    })
    const [file, args] = (spawn as any).mock.calls[0]
    expect(file).toBe('claude')
    expect(args).toContain('--append-system-prompt')
    expect(args).toContain('--model')
    expect(args).toContain('claude-opus-5')
    expect(args).not.toContain('-p') // interactive, not headless
    proc._data!('hello')
    expect(seen).toEqual(['hello'])
    expect(host.has('s1')).toBe(true)
  })

  it('write / resize forward to the proc; kill sends SIGINT then SIGTERM', () => {
    vi.useFakeTimers()
    const proc = fakeProc()
    const host = createPtyHost({ spawn: (() => proc) as unknown as PtySpawn })
    host.start({ sessionId: 's', cwd: '/tmp', cols: 80, rows: 24, env: {}, onData: () => {}, onExit: () => {} })
    host.write('s', 'ls\r')
    expect(proc.written).toContain('ls\r')
    host.resize('s', 100, 40)
    expect(proc.resized).toEqual([100, 40])
    host.kill('s')
    expect(proc.killed).toContain('SIGINT')
    vi.advanceTimersByTime(5000)
    expect(proc.killed).toContain('SIGTERM')
    vi.useRealTimers()
  })

  it('drops tracking on exit', () => {
    const proc = fakeProc()
    const host = createPtyHost({ spawn: (() => proc) as unknown as PtySpawn })
    host.start({ sessionId: 's', cwd: '/tmp', cols: 80, rows: 24, env: {}, onData: () => {}, onExit: () => {} })
    proc._exit!({ exitCode: 0 })
    expect(host.has('s')).toBe(false)
  })
})
