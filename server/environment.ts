import { execFile as execFileCallback } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

export const LOCAL_STOP_CONFIRMATION = 'STOP_LOCAL_ENVIRONMENT'

export interface EnvironmentStage {
  name: 'validate' | 'compose-up' | 'ready' | 'seed' | 'compose-down'
  status: 'started' | 'passed' | 'failed'
  message?: string
}

export interface EnvironmentStatus {
  baseUrl: string
  localOnly: true
  reachable: boolean
  ready: boolean
  cors: boolean
  healthStatus?: number
  busy: boolean
  currentStage?: EnvironmentStage['name']
}

export interface EnvironmentRunResult {
  status: 'ready' | 'stopped'
  stages: EnvironmentStage[]
}

export interface EnvironmentController {
  status(): Promise<EnvironmentStatus>
  start(): Promise<EnvironmentRunResult>
  stop(confirmation: string): Promise<EnvironmentRunResult>
}

export interface EnvironmentControllerOptions {
  baseUrl?: string
  cwd?: string
  commandRunner?: (script: string, cwd: string, env: NodeJS.ProcessEnv) => Promise<void>
  fetcher?: typeof fetch
}

export function createEnvironmentController(options: EnvironmentControllerOptions = {}): EnvironmentController {
  const baseUrl = options.baseUrl ?? process.env.ERPBRIDGE_BASE_URL ?? 'http://localhost:8080'
  const cwd = options.cwd ?? process.cwd()
  const fetcher = options.fetcher ?? globalThis.fetch
  const runCommand = options.commandRunner ?? runScript
  let busy = false
  let currentStage: EnvironmentStage['name'] | undefined

  function validateLocalTarget(): void {
    const parsed = parseLocalUrl(baseUrl)
    if (!parsed) throw Object.assign(new Error('Only loopback ERPBridge URLs are allowed'), { name: 'InputError', status: 400 })
  }

  async function status(): Promise<EnvironmentStatus> {
    validateLocalTarget()
    const result: EnvironmentStatus = {
      baseUrl,
      localOnly: true,
      reachable: false,
      ready: false,
      cors: false,
      busy,
      currentStage,
    }
    try {
      const health = await fetchWithTimeout(fetcher, `${baseUrl.replace(/\/$/, '')}/mcp/health`)
      result.reachable = true
      result.healthStatus = health.status
      result.ready = health.ok
      if (!health.ok) return result
      const cors = await fetchWithTimeout(fetcher, `${baseUrl.replace(/\/$/, '')}/mcp/`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://127.0.0.1:5173',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, Mcp-Session-Id, MCP-Protocol-Version',
        },
      })
      const allowed = cors.headers.get('access-control-allow-headers')?.toLowerCase() ?? ''
      const exposed = cors.headers.get('access-control-expose-headers')?.toLowerCase() ?? ''
      result.cors = cors.ok && allowed.includes('mcp-protocol-version') && exposed.includes('mcp-session-id')
    } catch {
      // The status endpoint is diagnostic: an unavailable server is represented in the response.
    }
    return result
  }

  async function start(): Promise<EnvironmentRunResult> {
    validateLocalTarget()
    if (busy) throw Object.assign(new Error('An environment operation is already running'), { name: 'ConflictError', status: 409 })
    busy = true
    const stages: EnvironmentStage[] = [{ name: 'validate', status: 'passed' }]
    try {
      currentStage = 'compose-up'
      stages.push({ name: 'compose-up', status: 'started' })
      await runCommand('infra-up.ts', cwd, process.env)
      stages[stages.length - 1].status = 'passed'

      currentStage = 'ready'
      stages.push({ name: 'ready', status: 'started' })
      await runCommand('infra-ready.ts', cwd, process.env)
      stages[stages.length - 1].status = 'passed'

      currentStage = 'seed'
      stages.push({ name: 'seed', status: 'started' })
      await runCommand('seed-tools.ts', cwd, process.env)
      stages[stages.length - 1].status = 'passed'
      return { status: 'ready', stages }
    } catch (error) {
      const failed = stages.find((stage) => stage.status === 'started')
      if (failed) {
        failed.status = 'failed'
        failed.message = safeMessage(error)
      }
      throw Object.assign(new Error(`Environment start failed: ${safeMessage(error)}`), {
        name: 'EnvironmentError',
        status: 502,
        stages,
      })
    } finally {
      busy = false
      currentStage = undefined
    }
  }

  async function stop(confirmation: string): Promise<EnvironmentRunResult> {
    validateLocalTarget()
    if (confirmation !== LOCAL_STOP_CONFIRMATION) {
      throw Object.assign(new Error(`Confirmation must equal ${LOCAL_STOP_CONFIRMATION}`), { name: 'InputError', status: 400 })
    }
    if (busy) throw Object.assign(new Error('An environment operation is already running'), { name: 'ConflictError', status: 409 })
    busy = true
    const stages: EnvironmentStage[] = [{ name: 'validate', status: 'passed' }]
    try {
      currentStage = 'compose-down'
      stages.push({ name: 'compose-down', status: 'started' })
      await runCommand('infra-down.ts', cwd, process.env)
      stages[stages.length - 1].status = 'passed'
      return { status: 'stopped', stages }
    } catch (error) {
      const failed = stages.find((stage) => stage.status === 'started')
      if (failed) {
        failed.status = 'failed'
        failed.message = safeMessage(error)
      }
      throw Object.assign(new Error(`Environment stop failed: ${safeMessage(error)}`), {
        name: 'EnvironmentError',
        status: 502,
        stages,
      })
    } finally {
      busy = false
      currentStage = undefined
    }
  }

  return { status, start, stop }
}

function parseLocalUrl(value: string): URL | undefined {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
    if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) return undefined
    return parsed
  } catch {
    return undefined
  }
}

async function fetchWithTimeout(fetcher: typeof fetch, url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3_000)
  try {
    return await fetcher(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function runScript(script: string, cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  const tsx = resolve(cwd, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx')
  if (!existsSync(tsx)) throw new Error(`tsx executable not found at ${tsx}`)
  await execFile(tsx, [resolve(cwd, 'scripts', script)], { cwd, env, maxBuffer: 2 * 1024 * 1024 })
}

function safeMessage(error: unknown): string {
  if (!(error instanceof Error)) return '[REDACTED_ERROR]'
  return error.message
    .replace(/\b(authorization|cookie|credential|password|secret|token|api[_-]?key)\b\s*[:=]?\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/\s+/g, ' ')
}
