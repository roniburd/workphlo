import { describe, it, expect } from 'vitest'
import { createCliSessions } from './cliSession'
import type { PtyHost } from './ptyHost'
import type { HookService } from './hookService'

function fakePtyHost() {
  let onData: (d: string) => void = () => {}
  let onExit: (e: { code: number; signal?: number }) => void = () => {}
  const calls: any = { started: null, writes: [] as string[], killed: [] as string[] }
  const host: PtyHost = {
    start(o) {
      calls.started = o
      onData = o.onData
      onExit = o.onExit
    },
    write(_id, d) {
      calls.writes.push(d)
    },
    resize() {},
    kill(id) {
      calls.killed.push(id)
    },
    has: () => true
  }
  return { host, calls, emitData: (d: string) => onData(d), emitExit: () => onExit({ code: 0 }) }
}

function fakeHooks(): HookService {
  return { port: 4321, register: () => 'tok-1', unregister: () => {}, close: async () => {} }
}

describe('createCliSessions', () => {
  it('start injects hook env + model and forwards pty data to wf:pty:data', () => {
    const pty = fakePtyHost()
    const sent: Array<[string, any]> = []
    const sessions = createCliSessions({
      root: '/root',
      hooks: fakeHooks(),
      ptyHost: pty.host,
      makeWatcher: (() => ({ check: async () => {}, stop: () => {} })) as any,
      send: (c, p) => sent.push([c, p])
    })
    sessions.start('projects/p/sessions/s', 80, 24, 'claude-opus-5')
    expect(pty.calls.started.model).toBe('claude-opus-5')
    expect(pty.calls.started.env.WORKPHLO_HOOK_PORT).toBe('4321')
    expect(pty.calls.started.env.WORKPHLO_HOOK_TOKEN).toBe('tok-1')

    pty.emitData('output')
    expect(sent).toContainEqual([
      'wf:pty:data',
      { sessionId: 'projects/p/sessions/s', data: 'output' }
    ])
  })

  it('watcher html pushes wf:artifactUpdate; pty exit pushes wf:pty:exit', () => {
    const pty = fakePtyHost()
    const sent: Array<[string, any]> = []
    let capturedOnHtml: ((h: string) => void) | null = null
    createCliSessions({
      root: '/root',
      hooks: fakeHooks(),
      ptyHost: pty.host,
      makeWatcher: ((o: any) => {
        capturedOnHtml = o.onHtml
        return { check: async () => {}, stop: () => {} }
      }) as any,
      send: (c, p) => sent.push([c, p])
    }).start('s', 80, 24)
    capturedOnHtml!('<article>hi</article>')
    expect(sent).toContainEqual(['wf:artifactUpdate', { sessionId: 's', html: '<article>hi</article>' }])
    pty.emitExit()
    expect(sent).toContainEqual(['wf:pty:exit', { sessionId: 's', code: 0, signal: undefined }])
  })
})
