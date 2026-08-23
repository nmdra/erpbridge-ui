import { createClient } from '@erpbridge/sdk/client'
import type { BrowserClientConfig } from './browser-mcp.js'
import { createBrowserMcpSession } from './browser-mcp.js'

export function createClientMcpSession(config: BrowserClientConfig) {
  return createBrowserMcpSession(config, (resolved) => createClient({ baseUrl: resolved.baseUrl, token: resolved.token }))
}
