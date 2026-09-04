import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'

export interface HookService {
  port: number
  register(sessionId: string): string
  unregister(sessionId: string): void
  close(): Promise<void>
}

export async function createHookService(o: {
  onHook: (sessionId: string) => void
}): Promise<HookService> {
  const tokenToSession = new Map<string, string>()
  const sessionToToken = new Map<string, string>()

  const server: Server = createServer((req, res) => {
    // Always drain + 204, no matter what. A hook must never block the agent.
    req.resume()
    req.on('end', () => {
      const token = req.headers['x-workphlo-hook-token']
      const sessionId = typeof token === 'string' ? tokenToSession.get(token) : undefined
      if (req.method === 'POST' && sessionId) {
        try {
          o.onHook(sessionId)
        } catch {
          /* fail open */
        }
      }
      res.statusCode = 204
      res.end()
    })
    req.on('error', () => {
      res.statusCode = 204
      res.end()
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0

  return {
    port,
    register(sessionId) {
      const token = randomUUID()
      tokenToSession.set(token, sessionId)
      sessionToToken.set(sessionId, token)
      return token
    },
    unregister(sessionId) {
      const token = sessionToToken.get(sessionId)
      if (token) tokenToSession.delete(token)
      sessionToToken.delete(sessionId)
    },
    close() {
      return new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}
