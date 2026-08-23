import type { McpToolResult, ToolDefinition } from '@erpbridge/sdk'

/** Transient runtime configuration for a browser MCP session. */
export interface BrowserClientConfig {
  /** ERPBridge base URL. */
  baseUrl: string
  /**
   * Optional bearer token for authenticated MCP calls.
   * Runtime input only; never persisted by the console.
   */
  token?: string
}

export interface BrowserClient {
  mcp: {
    connect(): Promise<void>
    listTools(): Promise<ToolDefinition[]>
    callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>
    close(): Promise<void>
  }
  tools: Record<string, ((args?: Record<string, unknown>) => Promise<McpToolResult>) | undefined>
}

export interface BrowserMcpSession {
  connect(): Promise<void>
  listTools(): Promise<ToolDefinition[]>
  call(name: string, args: Record<string, unknown>): Promise<McpToolResult>
  proxyCall(name: string, args: Record<string, unknown>): Promise<McpToolResult>
  close(): Promise<void>
}

export function createBrowserMcpSession(config: BrowserClientConfig, factory: (config: BrowserClientConfig) => BrowserClient): BrowserMcpSession {
  let client: BrowserClient | undefined

  const requireClient = (): BrowserClient => {
    if (!client) throw new Error('MCP session is not connected')
    return client
  }

  const discard = async (target: BrowserClient): Promise<void> => {
    try {
      await target.mcp.close()
    } catch {
      // Closing a half-open client is best-effort cleanup; the original error matters more.
    }
  }

  return {
    async connect() {
      if (client) return
      const candidate = factory(config)
      try {
        await candidate.mcp.connect()
      } catch (error) {
        await discard(candidate)
        throw error
      }
      client = candidate
    },
    async listTools() {
      return requireClient().mcp.listTools()
    },
    async call(name, args) {
      return requireClient().mcp.callTool(name, args)
    },
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
