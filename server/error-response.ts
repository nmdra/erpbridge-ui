const SECRET_KEY = /authorization|cookie|credential|password|secret|token|api[_-]?key/i

export interface SafeErrorResponse {
  name: string
  message: string
  status?: number
  code?: number
  retryAfter?: string
  hint?: string
  requiredScope?: string
  body?: unknown
  stages?: unknown
}

export function toSafeError(error: unknown): SafeErrorResponse {
  if (error instanceof Error) {
    const source = error as Error & {
      status?: unknown
      code?: unknown
      retryAfter?: unknown
      hint?: unknown
      requiredScope?: unknown
      body?: unknown
      stages?: unknown
    }
    const result: SafeErrorResponse = {
      name: error.name || 'Error',
      message: error.message,
    }
    if (typeof source.status === 'number') result.status = source.status
    if (typeof source.code === 'number') result.code = source.code
    if (typeof source.retryAfter === 'string') result.retryAfter = source.retryAfter
    if (typeof source.hint === 'string') result.hint = source.hint
    if (typeof source.requiredScope === 'string') result.requiredScope = source.requiredScope
    if (source.body !== undefined) result.body = redact(source.body)
    if (source.stages !== undefined) result.stages = redact(source.stages)
    return result
  }

  if (typeof error === 'string') return { name: 'Error', message: error }
  return { name: 'Error', message: String(error) }
}

function redact(value: unknown, key?: string): unknown {
  if (key !== undefined && SECRET_KEY.test(key)) return '[REDACTED]'
  if (Array.isArray(value)) return value.map((item) => redact(item))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redact(entryValue, entryKey)]))
  }
  return value
}
