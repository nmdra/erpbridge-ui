import type { ToolDefinition, ToolResult } from '@erpbridge/sdk'

interface BrowserClient {
  mcp: {
    connect(): Promise<void>
    listTools(): Promise<ToolDefinition[]>
    callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>
    close(): Promise<void>
  }
  tools: Record<string, ((args: Record<string, unknown>) => Promise<ToolResult>) | undefined>
}

export interface BrowserMcpSession {
  connect(): Promise<void>
  listTools(): Promise<ToolDefinition[]>
  call(name: string, args: Record<string, unknown>): Promise<ToolResult>
  proxyCall(name: string, args: Record<string, unknown>): Promise<ToolResult>
  close(): Promise<void>
}

export function createBrowserMcpSession(factory: () => BrowserClient): BrowserMcpSession {
  let client: BrowserClient | undefined

  const requireClient = (): BrowserClient => {
    if (!client) throw new Error('MCP session is not connected')
    return client
  }

  return {
    async connect() {
      client ??= factory()
      await client.mcp.connect()
    },
    listTools: () => requireClient().mcp.listTools(),
    call: (name, args) => requireClient().mcp.callTool(name, args),
    async proxyCall(name, args) {
      const fn = requireClient().tools[name]
      if (!fn) throw new Error(`MCP tool proxy is not available for '${name}'`)
      return fn(args)
    },
    async close() {
      if (!client) return
      const current = client
      client = undefined
      await current.mcp.close()
    },
  }
}
