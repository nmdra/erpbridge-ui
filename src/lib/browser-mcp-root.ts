import { createClient } from '@erpbridge/sdk'
import type { BrowserClientConfig } from './browser-mcp.js'
import { createBrowserMcpSession } from './browser-mcp.js'

export function createRootMcpSession(config: BrowserClientConfig) {
  return createBrowserMcpSession(config, (resolved) => createClient({ baseUrl: resolved.baseUrl, token: resolved.token }))
}
