import { chromium, defineConfig } from '@playwright/test'
import { existsSync } from 'node:fs'

const systemChromium = '/usr/lib/chromium/chromium'
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH
  ?? (existsSync(systemChromium) ? systemChromium : chromium.executablePath())

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure', launchOptions: { executablePath } },
  webServer: [
    { command: 'npm run dev:bff', url: 'http://127.0.0.1:8787/api/health', reuseExistingServer: true },
    { command: 'npm run dev:web', url: 'http://127.0.0.1:5173', reuseExistingServer: true },
  ],
})
