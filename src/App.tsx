import { useEffect, useMemo, useState } from 'react'
import type { CacheStats, HealthStatus, LogRecord, RegistryTool } from '@erpbridge/sdk'
import McpConsole from './components/McpConsole.js'
import IntegrationRunner from './components/IntegrationRunner.js'
import { createRestApi, type BffApiError, type ParsedMetrics } from './lib/rest-api.js'

export default function App() {
  const baseUrl = import.meta.env.VITE_ERPBRIDGE_BASE_URL ?? 'http://localhost:8080'
  const api = useMemo(() => createRestApi(), [])
  const [health, setHealth] = useState<HealthStatus | undefined>()
  const [logs, setLogs] = useState<LogRecord[]>([])
  const [metricsText, setMetricsText] = useState('')
  const [metrics, setMetrics] = useState<ParsedMetrics | undefined>()
  const [cache, setCache] = useState<CacheStats | undefined>()
  const [registry, setRegistry] = useState<RegistryTool[]>([])
  const [restError, setRestError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [stopStream, setStopStream] = useState<(() => void) | undefined>()
  const [invokeName, setInvokeName] = useState('list_employees')
  const [invokeArgs, setInvokeArgs] = useState('{}')
  const [invokeRole, setInvokeRole] = useState('')
  const [registryText, setRegistryText] = useState('')
  const [restResult, setRestResult] = useState<unknown>()

  useEffect(() => () => stopStream?.(), [stopStream])

  const refresh = async () => {
    setBusy(true)
    setRestError(undefined)
    const failures: string[] = []
    const read = async <T,>(label: string, action: () => Promise<T>, set: (value: T) => void) => {
      try { set(await action()) } catch (error) { failures.push(`${label}: ${formatError(error)}`) }
    }
    await Promise.all([
      read('health', api.health, setHealth),
      read('logs', api.recentLogs, setLogs),
      read('metrics', api.metricsText, setMetricsText),
      read('parsed metrics', api.metricsParsed, setMetrics),
      read('cache', api.cacheStats, setCache),
      read('registry', api.registryList, setRegistry),
    ])
    if (failures.length) setRestError(failures.join('\n'))
    setBusy(false)
  }

  const invoke = async () => {
    setBusy(true)
    setRestError(undefined)
    try {
      const selectedRole = invokeRole.trim()
      const result = await api.invoke(invokeName, parseObject(invokeArgs), selectedRole ? { role: selectedRole } : undefined)
      setRestResult(result)
    } catch (error) { setRestError(formatError(error)) } finally { setBusy(false) }
  }

  const applyRegistry = async () => {
    setBusy(true)
    setRestError(undefined)
    try {
      const result = await api.registryApply(parseObject(registryText) as unknown as RegistryTool)
      setRestResult(result)
      setRegistry(await api.registryList())
    } catch (error) { setRestError(formatError(error)) } finally { setBusy(false) }
  }

  const flush = async () => {
    setBusy(true)
    try { setRestResult(await api.flushCache({ all: true })); setCache(await api.cacheStats()) } catch (error) { setRestError(formatError(error)) } finally { setBusy(false) }
  }

  const toggleStream = () => {
    if (streaming) {
      stopStream?.()
      setStopStream(undefined)
      setStreaming(false)
      return
    }
    const close = api.openLogStream((record) => setLogs((current) => [record, ...current].slice(0, 100)), (error) => setRestError(formatError(error)))
    setStopStream(() => close)
    setStreaming(true)
  }

  return (
    <main className="shell">
      <header className="hero">
        <p className="eyebrow">ERPBridge SDK verification</p>
        <h1>Integration console</h1>
        <p className="lede">Browser MCP/tools use the SDK directly. REST diagnostics use the same SDK through the local Node BFF because ERPBridge REST CORS is intentionally unsupported.</p>
        <div className="connection-bar">
          <span><strong>Server:</strong> {baseUrl}</span>
          <span className={health?.status === 'ok' ? 'status good' : 'status'}>{health?.status ?? 'unknown'}</span>
          <button onClick={refresh} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh REST diagnostics'}</button>
        </div>
      </header>

      <IntegrationRunner baseUrl={baseUrl} api={api} />

      <McpConsole baseUrl={baseUrl} />

      <section className="card" aria-label="REST diagnostics">
        <div className="section-heading"><div><p className="eyebrow">Node BFF</p><h2>REST diagnostics</h2></div><span className="status">same-origin only</span></div>
        <div className="dashboard-grid">
          <Panel title="Health"><pre>{health ? formatJson(health) : 'Not loaded'}</pre></Panel>
          <Panel title="Cache"><pre>{cache ? formatJson(cache) : 'Not loaded'}</pre><button className="secondary" onClick={flush} disabled={busy}>Flush all cache</button></Panel>
          <Panel title="Recent logs"><pre className="tall">{logs.length ? logs.map((log) => JSON.stringify(log)).join('\n') : 'No logs loaded'}</pre><button className="secondary" onClick={toggleStream}>{streaming ? 'Stop log stream' : 'Start log stream'}</button></Panel>
          <Panel title="Parsed metrics"><pre className="tall">{metrics ? formatJson(metrics) : 'Not loaded'}</pre></Panel>
        </div>
        <div className="two-column">
          <div>
            <h3>Direct REST invoke</h3>
            <label>Tool name<input value={invokeName} onChange={(event) => setInvokeName(event.target.value)} /></label>
            <label>Arguments<textarea value={invokeArgs} onChange={(event) => setInvokeArgs(event.target.value)} rows={5} spellCheck={false} /></label>
            <label>Role (guarded tools)<input value={invokeRole} onChange={(event) => setInvokeRole(event.target.value)} placeholder="Sent as X-ERPBridge-Role" spellCheck={false} /></label>
            <button onClick={invoke} disabled={busy}>Invoke through BFF</button>
          </div>
          <div>
            <h3>Registry</h3>
            <p className="muted">{registry.length} registered resources currently visible.</p>
            <pre className="tall">{registry.length ? formatJson(registry) : 'No registry data loaded'}</pre>
            <label>Apply registry JSON<textarea value={registryText} onChange={(event) => setRegistryText(event.target.value)} rows={5} spellCheck={false} placeholder="Paste a RegistryTool resource" /></label>
            <button className="secondary" onClick={applyRegistry} disabled={busy || !registryText}>Apply through BFF</button>
          </div>
        </div>
        <div className="two-column">
          <Panel title="Raw Prometheus text"><pre className="tall">{metricsText || 'Not loaded'}</pre></Panel>
          <Panel title="Last REST result"><pre className="tall">{restResult === undefined ? 'No operation result' : formatJson(restResult)}</pre></Panel>
        </div>
        {restError && <pre className="error" data-testid="rest-error">{restError}</pre>}
      </section>
    </main>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="panel"><h3>{title}</h3>{children}</div>
}

function parseObject(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Arguments must be a JSON object')
  return value as Record<string, unknown>
}

function formatJson(value: unknown): string { return typeof value === 'string' ? value : JSON.stringify(value, null, 2) }
function formatError(error: unknown): string {
  const value = error as Partial<BffApiError> | undefined
  if (value?.name && value.message) {
    const parts = [`${value.name}: ${value.message}`]
    if (value.status) parts.push(`HTTP ${value.status}`)
    if (typeof value.requiredScope === 'string') parts.push(`required scope: ${value.requiredScope}`)
    return parts.join(' — ')
  }
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}
