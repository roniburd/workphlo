import { describe, it, expect, afterEach } from 'vitest'
import { createHookService, type HookService } from './hookService'

let svc: HookService | null = null
afterEach(async () => { await svc?.close(); svc = null })

async function post(port: number, token?: string): Promise<number> {
  const res = await fetch(`http://127.0.0.1:${port}/hook`, {
    method: 'POST',
    headers: token ? { 'X-Workphlo-Hook-Token': token } : {},
    body: '{"hook_event_name":"Stop"}'
  })
  return res.status
}

describe('hookService', () => {
  it('maps a valid token to its session and always returns 204', async () => {
    const hits: string[] = []
    svc = await createHookService({ onHook: (id) => hits.push(id) })
    const token = svc.register('sess-A')
    expect(await post(svc.port, token)).toBe(204)
    expect(hits).toEqual(['sess-A'])
  })

  it('fails open: unknown token still 204, no callback', async () => {
    const hits: string[] = []
    svc = await createHookService({ onHook: (id) => hits.push(id) })
    expect(await post(svc.port, 'bogus')).toBe(204)
    expect(await post(svc.port)).toBe(204)
    expect(hits).toEqual([])
  })

  it('unregister stops routing that token', async () => {
    const hits: string[] = []
    svc = await createHookService({ onHook: (id) => hits.push(id) })
    const token = svc.register('sess-B')
    svc.unregister('sess-B')
    expect(await post(svc.port, token)).toBe(204)
    expect(hits).toEqual([])
  })
})
