import { BASE_URL } from './infra-config.js'

const deadline = Date.now() + Number(process.env.READY_TIMEOUT_MS ?? 60_000)
let lastError = 'not attempted'
while (Date.now() < deadline) {
  try {
    const response = await fetch(`${BASE_URL}/mcp/health`)
    if (response.ok) {
      const cors = await fetch(`${BASE_URL}/mcp/`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://127.0.0.1:5173',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, Mcp-Session-Id, MCP-Protocol-Version',
        },
      })
      const allowed = cors.headers.get('access-control-allow-headers')?.toLowerCase() ?? ''
      const exposed = cors.headers.get('access-control-expose-headers')?.toLowerCase() ?? ''
      if (!cors.ok || !allowed.includes('mcp-protocol-version') || !exposed.includes('mcp-session-id')) {
        throw new Error('MCP browser CORS headers are incomplete')
      }
      console.log(`ERPBridge ready at ${BASE_URL}`)
      process.exit(0)
    }
    lastError = `HTTP ${response.status}`
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error)
  }
  await new Promise((resolve) => setTimeout(resolve, 1000))
}
throw new Error(`ERPBridge did not become ready: ${lastError}`)
