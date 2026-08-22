import { useEffect, useMemo, useState } from 'react'
import type { EnvironmentStatus, RestApi } from '../lib/rest-api.js'
import { createIntegrationChecks, executeCheck, type CheckResult, type IntegrationCheck } from '../lib/integration-tests.js'

interface IntegrationRunnerProps {
  baseUrl: string
  api: RestApi
}

const STOP_CONFIRMATION = 'STOP_LOCAL_ENVIRONMENT'

export default function IntegrationRunner({ baseUrl, api }: IntegrationRunnerProps) {
  const checks = useMemo(createIntegrationChecks, [])
  const [results, setResults] = useState<Record<string, CheckResult>>({})
  const [current, setCurrent] = useState<string>()
  const [runError, setRunError] = useState<string>()
  const [mutationsEnabled, setMutationsEnabled] = useState(false)
  const [mutationConfirmation, setMutationConfirmation] = useState(false)
  const [environment, setEnvironment] = useState<EnvironmentStatus>()
  const [environmentError, setEnvironmentError] = useState<string>()
  const [lifecycleBusy, setLifecycleBusy] = useState(false)
  const [stopConfirmed, setStopConfirmed] = useState(false)

  useEffect(() => { void refreshEnvironment() }, [])

  const refreshEnvironment = async () => {
    try {
      setEnvironmentError(undefined)
      setEnvironment(await api.environmentStatus())
    } catch (error) {
      setEnvironmentError(formatError(error))
    }
  }

  const run = async (selection: IntegrationCheck[]) => {
    if (selection.some((check) => check.mutates) && (!mutationsEnabled || !mutationConfirmation)) {
      setRunError('Enable state-changing checks and confirm the mutation warning before running them.')
      return
    }
    setRunError(undefined)
    setCurrent(undefined)
    for (const check of selection) {
      setCurrent(check.id)
      const result = await executeCheck(check, { baseUrl, api })
      setResults((previous) => ({ ...previous, [check.id]: result }))
    }
    setCurrent(undefined)
  }

  const runSafe = () => run(checks.filter((check) => !check.mutates))
  const runAll = () => run(checks)

  const startEnvironment = async () => {
    setLifecycleBusy(true)
    setEnvironmentError(undefined)
    const poll = setInterval(() => { void refreshEnvironment() }, 500)
    try {
      await api.environmentStart()
      await refreshEnvironment()
    } catch (error) {
      setEnvironmentError(formatError(error))
    } finally {
      clearInterval(poll)
      setLifecycleBusy(false)
    }
  }

  const stopEnvironment = async () => {
    if (!stopConfirmed) return setEnvironmentError('Confirm local volume removal before stopping the environment.')
    setLifecycleBusy(true)
    setEnvironmentError(undefined)
    try {
      await api.environmentStop(STOP_CONFIRMATION)
      setStopConfirmed(false)
      await refreshEnvironment()
    } catch (error) {
      setEnvironmentError(formatError(error))
    } finally {
      setLifecycleBusy(false)
    }
  }

  const summary = Object.values(results).reduce((counts, result) => {
    counts[result.status] += 1
    return counts
  }, { passed: 0, failed: 0, skipped: 0 } as Record<CheckResult['status'], number>)

  return (
    <section className="card" aria-label="Integration test runner">
      <div className="section-heading">
        <div><p className="eyebrow">Interactive test runner</p><h2>Full integration checks</h2></div>
        <span className={environment?.ready ? 'status good' : 'status'}>{environment?.ready ? 'ready' : 'not ready'}</span>
      </div>

      <div className="environment-toolbar">
        <div>
          <strong>Local environment</strong>
          <p className="muted">{environment?.baseUrl ?? baseUrl} · {environment?.currentStage ? `stage: ${environment.currentStage}` : environment?.cors ? 'MCP CORS ready' : 'MCP CORS unchecked'}</p>
        </div>
        <div className="button-row">
          <button onClick={startEnvironment} disabled={lifecycleBusy}>{lifecycleBusy ? 'Working…' : 'Start and seed local stack'}</button>
          <button className="secondary" onClick={refreshEnvironment} disabled={lifecycleBusy}>Refresh status</button>
        </div>
      </div>
      <div className="environment-stop">
        <label className="inline-check"><input type="checkbox" checked={stopConfirmed} onChange={(event) => setStopConfirmed(event.target.checked)} /> I understand stop removes local Compose volumes</label>
        <button className="danger" onClick={stopEnvironment} disabled={lifecycleBusy || !stopConfirmed}>Stop local stack</button>
      </div>

      <div className="runner-toolbar">
        <div className="button-row">
          <button onClick={runSafe} disabled={Boolean(current) || !environment?.ready}>Run all safe checks</button>
          <button className="secondary" onClick={runAll} disabled={Boolean(current) || !environment?.ready}>Run full suite</button>
        </div>
        <span className="run-summary">{summary.passed} passed · {summary.failed} failed · {checks.length} total</span>
      </div>
      <div className="mutation-options">
        <label className="inline-check"><input type="checkbox" checked={mutationsEnabled} onChange={(event) => setMutationsEnabled(event.target.checked)} /> Allow state-changing checks</label>
        <label className="inline-check"><input type="checkbox" checked={mutationConfirmation} onChange={(event) => setMutationConfirmation(event.target.checked)} /> I understand registry and cache state will change</label>
      </div>

      {(runError || environmentError) && <pre className="error" data-testid="integration-error">{runError ?? environmentError}</pre>}
      {current && <p className="operation" data-testid="integration-current">Running {checks.find((check) => check.id === current)?.label}…</p>}

      <div className="test-catalog">
        {checks.map((check) => {
          const result = results[check.id]
          return <article className="test-row" key={check.id} data-testid={`integration-check-${check.id}`}>
            <div>
              <div className="test-title"><strong>{check.label}</strong>{check.mutates && <span className="tag">mutates</span>}</div>
              <p className="muted">{check.suite} · {check.description}</p>
            </div>
            <div className="test-result">
              <span className={`status ${result?.status === 'passed' ? 'good' : result?.status === 'failed' ? 'bad' : ''}`}>{current === check.id ? 'running' : result?.status ?? 'queued'}</span>
              {result && <span className="muted">{result.durationMs}ms</span>}
              <button className="secondary" onClick={() => void run([check])} disabled={Boolean(current) || !environment?.ready || (check.mutates && (!mutationsEnabled || !mutationConfirmation))}>Run</button>
            </div>
            {result?.evidence && <pre className="check-evidence">{formatJson({ expected: result.evidence.expected, actual: result.evidence.actual, details: result.evidence.details })}</pre>}
            {result?.error && <pre className="error check-evidence">{result.error.name}: {result.error.message}{result.error.status ? ` (HTTP ${result.error.status})` : ''}</pre>}
          </article>
        })}
      </div>
    </section>
  )
}

function formatJson(value: unknown): string { return JSON.stringify(value, null, 2) }
function formatError(error: unknown): string { return error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
