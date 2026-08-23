import type { McpToolResult, RegistryTool, ToolResult } from '@erpbridge/sdk'
import { createClientMcpSession } from './browser-mcp-client.js'
import type { BrowserClientConfig, BrowserMcpSession } from './browser-mcp.js'
import { createRootMcpSession } from './browser-mcp-root.js'
import type { RestApi } from './rest-api.js'

export type CheckStatus = 'queued' | 'running' | 'passed' | 'failed' | 'skipped'

export interface CheckEvidence {
  expected: string
  actual: string
  details?: Record<string, unknown>
}

export interface CheckResult {
  id: string
  label: string
  suite: string
  mutates: boolean
  status: Exclude<CheckStatus, 'queued' | 'running'>
  durationMs: number
  evidence?: CheckEvidence
  error?: { name: string; message: string; status?: number }
}

export interface IntegrationCheckContext {
  baseUrl: string
  api: RestApi
  fetcher?: typeof fetch
}

export interface IntegrationCheck {
  id: string
  label: string
  suite: string
  description: string
  mutates: boolean
  run(context: IntegrationCheckContext): Promise<CheckEvidence>
}

export function createIntegrationChecks(): IntegrationCheck[] {
  return [
    {
      id: 'environment-ready',
      label: 'Environment is reachable and ready',
      suite: 'Environment',
      description: 'Checks the loopback target, ERPBridge health, and browser MCP CORS contract.',
      mutates: false,
      async run({ api }) {
        const status = await api.environmentStatus()
        if (!status.localOnly) throw new Error('Target was not classified as local-only')
        if (!status.reachable || !status.ready) throw new Error(`ERPBridge is not ready (HTTP ${status.healthStatus ?? 'unreachable'})`)
        if (!status.cors) throw new Error('MCP browser CORS headers are incomplete')
        return {
          expected: 'Loopback ERPBridge is ready and browser MCP CORS is complete',
          actual: `Ready at ${status.baseUrl}`,
          details: { healthStatus: status.healthStatus, cors: status.cors },
        }
      },
    },
    {
      id: 'mcp-cors',
      label: 'MCP preflight exposes protocol headers',
      suite: 'MCP',
      description: 'Sends a cross-origin MCP initialize and verifies Mcp-Session-Id stays readable for session continuation.',
      mutates: false,
      async run({ baseUrl, fetcher = globalThis.fetch }) {
        // Browsers strip manually set Origin/Access-Control-Request-* headers
        // (forbidden list) and hide CORS meta-headers on responses, so neither
        // a synthesized OPTIONS nor reading Access-Control-* works there. A
        // JSON POST makes the user agent run its own preflight; if it passes,
        // the session id is readable exactly when the server exposes it.
        let response: Response
        try {
          response = await fetcher(`${baseUrl.replace(/\/$/, '')}/mcp/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'initialize',
              params: {
                protocolVersion: '2025-06-18',
                capabilities: {},
                clientInfo: { name: 'erpbridge-ui-preflight-check', version: '1.0.0' },
              },
            }),
          })
        } catch {
          throw new Error('Cross-origin MCP initialize failed before a response was readable (CORS or network failure)')
        }
        if (!response.ok) throw new Error(`MCP initialize returned HTTP ${response.status}`)
        const sessionId = response.headers.get('mcp-session-id')
        if (!sessionId) throw new Error('MCP initialize did not return a readable Mcp-Session-Id; session continuation would fail')
        return { expected: 'Cross-origin MCP initialize passes preflight and returns a readable Mcp-Session-Id', actual: 'CORS contract passed' }
      },
    },
    makeMcpCheck('mcp-root', '@erpbridge/sdk', createRootMcpSession),
    makeMcpCheck('mcp-client', '@erpbridge/sdk/client', createClientMcpSession),    {
      id: 'rest-health',
      label: 'REST health through the BFF',
      suite: 'REST/BFF',
      description: 'Confirms the browser uses the same-origin BFF for REST health.',
      mutates: false,
      async run({ api }) {
        const health = await api.health()
        if (health.status !== 'ok') throw new Error(`Unexpected health status: ${health.status}`)
        return { expected: 'HTTP 200 with status ok', actual: 'REST health passed', details: health }
      },
    },
    {
      id: 'rest-invoke',
      label: 'REST tool invoke through the BFF',
      suite: 'REST/BFF',
      description: 'Invokes the seeded probe tool through the Node SDK facade.',
      mutates: false,
    async run({ api }) {
      const result = await api.invoke('list_employees', {})
      assertRestToolSuccess(result)
      return { expected: 'Tool invocation succeeds without an MCP tool error', actual: 'REST invoke passed' }
    },
  },
    {
      id: 'rest-errors',
      label: 'Typed REST errors are preserved',
      suite: 'REST/BFF',
      description: 'Checks unknown-tool and invalid-argument responses without leaking secrets.',
      mutates: false,
      async run({ api }) {
        const unknown = await expectFailure(() => api.invoke('does_not_exist', {}))
        if (unknown.status !== 404) throw new Error(`Unknown tool returned HTTP ${unknown.status ?? 'unknown'}`)
        const invalid = await expectFailure(() => api.invoke('list_employees', [] as unknown as Record<string, unknown>))
        if (invalid.status !== 400) throw new Error(`Invalid args returned HTTP ${invalid.status ?? 'unknown'}`)
        return { expected: 'Unknown tool is 404 and invalid arguments are 400', actual: 'Typed REST errors passed' }
      },
    },
    {
      id: 'logs-stream',
      label: 'Recent logs and SSE stream',
      suite: 'Operations',
      description: 'Reads recent logs and confirms the stream emits an event after a probe invoke.',
      mutates: false,
      async run({ api }) {
        const logs = await api.recentLogs()
        const response = await fetch('/api/logs/stream')
        if (!response.ok || !response.body) throw new Error(`Log stream returned HTTP ${response.status}`)
        const reader = response.body.getReader()
        const firstEvent = reader.read()
        await api.invoke('list_employees', {})
        const first = await withTimeout(firstEvent, 5_000, 'Timed out waiting for a log event')
        await reader.cancel()
        if (!new TextDecoder().decode(first.value).includes('data:')) throw new Error('Log stream did not emit an SSE data event')
        return { expected: 'Recent logs readable and SSE emits data', actual: 'Log surfaces passed', details: { recentCount: logs.length } }
      },
    },
    {
      id: 'metrics',
      label: 'Raw and parsed metrics',
      suite: 'Operations',
      description: 'Checks Prometheus text and parsed metric families.',
      mutates: false,
      async run({ api }) {
        // Fresh servers register invocation counters lazily; one read-only
        // probe guarantees the families exist before asserting.
        await api.invoke('list_employees', {})
        const [text, parsed] = await Promise.all([api.metricsText(), api.metricsParsed()])
        if (!text.includes('mcp_tool_invocations_total')) throw new Error('Expected MCP invocation metric was not found')
        if (!parsed.families.some((family) => family.name === 'mcp_tool_invocations_total')) throw new Error('Parsed metric family was not found')
        return { expected: 'Raw and parsed MCP invocation metrics are present', actual: 'Metrics passed', details: { familyCount: parsed.families.length } }
      },
    },
    {
      id: 'cache-stats',
      label: 'Cache statistics',
      suite: 'Operations',
      description: 'Reads cache statistics without changing cache state.',
      mutates: false,
      async run({ api }) {
        const stats = await api.cacheStats()
        if (typeof stats.exactKeys !== 'number') throw new Error('Cache exact key count was not numeric')
        return { expected: 'Cache stats contain a numeric exact key count', actual: 'Cache stats passed', details: stats }
      },
    },
    {
      id: 'registry-read',
      label: 'Registry listing',
      suite: 'Registry',
      description: 'Reads registered resources through the BFF.',
      mutates: false,
      async run({ api }) {
        const registry = await api.registryList()
        if (!registry.some((tool) => tool.metadata?.name === 'list_employees')) throw new Error('Seeded list_employees resource was not found')
        if (registry.some((tool) => tool.kind !== 'MCPTool')) throw new Error('Registry returned a resource that is not kind MCPTool')
        return { expected: 'Seeded registry resource is visible', actual: 'Registry read passed', details: { count: registry.length } }
      },
    },
    {
      id: 'registry-filter',
      label: 'Registry exact-name filter',
      suite: 'Registry',
      description: 'Filters the registry listing by exact name and version.',
      mutates: false,
      async run({ api }) {
        const all = await api.registryList()
        const filtered = await api.registryList({ name: 'list_employees', version: '1.0.0' })
        if (filtered.length === 0 || !filtered.every((tool) => tool.metadata?.name === 'list_employees' && tool.metadata?.version === '1.0.0')) {
          throw new Error('Exact name/version filter did not return only list_employees@1.0.0 entries')
        }
        if (filtered.length > all.length) throw new Error('Filtered registry listing exceeded the unfiltered listing')
        return {
          expected: 'Exact filters narrow the registry to matching resources only',
          actual: `Filter matched ${filtered.length}/${all.length} resources`,
          details: { total: all.length, matched: filtered.length },
        }
      },
    },
    {
      id: 'registry-lifecycle',
      label: 'Registry apply/list/delete lifecycle',
      suite: 'Registry',
      description: 'Applies and hard-deletes a uniquely named local probe resource.',
      mutates: true,
      async run({ api }) {
        const name = `ui_integration_probe_${Date.now()}`
        const definition = probeRegistryTool(name)
        try {
          const applied = await api.registryApply(definition)
          const listed = await api.registryList({ name, version: '1.0.0' })
          if (!listed.some((tool) => tool.metadata?.name === name)) throw new Error('Applied probe was not listed')
          return { expected: 'Probe applies and appears in registry', actual: `Applied ${applied.name}`, details: { name } }
        } finally {
          await api.registryDelete(name, '1.0.0', true)
        }
      },
    },
    {
      id: 'guarded-tool-lifecycle',
      label: 'Guarded tool denies role-less invokes',
      suite: 'Registry',
      description: 'Applies an allowedRoles probe, expects a 4xx denial without a matching role, then hard-deletes it.',
      mutates: true,
      async run({ api }) {
        const name = `ui_guard_probe_${Date.now()}`
        try {
          await api.registryApply(guardedProbeRegistryTool(name))
          const denial = await expectFailure(() => api.invoke(name, {}))
          const status = denial.status ?? 0
          if (status < 400 || status >= 500) throw new Error(`Guarded tool returned HTTP ${status || 'unknown'} instead of a 4xx denial`)
          return {
            expected: 'Role-gated probe denies invocation without a matching role using a typed 4xx error',
            actual: `Denied with HTTP ${status}`,
            details: { name, status, errorName: denial.name },
          }
        } finally {
          await api.registryDelete(name, '1.0.0', true)
        }
      },
    },
    {
      id: 'cache-flush',
      label: 'Cache flush',
      suite: 'Operations',
      description: 'Flushes local cache state; only available with explicit mutation confirmation.',
      mutates: true,
      async run({ api }) {
        const flushed = await api.flushCache({ all: true })
        if (flushed.status !== 'ok') throw new Error('Cache flush did not return ok')
        return { expected: 'Local cache flush returns ok', actual: `Flushed ${flushed.deleted} cache entries`, details: flushed }
      },
    },
  ]
}

export async function executeCheck(check: IntegrationCheck, context: IntegrationCheckContext): Promise<CheckResult> {
  const started = performance.now()
  try {
    return {
      id: check.id,
      label: check.label,
      suite: check.suite,
      mutates: check.mutates,
      status: 'passed',
      durationMs: Math.round(performance.now() - started),
      evidence: await check.run(context),
    }
  } catch (error) {
    return {
      id: check.id,
      label: check.label,
      suite: check.suite,
      mutates: check.mutates,
      status: 'failed',
      durationMs: Math.round(performance.now() - started),
      error: safeError(error),
    }
  }
}

function makeMcpCheck(id: string, entry: string, factory: (config: BrowserClientConfig) => BrowserMcpSession): IntegrationCheck {
  return {
    id,
    label: `MCP connect and tool calls (${entry})`,
    suite: 'MCP',
    description: 'Connects, discovers tools, calls directly, calls through the exact-name proxy, and closes the session.',
    mutates: false,
    async run({ baseUrl }) {
      const session = factory({ baseUrl })
      try {
        await session.connect()
        const tools = await session.listTools()
        if (!tools.some((tool) => tool.name === 'list_employees')) throw new Error('Seeded list_employees tool was not discovered')
        const direct = await session.call('list_employees', {})
        assertMcpToolSuccess(direct)
        const proxy = await session.proxyCall('list_employees', {})
        assertMcpToolSuccess(proxy)
        return { expected: 'Connect, discover, direct-call, proxy-call, and close all succeed with native MCP envelopes', actual: `${entry} MCP path passed`, details: { toolCount: tools.length } }
      } finally {
        await session.close()
      }
    },
  }
}

/** Assert a REST direct-invoke `ToolResult` reports success. */
function assertRestToolSuccess(result: ToolResult): void {
  if (result.isError === true) throw new Error('Tool returned an MCP execution error')
  if (result.result === undefined) throw new Error('Tool returned no result')
}

/** Assert a native MCP `CallToolResult` envelope reports success. */
export function assertMcpToolSuccess(result: McpToolResult): void {
  if (result.isError === true) throw new Error('Tool returned an MCP execution error')
  if (!Array.isArray(result.content) || result.content.length === 0) throw new Error('Tool returned no MCP content blocks')
}

async function expectFailure(action: () => Promise<unknown>): Promise<{ status?: number; name?: string }> {
  try {
    await action()
  } catch (error) {
    const value = error as { status?: number; name?: string }
    return value
  }
  throw new Error('Expected operation to fail')
}

function probeRegistryTool(name: string): RegistryTool {
  return {
    apiVersion: 'erpbridge.io/v1',
    kind: 'MCPTool',
    metadata: { name, version: '1.0.0', module: 'ui-integration' },
    spec: {
      description: { short: 'Interactive UI integration probe' },
      inputSchema: { type: 'object', properties: {} },
      execution: { type: 'http', method: 'GET', endpoint: 'http://localhost:8081/health' },
      security: { authType: 'api-key', credentialRef: 'ERP_PRIMARY_KEY' },
    },
  }
}

function guardedProbeRegistryTool(name: string): RegistryTool {
  const base = probeRegistryTool(name)
  return {
    ...base,
    spec: {
      ...base.spec,
      security: { authType: 'api-key', credentialRef: 'ERP_PRIMARY_KEY', allowedRoles: ['ui_integration_reader'] },
    },
  }
}

function safeError(error: unknown): { name: string; message: string; status?: number } {
  if (error instanceof Error) {
    const value = error as Error & { status?: unknown }
    return { name: error.name || 'Error', message: error.message, ...(typeof value.status === 'number' ? { status: value.status } : {}) }
  }
  return { name: 'Error', message: String(error) }
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds) })])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
