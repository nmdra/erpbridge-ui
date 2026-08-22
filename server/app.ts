import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createClient, type ErpbridgeClient, type RegistryTool, type ToolCallArguments } from '@erpbridge/sdk'
import { toSafeError } from './error-response.js'
import { createEnvironmentController, type EnvironmentController } from './environment.js'

export interface StartBffOptions {
  client?: ErpbridgeClient
  environment?: EnvironmentController
  baseUrl?: string
  host?: string
  port?: number
}

export interface StartedBff {
  server: Server
  url: string
  close: () => Promise<void>
}

export function createBffHandler(client: ErpbridgeClient, environment = createEnvironmentController()) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://bff.local')
    try {
      if (req.method === 'GET' && url.pathname === '/api/health') return sendJson(res, 200, await client.health())
      if (req.method === 'GET' && url.pathname === '/api/logs/recent') return sendJson(res, 200, await client.logs.recent())
      if (req.method === 'GET' && url.pathname === '/api/metrics/text') return sendJson(res, 200, { text: await client.metrics.text() })
      if (req.method === 'GET' && url.pathname === '/api/metrics/parsed') return sendJson(res, 200, await client.metrics.parsed())
      if (req.method === 'GET' && url.pathname === '/api/cache/stats') return sendJson(res, 200, await client.cache.stats())
      if (req.method === 'GET' && url.pathname === '/api/registry') return sendJson(res, 200, await client.registry.list())

      if (req.method === 'GET' && url.pathname === '/api/environment/status') {
        return sendJson(res, 200, await environment.status())
      }

      if (req.method === 'POST' && url.pathname === '/api/environment/start') {
        await readObject(req)
        return sendJson(res, 200, await environment.start())
      }

      if (req.method === 'POST' && url.pathname === '/api/environment/stop') {
        const body = await readObject(req)
        const confirmation = body.confirmation
        if (typeof confirmation !== 'string') throw inputError('confirmation is required')
        return sendJson(res, 200, await environment.stop(confirmation))
      }

      if (req.method === 'GET' && url.pathname === '/api/logs/stream') {
        return streamLogs(req, res, client)
      }

      if (req.method === 'POST' && url.pathname === '/api/cache/flush') {
        return sendJson(res, 200, await client.cache.flush(await readObject(req)))
      }
      if (req.method === 'POST' && url.pathname === '/api/registry') {
        return sendJson(res, 201, await client.registry.apply(await readObject(req) as unknown as RegistryTool))
      }
      if (req.method === 'POST' && url.pathname === '/api/invoke') {
        const body = await readObject(req)
        const name = body.name
        if (typeof name !== 'string' || name.length === 0) throw inputError('name must be a non-empty string')
        const args = body.args
        if (args !== undefined && !isArguments(args)) throw inputError('args must be a JSON object')
        return sendJson(res, 200, await client.invoke(name, args ?? {}))
      }
      if (req.method === 'DELETE' && url.pathname === '/api/registry') {
        const name = url.searchParams.get('name')
        const version = url.searchParams.get('version')
        if (!name || !version) throw inputError('name and version query parameters are required')
        await client.registry.delete(name, version, { hard: url.searchParams.get('hard') === 'true' })
        res.writeHead(204)
        res.end()
        return
      }

      sendJson(res, 404, { error: { name: 'NotFoundError', message: `BFF route not found: ${req.method} ${url.pathname}` } })
    } catch (error) {
      const safe = toSafeError(error)
      sendJson(res, safe.status ?? (safe.name === 'InputError' ? 400 : 500), { error: safe })
    }
  }
}

export async function startBff(options: StartBffOptions = {}): Promise<StartedBff> {
  const baseUrl = options.baseUrl ?? process.env.ERPBRIDGE_BASE_URL ?? 'http://localhost:8080'
  const client = options.client ?? createClient({ baseUrl })
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? Number(process.env.BFF_PORT ?? 8787)
  const server = createServer(createBffHandler(client, options.environment ?? createEnvironmentController({ baseUrl })))
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('BFF did not expose a TCP address')
  const url = `http://${host}:${address.port}`
  return {
    server,
    url,
    close: async () => {
      await client.close()
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    },
  }
}

async function streamLogs(req: IncomingMessage, res: ServerResponse, client: ErpbridgeClient): Promise<void> {
  const controller = new AbortController()
  req.on('close', () => controller.abort())
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  try {
    for await (const record of client.logs.stream({ signal: controller.signal })) {
      if (res.destroyed) break
      res.write(`data: ${JSON.stringify(record)}\n\n`)
    }
  } catch (error) {
    if (!controller.signal.aborted && !res.destroyed) res.write(`event: error\ndata: ${JSON.stringify(toSafeError(error))}\n\n`)
  } finally {
    if (!res.destroyed) res.end()
  }
}

async function readObject(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  if (chunks.length === 0) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw inputError('request body must be valid JSON')
  }
  if (!isArguments(parsed)) throw inputError('request body must be a JSON object')
  return parsed
}

function isArguments(value: unknown): value is ToolCallArguments {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function inputError(message: string): Error {
  return Object.assign(new Error(message), { name: 'InputError', status: 400 })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return
  const serialized = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(serialized)
}
