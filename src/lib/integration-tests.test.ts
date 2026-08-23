import { describe, expect, it, vi } from 'vitest'
import type { McpToolResult } from '@erpbridge/sdk'
import type { RestApi } from './rest-api.js'
import { assertMcpToolSuccess, createIntegrationChecks, executeCheck, type CheckEvidence, type IntegrationCheckContext } from './integration-tests.js'

const context = {} as IntegrationCheckContext

describe('integration test runner model', () => {
  it('records successful evidence and duration', async () => {
    const result = await executeCheck({
      id: 'probe', label: 'Probe', suite: 'Unit', description: 'probe', mutates: false,
      run: async () => ({ expected: 'one', actual: 'one', details: { ok: true } }),
    }, context)
    expect(result).toMatchObject({ id: 'probe', status: 'passed', evidence: { expected: 'one', actual: 'one' } })
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('turns thrown typed errors into safe failed results', async () => {
    const result = await executeCheck({
      id: 'failure', label: 'Failure', suite: 'Unit', description: 'failure', mutates: true,
      run: async () => { throw Object.assign(new Error('bad input'), { name: 'InputError', status: 400 }) },
    }, context)
    expect(result).toMatchObject({ id: 'failure', mutates: true, status: 'failed', error: { name: 'InputError', message: 'bad input', status: 400 } })
  })
})

describe('native MCP envelope assertions', () => {
  it('accepts successful envelopes with content blocks', () => {
    expect(() => assertMcpToolSuccess({ content: [{ type: 'text', text: 'ok' }] } as McpToolResult)).not.toThrow()
  })

  it('rejects execution-error envelopes and empty content', () => {
    expect(() => assertMcpToolSuccess({ content: [{ type: 'text', text: 'boom' }], isError: true } as McpToolResult))
      .toThrow('Tool returned an MCP execution error')
    expect(() => assertMcpToolSuccess({ content: [] } as McpToolResult))
      .toThrow('Tool returned no MCP content blocks')
  })
})

describe('registry contract checks', () => {
  it('applies lifecycle probes as MCPTool resources and filters listing by exact identity', async () => {
    let applied: unknown
    const api = {
      registryApply: vi.fn(async (tool: never) => { applied = tool; return { status: 'applied', name: (tool as { metadata: { name: string } }).metadata.name, version: '1.0.0' } }),
      registryList: vi.fn(async (filters?: { name?: string }) => [probeRow(filters?.name ?? 'list_employees')]),
      registryDelete: vi.fn(async () => {}),
    } as unknown as RestApi

    const lifecycle = await runById('registry-lifecycle', { api })
    expect(lifecycle.status).toBe('passed')
    expect(applied).toMatchObject({ kind: 'MCPTool' })
    expect(api.registryList).toHaveBeenLastCalledWith({ name: expect.stringContaining('ui_integration_probe_'), version: '1.0.0' })
    expect(api.registryDelete).toHaveBeenCalledWith(expect.anything(), '1.0.0', true)

    await runById('registry-filter', {
      api: {
        registryList: vi.fn(async (filters?: { name?: string }) => filters?.name === 'list_employees'
          ? [probeRow()]
          : [probeRow(), probeRow('get_employee')]),
      } as unknown as RestApi,
    }).then((result) => expect(result.status).toBe('passed'))
  })

  it('expects a typed 4xx denial from a role-gated probe and always cleans up', async () => {
    const api = {
      registryApply: vi.fn(async (tool: never) => ({ status: 'applied', name: (tool as { metadata: { name: string } }).metadata.name, version: '1.0.0' })),
      invoke: vi.fn(async () => { throw Object.assign(new Error('forbidden'), { name: 'AuthorizationError', status: 403 }) }),
      registryDelete: vi.fn(async () => {}),
    } as unknown as RestApi

    const result = await runById('guarded-tool-lifecycle', { api })
    expect(result.status).toBe('passed')
    expect(result.evidence?.actual).toContain('Denied with HTTP 403')
    expect(api.registryDelete).toHaveBeenCalledWith(expect.stringContaining('ui_guard_probe_'), '1.0.0', true)

    const serverError = {
      ...api,
      invoke: vi.fn(async () => { throw Object.assign(new Error('upstream'), { name: 'ServerError', status: 500 }) }),
    } as unknown as RestApi
    const failed = await runById('guarded-tool-lifecycle', { api: serverError })
    expect(failed.status).toBe('failed')
    expect(failed.error?.message).toContain('instead of a 4xx denial')
  })
})

async function runById(id: string, overrides: Partial<IntegrationCheckContext>) {
  const check = createIntegrationChecks().find((entry) => entry.id === id)
  if (!check) throw new Error(`missing check ${id}`)
  return executeCheck(check, { ...context, ...overrides })
}

function probeRow(name = 'list_employees') {
  return { apiVersion: 'erpbridge.io/v1', kind: 'MCPTool', metadata: { name, version: '1.0.0' }, spec: {} }
}
