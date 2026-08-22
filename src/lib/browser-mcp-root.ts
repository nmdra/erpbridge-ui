import { createClient } from '@erpbridge/sdk'
import { createBrowserMcpSession } from './browser-mcp.js'

export function createRootMcpSession(baseUrl: string) {
  return createBrowserMcpSession(() => createClient({ baseUrl }))
}
