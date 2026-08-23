import { describe, expect, it } from 'vitest'
import { createClientMcpSession } from '../../src/lib/browser-mcp-client.js'
import { createRootMcpSession } from '../../src/lib/browser-mcp-root.js'

const serverUrl = process.env.ERPBRIDGE_TEST_SERVER
const authToken = process.env.ERPBRIDGE_TEST_TOKEN
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

    const session = createSession({ baseUrl: serverUrl! })
    try {
      await session.connect()
      const tools = await session.listTools()
      expect(tools.some((tool) => tool.name === 'list_employees')).toBe(true)

      const direct = await session.call('list_employees', {})
      expect(direct.isError).not.toBe(true)
      expect(direct.content.length).toBeGreaterThan(0)
      expect(textOf(direct)).toContain('Nimal Dharmasiri')

      const proxy = await session.proxyCall('list_employees', {})
      expect(proxy.isError).not.toBe(true)
      expect(textOf(proxy)).toContain('Nimal Dharmasiri')
    } finally {
      await session.close()
    }
  })
})

const authenticated = serverUrl && authToken ? describe : describe.skip

authenticated('authenticated live browser MCP adapters', () => {
  it.each([
    ['@erpbridge/sdk', createRootMcpSession],
    ['@erpbridge/sdk/client', createClientMcpSession],
  ])('%s connects and calls with a transient bearer token', async (_entry, createSession) => {
    const session = createSession({ baseUrl: serverUrl!, token: authToken! })
    try {
      await session.connect()
      const tools = await session.listTools()
      expect(tools.some((tool) => tool.name === 'list_employees')).toBe(true)

      const direct = await session.call('list_employees', {})
      expect(direct.isError).not.toBe(true)
      expect(textOf(direct)).toContain('Nimal Dharmasiri')
    } finally {
      await session.close()
    }
  })

  it('rejects an invalid bearer token with a typed authentication error', async () => {
    const session = createRootMcpSession({ baseUrl: serverUrl!, token: 'definitely-not-a-valid-token' })
    await expect(session.connect()).rejects.toMatchObject({ name: 'AuthenticationError' })
  })
})

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('\n')
}
