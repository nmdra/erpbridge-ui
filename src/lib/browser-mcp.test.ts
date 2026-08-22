import { describe, expect, it, vi } from 'vitest'
import { createBrowserMcpSession } from './browser-mcp.js'

describe('createBrowserMcpSession', () => {
  it('connects, lists, calls directly and calls the exact-name proxy', async () => {
    const close = vi.fn(async () => {})
    const client = {
      mcp: {
        connect: vi.fn(async () => {}),
        listTools: vi.fn(async () => [{ name: 'list_employees', inputSchema: { type: 'object' } }]),
        callTool: vi.fn(async (name: string, args: Record<string, unknown>) => ({ result: { name, args }, isError: false })),
        close,
      },
      tools: {
        list_employees: vi.fn(async (args: Record<string, unknown>) => ({ result: { via: 'proxy', args }, isError: false })),
      },
    }
    const session = createBrowserMcpSession(() => client as never)

    await session.connect()
    expect(await session.listTools()).toEqual([{ name: 'list_employees', inputSchema: { type: 'object' } }])
    expect(await session.call('list_employees', { page: 1 })).toMatchObject({ result: { name: 'list_employees' } })
    expect(await session.proxyCall('list_employees', { page: 1 })).toMatchObject({ result: { via: 'proxy' } })
    await session.close()
    expect(close).toHaveBeenCalledOnce()
  })
})
