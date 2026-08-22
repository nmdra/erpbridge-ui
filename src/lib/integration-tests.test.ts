import { describe, expect, it } from 'vitest'
import { executeCheck, type IntegrationCheckContext } from './integration-tests.js'

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
