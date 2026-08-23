import { describe, expect, it, vi } from 'vitest'
import type { McpToolResult } from '@erpbridge/sdk'
import { createBrowserMcpSession } from './browser-mcp.js'
import type { BrowserClient, BrowserClientConfig } from './browser-mcp.js'

const envelope = (text: string, isError = false): McpToolResult => ({
  content: [{ type: 'text', text }],
  isError,
})

describe('createBrowserMcpSession', () => {
  it('connects, lists, calls directly and calls the exact-name proxy', async () => {
    const { client } = makeFakeClient()
    const session = createBrowserMcpSession({ baseUrl: 'http://localhost:8080' }, () => client)

    await session.connect()
    expect(await session.listTools()).toEqual([{ name: 'list_employees', inputSchema: { type: 'object' } }])
    const direct = await session.call('list_employees', { page: 1 })
    expect(direct.content[0]).toMatchObject({ type: 'text' })
    const proxy = await session.proxyCall('list_employees', { page: 1 })
    expect(proxy.content[0]).toMatchObject({ text: 'via proxy' })
    await session.close()
    expect(client.mcp.close).toHaveBeenCalledOnce()
  })

  it('forwards transient runtime configuration including an optional bearer token to the factory', async () => {
    const { client } = makeFakeClient()
    const factory = vi.fn(() => client)
    const config: BrowserClientConfig = { baseUrl: 'http://localhost:8080', token: 'runtime-token' }
    const session = createBrowserMcpSession(config, factory)

    await session.connect()
    expect(factory).toHaveBeenCalledExactlyOnceWith(config)
  })

  it('closes and discards the candidate client when connection setup fails', async () => {
    const failed = makeFakeClient({ failConnect: true })
    const healthy = makeFakeClient({})
    const candidates = [failed.client, healthy.client]
    const session = createBrowserMcpSession({ baseUrl: 'http://localhost:8080' }, () => candidates.shift() ?? healthy.client)

    await expect(session.connect()).rejects.toThrow('handshake refused')
    expect(failed.client.mcp.close).toHaveBeenCalledOnce()

    await session.connect()
    expect(healthy.client.mcp.connect).toHaveBeenCalledOnce()
    expect((await session.call('list_employees', {})).content[0]).toMatchObject({ type: 'text' })

    await session.close()
    expect(healthy.client.mcp.close).toHaveBeenCalledOnce()
  })

  it('ignores close failures of discarded clients and surfaces the original connect error', async () => {
    const broken = makeFakeClient({ failConnect: true, failClose: true })
    const session = createBrowserMcpSession({ baseUrl: 'http://localhost:8080' }, () => broken.client)

    await expect(session.connect()).rejects.toThrow('handshake refused')
  })

  it('rejects calls before connect and makes repeated disconnects idempotent', async () => {
    const { client } = makeFakeClient()
    const session = createBrowserMcpSession({ baseUrl: 'http://localhost:8080' }, () => client)

    await expect(session.call('list_employees', {})).rejects.toThrow('MCP session is not connected')
    await session.close()
    await session.close()
    expect(client.mcp.close).not.toHaveBeenCalled()
  })
})

function makeFakeClient(options: { failConnect?: boolean; failClose?: boolean } = {}): { client: BrowserClient } {
  const client: BrowserClient = {
    mcp: {
      connect: vi.fn(async () => {
        if (options.failConnect) throw new Error('handshake refused')
      }),
      listTools: vi.fn(async () => [{ name: 'list_employees', inputSchema: { type: 'object' } }]),
      callTool: vi.fn(async () => envelope('direct result')),
      close: vi.fn(async () => {
        if (options.failClose) throw new Error('close failed')
      }),
    },
    tools: {
      list_employees: vi.fn(async () => envelope('via proxy')),
    },
  }
  return { client }
}
