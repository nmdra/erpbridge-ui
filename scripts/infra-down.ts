import { execFileSync } from 'node:child_process'
import { COMPOSE_FILE, ERPBRIDGE_ROOT } from './infra-config.js'

execFileSync('docker', ['compose', '-f', COMPOSE_FILE, 'down', '-v'], { cwd: ERPBRIDGE_ROOT, stdio: 'inherit' })
