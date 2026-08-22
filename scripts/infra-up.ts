import { execFileSync } from 'node:child_process'
import { COMPOSE_FILE, ERPBRIDGE_ROOT } from './infra-config.js'

execFileSync('docker', ['compose', '-f', COMPOSE_FILE, 'up', '-d', '--build'], { cwd: ERPBRIDGE_ROOT, stdio: 'inherit' })
