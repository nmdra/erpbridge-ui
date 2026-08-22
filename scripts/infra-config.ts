import { resolve } from 'node:path'

export const ERPBRIDGE_ROOT = resolve(process.env.ERPBRIDGE_ROOT ?? '/home/nimendra/Documents/Projects/ERPBridge')
export const COMPOSE_FILE = resolve(ERPBRIDGE_ROOT, 'docker-compose.yml')
export const BRIDGECTL = resolve(ERPBRIDGE_ROOT, 'bridgectl')
export const BASE_URL = process.env.ERPBRIDGE_BASE_URL ?? 'http://localhost:8080'

export function bridgeEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    BRIDGE_CONTEXT: 'local',
    BRIDGE_SERVER: BASE_URL,
    BRIDGE_MCP_SERVER: BASE_URL,
    BRIDGE_ERP_BASE: process.env.BRIDGE_ERP_BASE ?? 'http://localhost:8081',
  }
}
