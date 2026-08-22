import { createClient } from '@erpbridge/sdk/client'
import { createBrowserMcpSession } from './browser-mcp.js'

export function createClientMcpSession(baseUrl: string) {
  return createBrowserMcpSession(() => createClient({ baseUrl }))
}
