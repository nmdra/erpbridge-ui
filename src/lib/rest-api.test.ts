import { describe, expect, it, vi } from 'vitest'
import { createRestApi } from './rest-api.js'

describe('createRestApi', () => {
  it('calls the BFF and surfaces its safe error payload', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { name: 'NotFoundError', message: 'missing' } }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    }))
    const api = createRestApi(fetcher)

    await expect(api.health()).rejects.toMatchObject({
      name: 'NotFoundError',
      message: 'missing',
      status: 404,
    })
    expect(fetcher).toHaveBeenCalledWith('/api/health', expect.objectContaining({ method: 'GET' }))
  })

  it('serializes invoke arguments as JSON', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ result: { ok: true }, isError: false }), { status: 200 }))
    const api = createRestApi(fetcher)

    await expect(api.invoke('list_employees', { page: 1 })).resolves.toEqual({ result: { ok: true }, isError: false })
    expect(fetcher).toHaveBeenCalledWith('/api/invoke', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'list_employees', args: { page: 1 } }),
    }))
  })

  it('sends an optional role with the invoke body', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ result: { ok: true }, isError: false }), { status: 200 }))
    const api = createRestApi(fetcher)

    await api.invoke('list_employees', {}, { role: 'finance_reader' })
    expect(fetcher).toHaveBeenCalledWith('/api/invoke', expect.objectContaining({
      body: JSON.stringify({ name: 'list_employees', args: {}, role: 'finance_reader' }),
    }))
  })

  it('encodes exact registry filters as query parameters', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }))
    const api = createRestApi(fetcher)

    await api.registryList()
    expect(fetcher).toHaveBeenCalledWith('/api/registry', expect.anything())

    await api.registryList({ name: 'probe_tool' })
    expect(fetcher).toHaveBeenCalledWith('/api/registry?name=probe_tool', expect.anything())

    await api.registryList({ name: 'probe tool', version: '2.0.0' })
    expect(fetcher).toHaveBeenCalledWith('/api/registry?name=probe+tool&version=2.0.0', expect.anything())
  })

  it('surfaces authorization scope metadata from safe error payloads', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      error: { name: 'AuthorizationError', message: 'forbidden', status: 403, requiredScope: 'mcp' },
    }), { status: 403, headers: { 'content-type': 'application/json' } }))
    const api = createRestApi(fetcher)

    await expect(api.health()).rejects.toMatchObject({
      name: 'AuthorizationError',
      status: 403,
      requiredScope: 'mcp',
    })
  })
})
