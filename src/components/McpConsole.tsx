import { useMemo, useRef, useState } from 'react'
import type { ToolDefinition } from '@erpbridge/sdk'
import { createClientMcpSession } from '../lib/browser-mcp-client.js'
import type { BrowserMcpSession } from '../lib/browser-mcp.js'
import { createRootMcpSession } from '../lib/browser-mcp-root.js'

interface McpConsoleProps {
  baseUrl: string
}

export default function McpConsole({ baseUrl }: McpConsoleProps) {
  const [entry, setEntry] = useState<'root' | 'client'>('root')
  const sessionRef = useRef<BrowserMcpSession | null>(null)
  const [connected, setConnected] = useState(false)
  const [busy, setBusy] = useState(false)
  const [tools, setTools] = useState<ToolDefinition[]>([])
  const [toolName, setToolName] = useState('')
  const [argsText, setArgsText] = useState('{}')
  const [result, setResult] = useState<unknown>(undefined)
  const [error, setError] = useState<string | undefined>()
  const [lastOperation, setLastOperation] = useState('idle')
  const selected = useMemo(() => tools.find((tool) => tool.name === toolName), [tools, toolName])

  const connect = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await sessionRef.current?.close()
      const session = entry === 'root' ? createRootMcpSession(baseUrl) : createClientMcpSession(baseUrl)
      await session.connect()
      const discovered = await session.listTools()
      sessionRef.current = session
      setTools(discovered)
      setToolName(discovered[0]?.name ?? '')
      setConnected(true)
      setLastOperation(`connected via @erpbridge/sdk/${entry === 'root' ? '' : 'client'}`)
    } catch (cause) {
      setConnected(false)
      setError(formatError(cause))
      await sessionRef.current?.close()
      sessionRef.current = null
    } finally {
      setBusy(false)
    }
  }

  const close = async () => {
    await sessionRef.current?.close()
    sessionRef.current = null
    setConnected(false)
    setTools([])
    setLastOperation('closed')
  }

  const run = async (proxy: boolean) => {
    const session = sessionRef.current
    if (!session) return setError('Connect to MCP before calling a tool')
    setBusy(true)
    setError(undefined)
    try {
      const args = parseObject(argsText)
      const started = performance.now()
      const value = proxy ? await session.proxyCall(toolName, args) : await session.call(toolName, args)
      setResult(value)
      setLastOperation(`${proxy ? 'tools proxy' : 'mcp.callTool'} ${toolName} (${Math.round(performance.now() - started)}ms)`)
    } catch (cause) {
      setError(formatError(cause))
      setLastOperation(`failed ${proxy ? 'tools proxy' : 'mcp.callTool'} ${toolName}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card" aria-label="MCP browser console">
      <div className="section-heading">
        <div><p className="eyebrow">Browser SDK</p><h2>MCP and exact-name tools</h2></div>
        <span className={connected ? 'status good' : 'status'}>{connected ? 'connected' : 'disconnected'}</span>
      </div>
      <div className="control-grid">
        <label>SDK entry
          <select value={entry} onChange={(event) => setEntry(event.target.value as 'root' | 'client')} disabled={busy || connected}>
            <option value="root">@erpbridge/sdk</option>
            <option value="client">@erpbridge/sdk/client</option>
          </select>
        </label>
        <div className="button-row">
          <button onClick={connect} disabled={busy || connected}>Connect and list tools</button>
          <button className="secondary" onClick={close} disabled={busy || !connected}>Close session</button>
        </div>
      </div>
      <div className="mcp-workbench">
        <div>
          <label>Discovered tool
            <select data-testid="mcp-tool-select" value={toolName} onChange={(event) => setToolName(event.target.value)} disabled={!connected || busy}>
              {tools.map((tool) => <option key={tool.name} value={tool.name}>{tool.name}</option>)}
            </select>
          </label>
          <p className="muted">{selected?.description ?? 'No description returned.'}</p>
          <pre className="schema">{selected ? formatJson(selected.inputSchema) : 'Connect to discover tool schemas.'}</pre>
        </div>
        <div>
          <label>JSON arguments
            <textarea data-testid="mcp-args" value={argsText} onChange={(event) => setArgsText(event.target.value)} rows={8} spellCheck={false} />
          </label>
          <div className="button-row">
            <button onClick={() => run(false)} disabled={!connected || busy || !toolName}>Call with mcp.callTool</button>
            <button className="secondary" onClick={() => run(true)} disabled={!connected || busy || !toolName}>Call with tools proxy</button>
          </div>
        </div>
      </div>
      <p className="operation" data-testid="mcp-operation">{lastOperation}</p>
      {error && <pre className="error" data-testid="mcp-error">{error}</pre>}
      {result !== undefined && <pre className="result" data-testid="mcp-result">{formatJson(result)}</pre>}
    </section>
  )
}

function parseObject(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Arguments must be a JSON object')
  return value as Record<string, unknown>
}

function formatJson(value: unknown): string { return typeof value === 'string' ? value : JSON.stringify(value, null, 2) }
function formatError(error: unknown): string { return error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
