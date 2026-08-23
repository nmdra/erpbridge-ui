import { useEffect, useMemo, useRef, useState } from 'react'
import type { McpToolResult, ToolDefinition } from '@erpbridge/sdk'
import { createClientMcpSession } from '../lib/browser-mcp-client.js'
import type { BrowserMcpSession } from '../lib/browser-mcp.js'
import { createRootMcpSession } from '../lib/browser-mcp-root.js'

interface McpConsoleProps {
  baseUrl: string
}

export default function McpConsole({ baseUrl }: McpConsoleProps) {
  const [entry, setEntry] = useState<'root' | 'client'>('root')
  const [token, setToken] = useState('')
  const [role, setRole] = useState('')
  const sessionRef = useRef<BrowserMcpSession | null>(null)
  const [connected, setConnected] = useState(false)
  const [busy, setBusy] = useState(false)
  const [tools, setTools] = useState<ToolDefinition[]>([])
  const [toolName, setToolName] = useState('')
  const [argsText, setArgsText] = useState('{}')
  const [result, setResult] = useState<McpToolResult | undefined>(undefined)
  const [error, setError] = useState<string | undefined>()
  const [lastOperation, setLastOperation] = useState('idle')
  const selected = useMemo(() => tools.find((tool) => tool.name === toolName), [tools, toolName])

  useEffect(() => () => {
    void sessionRef.current?.close()
    sessionRef.current = null
    setToken('')
  }, [])

  const forgetToken = () => setToken('')

  const connect = async () => {
    setBusy(true)
    setError(undefined)
    setResult(undefined)
    try {
      await sessionRef.current?.close()
      sessionRef.current = null
      const runtimeToken = token.trim()
      const session = entry === 'root'
        ? createRootMcpSession({ baseUrl, token: runtimeToken || undefined })
        : createClientMcpSession({ baseUrl, token: runtimeToken || undefined })
      await session.connect()
      const discovered = await session.listTools()
      sessionRef.current = session
      setTools(discovered)
      setToolName(discovered[0]?.name ?? '')
      setConnected(true)
      setLastOperation(`connected via @erpbridge/sdk/${entry === 'root' ? '' : 'client'}${runtimeToken ? ' (authenticated)' : ''}`)
    } catch (cause) {
      await sessionRef.current?.close().catch(() => {})
      sessionRef.current = null
      setConnected(false)
      setError(formatError(cause))
      setLastOperation('connect failed')
    } finally {
      setBusy(false)
    }
  }

  const close = async () => {
    await sessionRef.current?.close().catch(() => {})
    sessionRef.current = null
    setConnected(false)
    setTools([])
    forgetToken()
    setLastOperation('closed')
  }

  const run = async (proxy: boolean) => {
    const session = sessionRef.current
    if (!session) return setError('Connect to MCP before calling a tool')
    setBusy(true)
    setError(undefined)
    try {
      const args = parseObject(argsText)
      const selectedRole = role.trim()
      if (selectedRole) args.role = selectedRole
      const started = performance.now()
      const value = proxy ? await session.proxyCall(toolName, args) : await session.call(toolName, args)
      setResult(value)
      setLastOperation(`${proxy ? 'tools proxy' : 'mcp.callTool'} ${toolName}${selectedRole ? ` (role: ${selectedRole})` : ''} (${Math.round(performance.now() - started)}ms)`)
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
        <label>Bearer token (runtime only)
          <input
            data-testid="mcp-token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="Optional; never stored or logged"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            disabled={busy || connected}
          />
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
          <label>MCP role (guarded tools)
            <input
              data-testid="mcp-role"
              value={role}
              onChange={(event) => setRole(event.target.value)}
              placeholder="Sent as arguments.role"
              spellCheck={false}
              disabled={!connected || busy}
            />
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
      {result !== undefined && <EnvelopeView result={result} />}
    </section>
  )
}

function EnvelopeView({ result }: { result: McpToolResult }) {
  const isError = result.isError === true
  const structured = (result as { structuredContent?: unknown }).structuredContent
  return (
    <div data-testid="mcp-result">
      <p className={`envelope-flag ${isError ? 'bad' : 'good'}`} data-testid="mcp-result-kind">
        {isError ? 'MCP execution error (isError)' : 'MCP result envelope'}
      </p>
      <h4 className="envelope-title">content blocks ({result.content.length})</h4>
      {result.content.map((block, index) => (
        block.type === 'text'
          ? <pre key={index} className={`result ${isError ? 'error-text' : ''}`}>{block.text}</pre>
          : <pre key={index} className="result">{formatJson(block)}</pre>
      ))}
      {structured !== undefined && structured !== null && (
        <>
          <h4 className="envelope-title">structuredContent</h4>
          <pre className="result">{formatJson(structured)}</pre>
        </>
      )}
    </div>
  )
}

function parseObject(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Arguments must be a JSON object')
  return value as Record<string, unknown>
}

function formatJson(value: unknown): string { return typeof value === 'string' ? value : JSON.stringify(value, null, 2) }

function formatError(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const value = error as Error & { status?: unknown; requiredScope?: unknown }
  const parts = [`${error.name || 'Error'}: ${error.message}`]
  if (typeof value.status === 'number') parts.push(`HTTP ${value.status}`)
  if (typeof value.requiredScope === 'string') parts.push(`required scope: ${value.requiredScope}`)
  return parts.join(' — ')
}
