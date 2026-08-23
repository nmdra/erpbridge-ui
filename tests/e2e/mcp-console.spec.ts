import { expect, test } from '@playwright/test'

const authToken = process.env.ERPBRIDGE_TEST_TOKEN
const authSuite = authToken ? test.describe : test.describe.skip

test.describe('browser MCP console', () => {
  test('shows the full integration catalog and keeps mutations gated', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Full integration checks' })).toBeVisible()
    await expect(page.getByTestId('integration-check-mcp-root')).toBeVisible()
    await expect(page.getByTestId('integration-check-registry-lifecycle')).toContainText('mutates')
    await expect(page.getByTestId('integration-check-registry-lifecycle').getByRole('button', { name: 'Run' })).toBeDisabled()
    await expect(page.getByTestId('integration-check-cache-flush').getByRole('button', { name: 'Run' })).toBeDisabled()
    await page.getByTestId('integration-check-environment-ready').getByRole('button', { name: 'Run' }).click()
    await expect(page.getByTestId('integration-check-environment-ready')).toContainText('passed')
    await page.getByTestId('integration-check-mcp-cors').getByRole('button', { name: 'Run' }).click()
    await expect(page.getByTestId('integration-check-mcp-cors')).toContainText('passed')
  })

  test('connects through the root SDK entry and calls both tool surfaces', async ({ page }) => {
    const mcpRequests: Array<{ method: string; headers: Record<string, string> }> = []
    page.on('request', (request) => {
      if (request.url().includes('/mcp/')) mcpRequests.push({ method: request.method(), headers: request.headers() })
    })

    await page.goto('/')
    await page.getByRole('button', { name: 'Connect and list tools' }).click()
    await expect(page.getByText('connected', { exact: true })).toBeVisible()
    await expect(page.getByTestId('mcp-tool-select')).toContainText('list_employees')
    await page.getByTestId('mcp-tool-select').selectOption('list_employees')

    await page.getByRole('button', { name: 'Call with mcp.callTool' }).click()
    await expect(page.getByTestId('mcp-result-kind')).toContainText('MCP result envelope')
    await expect(page.getByTestId('mcp-result')).toContainText('Nimal Dharmasiri')
    await page.getByRole('button', { name: 'Call with tools proxy' }).click()
    await expect(page.getByTestId('mcp-result')).toContainText('Nimal Dharmasiri')

    expect(mcpRequests.some((request) => request.method === 'POST')).toBe(true)
    await expect(page.getByText('MCP CORS ready')).toBeVisible()
  })

  test('sends the selected MCP role as arguments.role', async ({ page }) => {
    let callPayload = ''
    page.on('request', async (request) => {
      if (request.url().includes('/mcp/') && request.method() === 'POST') {
        const body = request.postData()
        if (body?.includes('tools/call')) callPayload = body
      }
    })

    await page.goto('/')
    await page.getByRole('button', { name: 'Connect and list tools' }).click()
    await expect(page.getByText('connected', { exact: true })).toBeVisible()
    await page.getByTestId('mcp-tool-select').selectOption('list_employees')
    await page.getByTestId('mcp-role').fill('finance_reader')
    await page.getByRole('button', { name: 'Call with mcp.callTool' }).click()
    await expect(page.getByTestId('mcp-operation')).toContainText('(role: finance_reader)')
    expect(callPayload).toContain('"role":"finance_reader"')
  })

  test('keeps the bearer token out of visible output and browser storage', async ({ page }) => {
    const probeToken = 'e2e-transient-token-value'
    await page.goto('/')
    await page.getByTestId('mcp-token').fill(probeToken)
    await page.getByRole('button', { name: 'Connect and list tools' }).click()
    await expect(page.getByText('connected', { exact: true })).toBeVisible()

    const bodyText = await page.locator('body').innerText()
    expect(bodyText).not.toContain(probeToken)
    const storage = await page.evaluate(() => JSON.stringify({
      local: Object.fromEntries(Object.entries(localStorage)),
      session: Object.fromEntries(Object.entries(sessionStorage)),
    }))
    expect(storage).not.toContain(probeToken)

    await page.getByRole('button', { name: 'Close session' }).click()
    await expect(page.getByText('disconnected', { exact: true })).toBeVisible()
    await expect(page.getByTestId('mcp-token')).toHaveValue('')
    expect(await page.locator('body').innerText()).not.toContain(probeToken)
  })

  test('connects through the public client subpath and closes the session', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('combobox', { name: 'SDK entry' }).selectOption('client')
    await page.getByRole('button', { name: 'Connect and list tools' }).click()
    await expect(page.getByText('connected', { exact: true })).toBeVisible()
    await expect(page.getByTestId('mcp-operation')).toContainText('@erpbridge/sdk/client')
    await page.getByTestId('mcp-tool-select').selectOption('list_employees')
    await page.getByRole('button', { name: 'Call with tools proxy' }).click()
    await expect(page.getByTestId('mcp-result')).toContainText('Nimal Dharmasiri')
    await page.getByRole('button', { name: 'Close session' }).click()
    await expect(page.getByText('disconnected', { exact: true })).toBeVisible()
  })

  test('routes REST diagnostics through the same-origin BFF', async ({ page }) => {
    const restRequests: string[] = []
    page.on('request', (request) => { if (request.url().includes('/api/')) restRequests.push(request.url()) })
    await page.goto('/')
    await page.getByRole('button', { name: 'Refresh REST diagnostics' }).click()
    await expect(page.getByText('same-origin only')).toBeVisible()
    await expect(page.getByText(/"status": "ok"/)).toBeVisible()
    expect(restRequests.some((url) => url.endsWith('/api/health'))).toBe(true)
    expect(restRequests.every((url) => url.includes('127.0.0.1:5173'))).toBe(true)
  })

  authSuite('authenticated browser sessions', () => {
    test('connects with a transient bearer token and calls a tool', async ({ page }) => {
      await page.goto('/')
      await page.getByTestId('mcp-token').fill(authToken!)
      await page.getByRole('button', { name: 'Connect and list tools' }).click()
      await expect(page.getByText('connected', { exact: true })).toBeVisible()
      await expect(page.getByTestId('mcp-operation')).toContainText('(authenticated)')
      await page.getByTestId('mcp-tool-select').selectOption('list_employees')
      await page.getByRole('button', { name: 'Call with mcp.callTool' }).click()
      await expect(page.getByTestId('mcp-result')).toContainText('Nimal Dharmasiri')

      const bodyText = await page.locator('body').innerText()
      expect(bodyText).not.toContain(authToken!)
    })
  })
})
