import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ErpbridgeClient } from '@erpbridge/sdk'
import { sdkAuthFromEnvironment, startBff } from './app.js'
import type { EnvironmentController } from './environment.js'

let server: Server | undefined
let closeBff: (() => Promise<void>) | undefined

afterEach(async () => {
  await closeBff?.()
  closeBff = undefined
  server = undefined
})

describe('BFF credential configuration', () => {
  it('builds SDK auth exclusively from documented environment variables', () => {
    expect(sdkAuthFromEnvironment({})).toEqual({})
    expect(sdkAuthFromEnvironment({ ERPBRIDGE_TOKEN: 'global' })).toEqual({ token: 'global' })
    expect(sdkAuthFromEnvironment({ ERPBRIDGE_LOGS_TOKEN: 'logs' })).toEqual({ auth: { logs: { token: 'logs' } } })
    expect(sdkAuthFromEnvironment({ ERPBRIDGE_METRICS_TOKEN: 'metrics' })).toEqual({ auth: { metrics: { token: 'metrics' } } })
    expect(sdkAuthFromEnvironment({ ERPBRIDGE_TOKEN: 'g', ERPBRIDGE_LOGS_TOKEN: 'l', ERPBRIDGE_METRICS_TOKEN: 'm' })).toEqual({
      token: 'g',
      auth: { logs: { token: 'l' }, metrics: { token: 'm' } },
    })
  })
})

describe('BFF REST surface', () => {
  it('forwards health and invoke operations through the SDK seam', async () => {
    const client = fakeClient()
    const started = await startBff({ client, port: 0 })
    server = started.server
    closeBff = started.close

    const health = await fetch(`${started.url}/api/health`)
    expect(await health.json()).toEqual({ status: 'ok' })

    const invoke = await fetch(`${started.url}/api/invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'list_employees', args: { page: 1 } }),
    })
    expect(await invoke.json()).toEqual({ result: { ok: true, name: 'list_employees', args: { page: 1 } }, isError: false })
    expect(client.invoke).toHaveBeenCalledExactlyOnceWith('list_employees', { page: 1 }, undefined)
  })

  it('forwards an optional role as the SDK direct-invoke option', async () => {
    const client = fakeClient()
    const started = await startBff({ client, port: 0 })
    server = started.server
    closeBff = started.close

    const invoke = await fetch(`${started.url}/api/invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'list_employees', args: {}, role: 'finance_reader' }),
    })
    expect(invoke.status).toBe(200)
    expect(client.invoke).toHaveBeenCalledExactlyOnceWith('list_employees', {}, { role: 'finance_reader' })

    const invalid = await fetch(`${started.url}/api/invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'list_employees', args: {}, role: 'BAD ROLE!' }),
    })
    expect(invalid.status).toBe(400)
    expect(((await invalid.json()) as { error: { name: string } }).error.name).toBe('InputError')
  })

  it('encodes exact registry filters into the SDK list options', async () => {
    const client = fakeClient()
    const started = await startBff({ client, port: 0 })
    server = started.server
    closeBff = started.close

    await fetch(`${started.url}/api/registry`)
    expect(client.registry.list).toHaveBeenLastCalledWith({ name: undefined, version: undefined })

    await fetch(`${started.url}/api/registry?name=probe_tool&version=2.0.0`)
    expect(client.registry.list).toHaveBeenLastCalledWith({ name: 'probe_tool', version: '2.0.0' })
  })

  it('returns sanitized 401/403 typed errors without echoing credentials', async () => {
    const client = fakeClient()
    client.health = async () => {
      throw Object.assign(new Error('MCP request was unauthorized'), {
        name: 'AuthenticationError',
        status: 401,
        hint: 'Bearer realm="erpbridge", scope="logs"',
        wwwAuthenticate: 'Bearer realm="erpbridge", scope="logs"',
        body: { authorization: 'Bearer super-secret-token-value' },
      })
    }
    client.invoke = async () => {
      throw Object.assign(new Error('credential is not authorized for mcp'), {
        name: 'AuthorizationError',
        status: 403,
        requiredScope: 'mcp',
      })
    }
    const started = await startBff({ client, port: 0 })
    server = started.server
    closeBff = started.close

    const unauthorized = await fetch(`${started.url}/api/health`)
    expect(unauthorized.status).toBe(401)
    const unauthorizedBody = await unauthorized.json() as { error: Record<string, unknown> }
    expect(unauthorizedBody.error).toMatchObject({ name: 'AuthenticationError', status: 401 })
    expect(JSON.stringify(unauthorizedBody)).not.toContain('super-secret-token-value')

    const forbidden = await fetch(`${started.url}/api/invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'list_employees', args: {} }),
    })
    expect(forbidden.status).toBe(403)
    expect(await forbidden.json()).toMatchObject({
      error: { name: 'AuthorizationError', status: 403, requiredScope: 'mcp' },
    })
  })

  it('returns safe typed error metadata and redacts bodies', async () => {
    const client = fakeClient()
    client.registry.apply = async () => {
      throw Object.assign(new Error('admission failed'), {
        name: 'ClientError',
        status: 422,
        body: { error: 'invalid', credentialRef: 'ERP_PRIMARY_KEY' },
      })
    }
    const started = await startBff({ client, port: 0 })
    server = started.server
    closeBff = started.close

    const response = await fetch(`${started.url}/api/registry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiVersion: 'erpbridge.io/v1' }),
    })
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      error: {
        name: 'ClientError',
        status: 422,
        body: { credentialRef: '[REDACTED]' },
      },
    })
  })

  it('exposes environment status and guarded lifecycle controls', async () => {
    const environment: EnvironmentController = {
      status: async () => ({ baseUrl: 'http://localhost:8080', localOnly: true, reachable: true, ready: true, cors: true, busy: false }),
      start: async () => ({ status: 'ready', stages: [{ name: 'validate', status: 'passed' }] }),
      stop: async (confirmation) => {
        if (confirmation !== 'STOP_LOCAL_ENVIRONMENT') throw Object.assign(new Error('confirmation required'), { name: 'InputError', status: 400 })
        return { status: 'stopped', stages: [{ name: 'validate', status: 'passed' }] }
      },
    }
    const started = await startBff({ client: fakeClient(), environment, port: 0 })
    server = started.server
    closeBff = started.close

    await expect(fetch(`${started.url}/api/environment/status`).then((response) => response.json())).resolves.toMatchObject({ ready: true, localOnly: true })
    await expect(fetch(`${started.url}/api/environment/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((response) => response.json())).resolves.toMatchObject({ status: 'ready' })
    const stop = await fetch(`${started.url}/api/environment/stop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: 'wrong' }) })
    expect(stop.status).toBe(400)
  })
})

function fakeClient(): ErpbridgeClient {
  return {
    mcp: {} as ErpbridgeClient['mcp'],
    tools: {},
    registry: {
      list: vi.fn(async () => []),
      apply: async () => ({ status: 'applied', name: 'probe', version: '1.0.0' }),
      delete: async () => {},
      invoke: async (name, args) => ({ result: { ok: true, name, args }, isError: false }),
    },
    invoke: vi.fn(async (name, args) => ({ result: { ok: true, name, args }, isError: false })),
    logs: {
      recent: async () => [],
      stream: async function* () {},
    },
    metrics: { text: async () => '', parsed: async () => ({ families: [], skipped: [] }) },
    health: async () => ({ status: 'ok' }),
    cache: {
      stats: async () => ({ exactKeys: 0, redisMemory: '0B' }),
      flush: async () => ({ deleted: 0, status: 'ok' }),
    },
    close: async () => {},
  }
}
