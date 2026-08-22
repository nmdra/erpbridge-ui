import { describe, expect, it } from 'vitest'
import { toSafeError } from './error-response.js'

describe('toSafeError', () => {
  it('preserves typed error metadata and redacts credential-shaped fields', () => {
    const error = Object.assign(new Error('unauthorized'), {
      name: 'AuthenticationError',
      status: 401,
      code: -32001,
      retryAfter: '10',
      body: {
        message: 'unauthorized',
        Authorization: 'Bearer do-not-record',
        nested: { token: 'do-not-record', ok: true },
      },
    })

    expect(toSafeError(error)).toEqual({
      name: 'AuthenticationError',
      message: 'unauthorized',
      status: 401,
      code: -32001,
      retryAfter: '10',
      body: {
        message: 'unauthorized',
        Authorization: '[REDACTED]',
        nested: { token: '[REDACTED]', ok: true },
      },
    })
  })

  it('normalizes unknown thrown values', () => {
    expect(toSafeError('connection lost')).toEqual({ name: 'Error', message: 'connection lost' })
  })
})
