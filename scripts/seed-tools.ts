import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { bridgeEnv, BRIDGECTL, ERPBRIDGE_ROOT } from './infra-config.js'

const env = bridgeEnv()
try {
  execFileSync(BRIDGECTL, [
    'api', 'register', '--name', 'erp', '--url', 'http://localhost:8081', '--module', 'erp',
    '--description', 'Mock ERP for SDK integration verification',
  ], { cwd: ERPBRIDGE_ROOT, env, stdio: 'inherit' })
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  if (!/already exists|already registered|duplicate/i.test(message)) throw error
  console.log('ERP API registration already exists; continuing')
}

const schemaDir = join(ERPBRIDGE_ROOT, 'schemas', 'erp')
const schemas = readdirSync(schemaDir).filter((file) => file.endsWith('.json')).sort()
if (schemas.length === 0) throw new Error(`No JSON tool schemas found in ${schemaDir}`)
for (const schema of schemas) {
  console.log(`Applying ${schema}`)
  execFileSync(BRIDGECTL, ['tool', 'apply', '-f', join(schemaDir, schema)], { cwd: ERPBRIDGE_ROOT, env, stdio: 'inherit' })
}
execFileSync(BRIDGECTL, ['tool', 'get'], { cwd: ERPBRIDGE_ROOT, env, stdio: 'inherit' })
console.log(`Applied ${schemas.length} tool schemas`)
