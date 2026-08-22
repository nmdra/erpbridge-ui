import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startBff, type StartedBff } from '../../server/app.js'

const serverUrl = process.env.ERPBRIDGE_TEST_SERVER
const integration = serverUrl ? describe : describe.skip
let bff: StartedBff

async function request(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${bff.url}${path}`, init)
}

async function json<T>(path: string, init?: RequestInit): Promise<{ response: Response; body: T }> {
  const response = await request(path, init)
  return { response, body: await response.json() as T }
}

integration('live BFF REST surfaces', () => {
  beforeAll(async () => { bff = await startBff({ baseUrl: serverUrl, port: 0 }) })
  afterAll(async () => { await bff?.close() })

  it('forwards health, logs, metrics, cache, and registry reads', async () => {
    const health = await json<{ status: string }>('/api/health')
    expect(health.response.status).toBe(200)
    expect(health.body).toEqual({ status: 'ok' })

    const logs = await json<unknown[]>('/api/logs/recent')
    expect(logs.response.status).toBe(200)
    expect(logs.body.length).toBeGreaterThan(0)

    const rawMetrics = await json<{ text: string }>('/api/metrics/text')
    expect(rawMetrics.response.status).toBe(200)
    expect(rawMetrics.body.text).toContain('mcp_tool_invocations_total')

    const parsedMetrics = await json<{ families: Array<{ name: string }> }>('/api/metrics/parsed')
    expect(parsedMetrics.response.status).toBe(200)
    expect(parsedMetrics.body.families.some((family) => family.name === 'mcp_tool_invocations_total')).toBe(true)

    const cache = await json<{ exactKeys: number; redisMemory: string }>('/api/cache/stats')
    expect(cache.response.status).toBe(200)
    expect(typeof cache.body.exactKeys).toBe('number')

    const registry = await json<unknown[]>('/api/registry')
    expect(registry.response.status).toBe(200)
    expect(registry.body.length).toBeGreaterThan(0)
  })

  it('forwards cache flush and direct invoke', async () => {
    const flushed = await json<{ deleted: number; status: string }>('/api/cache/flush', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ all: true }),
    })
    expect(flushed.response.status).toBe(200)
    expect(flushed.body.status).toBe('ok')

    const invoked = await json<{ result: unknown; isError?: boolean }>('/api/invoke', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'list_employees', args: {} }),
    })
    expect(invoked.response.status).toBe(200)
    expect(invoked.body.isError).not.toBe(true)
    expect(invoked.body.result).toBeDefined()
  })

  it('round-trips a registry resource and hard-deletes it', async () => {
    const name = 'ui_bff_probe'
    const definition = {
      apiVersion: 'erpbridge.io/v1',
      kind: 'Tool',
      metadata: { name, version: '1.0.0', module: 'ui-test' },
      spec: {
        description: { short: 'UI BFF probe' },
        inputSchema: { type: 'object', properties: {} },
        execution: { type: 'http', method: 'GET', endpoint: 'http://localhost:8081/health' },
        security: { authType: 'api-key', credentialRef: 'ERP_PRIMARY_KEY' },
      },
    }
    try {
      const applied = await json<{ status: string; name: string }>('/api/registry', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(definition),
      })
      expect(applied.response.status).toBe(201)
      expect(applied.body).toMatchObject({ status: 'applied', name })

      const listed = await json<Array<{ metadata: { name: string } }>>('/api/registry')
      expect(listed.body.some((tool) => tool.metadata.name === name)).toBe(true)
    } finally {
      const deleted = await request(`/api/registry?name=${name}&version=1.0.0&hard=true`, { method: 'DELETE' })
      expect(deleted.status).toBe(204)
    }
  })

  it('forwards log SSE and preserves typed REST errors', async () => {
    const streamPromise = request('/api/logs/stream')
    const trigger = new Promise<Response>((resolve) => setTimeout(() => resolve(request('/api/invoke', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'list_employees', args: {} }),
    })), 300))
    const stream = await streamPromise
    expect(stream.status).toBe(200)
    expect(stream.headers.get('content-type')).toContain('text/event-stream')
    const reader = stream.body?.getReader()
    expect(reader).toBeDefined()
    const first = await reader!.read()
    await trigger
    expect(new TextDecoder().decode(first.value)).toContain('data:')
    await reader!.cancel()

    const unknown = await json<{ error: { name: string; status: number } }>('/api/invoke', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'does_not_exist', args: {} }),
    })
    expect(unknown.response.status).toBe(404)
    expect(unknown.body.error).toMatchObject({ name: 'NotFoundError', status: 404 })

    const invalid = await json<{ error: { name: string; status: number } }>('/api/invoke', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'list_employees', args: [] }),
    })
    expect(invalid.response.status).toBe(400)
    expect(invalid.body.error).toMatchObject({ name: 'InputError', status: 400 })
  })
})
