import { describe, expect, it, vi } from 'vitest'
import { createEnvironmentController, LOCAL_STOP_CONFIRMATION } from './environment.js'

function fetcher(_input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (init?.method === 'OPTIONS') {
    return Promise.resolve(new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-headers': 'Content-Type, MCP-Protocol-Version',
        'access-control-expose-headers': 'Mcp-Session-Id',
      },
    }))
  }
  return Promise.resolve(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
}

describe('environment controller', () => {
  it('reports readiness and the MCP CORS contract', async () => {
    const controller = createEnvironmentController({ baseUrl: 'http://localhost:8080', fetcher })
    await expect(controller.status()).resolves.toMatchObject({
      localOnly: true,
      reachable: true,
      ready: true,
      cors: true,
      healthStatus: 200,
    })
  })

  it('rejects non-loopback targets before checking or changing anything', async () => {
    const runner = vi.fn(async () => {})
    const controller = createEnvironmentController({ baseUrl: 'https://erp.example.test', commandRunner: runner })
    await expect(controller.status()).rejects.toMatchObject({ name: 'InputError', status: 400 })
    await expect(controller.start()).rejects.toMatchObject({ name: 'InputError', status: 400 })
    expect(runner).not.toHaveBeenCalled()
  })

  it('runs startup stages and requires explicit teardown confirmation', async () => {
    const scripts: string[] = []
    const runner = vi.fn(async (script: string) => { scripts.push(script) })
    const controller = createEnvironmentController({ commandRunner: runner })
    await expect(controller.start()).resolves.toMatchObject({
      status: 'ready',
      stages: [
        { name: 'validate', status: 'passed' },
        { name: 'compose-up', status: 'passed' },
        { name: 'ready', status: 'passed' },
        { name: 'seed', status: 'passed' },
      ],
    })
    expect(scripts).toEqual(['infra-up.ts', 'infra-ready.ts', 'seed-tools.ts'])
    await expect(controller.stop('no')).rejects.toMatchObject({ name: 'InputError', status: 400 })
    await expect(controller.stop(LOCAL_STOP_CONFIRMATION)).resolves.toMatchObject({ status: 'stopped' })
    expect(scripts.at(-1)).toBe('infra-down.ts')
  })
})
