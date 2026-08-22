import { defineConfig, mergeConfig } from 'vitest/config'
import base from './vite.config.js'

export default mergeConfig(base, defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30_000,
  },
}))
