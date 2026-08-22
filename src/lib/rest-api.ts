import type {
  CacheStats,
  HealthStatus,
  LogRecord,
  MetricFamily,
  RegistryTool,
  ToolApplyResult,
  ToolResult,
} from '@erpbridge/sdk'

export interface ParsedMetrics {
  families: MetricFamily[]
  skipped: Array<{ name: string; type: string }>
}

export interface EnvironmentStatus {
  baseUrl: string
  localOnly: true
  reachable: boolean
  ready: boolean
  cors: boolean
  healthStatus?: number
  busy: boolean
  currentStage?: string
}

export interface EnvironmentStage {
  name: string
  status: 'started' | 'passed' | 'failed'
  message?: string
}

export interface EnvironmentRunResult {
  status: 'ready' | 'stopped'
  stages: EnvironmentStage[]
}

export interface RestApi {
  environmentStatus(): Promise<EnvironmentStatus>
  environmentStart(): Promise<EnvironmentRunResult>
  environmentStop(confirmation: string): Promise<EnvironmentRunResult>
  health(): Promise<HealthStatus>
  recentLogs(): Promise<LogRecord[]>
  metricsText(): Promise<string>
  metricsParsed(): Promise<ParsedMetrics>
  cacheStats(): Promise<CacheStats>
  flushCache(options: { tool?: string; module?: string; all?: true }): Promise<{ deleted: number; status: string }>
  registryList(): Promise<RegistryTool[]>
  registryApply(tool: RegistryTool): Promise<ToolApplyResult>
  registryDelete(name: string, version: string, hard?: boolean): Promise<void>
  invoke(name: string, args: Record<string, unknown>): Promise<ToolResult>
  openLogStream(onRecord: (record: LogRecord) => void, onError?: (error: unknown) => void): () => void
}

export interface BffApiError extends Error {
  status?: number
  code?: number
  body?: unknown
  retryAfter?: string
  hint?: string
}

export function createRestApi(fetcher: typeof fetch = globalThis.fetch): RestApi {
  const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetcher(path, { method: init.method ?? 'GET', ...init, headers: { Accept: 'application/json', ...init.headers } })
    const raw = await response.text()
    const body = raw ? parseJson(raw) : undefined
    if (!response.ok) {
      const details = body && typeof body === 'object' && 'error' in body ? (body as { error?: Record<string, unknown> }).error : undefined
      const error = Object.assign(new Error(String(details?.message ?? `request failed with HTTP ${response.status}`)), {
        name: String(details?.name ?? 'Error'),
        status: response.status,
        code: typeof details?.code === 'number' ? details.code : undefined,
        body: details?.body,
        retryAfter: typeof details?.retryAfter === 'string' ? details.retryAfter : undefined,
        hint: typeof details?.hint === 'string' ? details.hint : undefined,
      }) as BffApiError
      throw error
    }
    return body as T
  }

  return {
    environmentStatus: () => request<EnvironmentStatus>('/api/environment/status'),
    environmentStart: () => request<EnvironmentRunResult>('/api/environment/start', jsonPost({})),
    environmentStop: (confirmation) => request<EnvironmentRunResult>('/api/environment/stop', jsonPost({ confirmation })),
    health: () => request<HealthStatus>('/api/health'),
    recentLogs: () => request<LogRecord[]>('/api/logs/recent'),
    async metricsText() {
      return (await request<{ text: string }>('/api/metrics/text')).text
    },
    metricsParsed: () => request<ParsedMetrics>('/api/metrics/parsed'),
    cacheStats: () => request<CacheStats>('/api/cache/stats'),
    flushCache: (options) => request('/api/cache/flush', jsonPost(options)),
    registryList: () => request<RegistryTool[]>('/api/registry'),
    registryApply: (tool) => request('/api/registry', jsonPost(tool)),
    async registryDelete(name, version, hard = false) {
      await request(`/api/registry?name=${encodeURIComponent(name)}&version=${encodeURIComponent(version)}&hard=${hard}`, { method: 'DELETE' })
    },
    invoke: (name, args) => request('/api/invoke', jsonPost({ name, args })),
    openLogStream(onRecord, onError) {
      const source = new EventSource('/api/logs/stream')
      source.onmessage = (event) => {
        try { onRecord(JSON.parse(event.data) as LogRecord) } catch (error) { onError?.(error) }
      }
      source.onerror = (event) => onError?.(event)
      return () => source.close()
    },
  }
}

function jsonPost(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

function parseJson(raw: string): unknown {
  try { return JSON.parse(raw) } catch { return raw }
}
