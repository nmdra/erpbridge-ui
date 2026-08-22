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
})
