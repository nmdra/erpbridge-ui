import { describe, expect, it } from 'vitest'
import { createClientMcpSession } from '../../src/lib/browser-mcp-client.js'
import { createRootMcpSession } from '../../src/lib/browser-mcp-root.js'

const serverUrl = process.env.ERPBRIDGE_TEST_SERVER
const integration = serverUrl ? describe : describe.skip

integration('live browser MCP adapters', () => {
  it.each([
    ['@erpbridge/sdk', createRootMcpSession],
    ['@erpbridge/sdk/client', createClientMcpSession],
  ])('%s connects, calls MCP, and calls the exact-name proxy', async (_entry, createSession) => {
    const preflight = await fetch(`${serverUrl}/mcp/`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://127.0.0.1:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, Mcp-Session-Id, MCP-Protocol-Version',
      },
    })
    expect(preflight.ok).toBe(true)
    expect(preflight.headers.get('access-control-allow-headers')).toContain('MCP-Protocol-Version')
    expect(preflight.headers.get('access-control-expose-headers')).toContain('Mcp-Session-Id')

    const session = createSession(serverUrl!)
    try {
      await session.connect()
      const tools = await session.listTools()
      expect(tools.some((tool) => tool.name === 'list_employees')).toBe(true)

      const direct = await session.call('list_employees', {})
      expect(direct.isError).not.toBe(true)
      expect(JSON.stringify(direct.result)).toContain('Nimal Dharmasiri')

      const proxy = await session.proxyCall('list_employees', {})
      expect(proxy.isError).not.toBe(true)
      expect(JSON.stringify(proxy.result)).toContain('Nimal Dharmasiri')
    } finally {
      await session.close()
    }
  })
})

