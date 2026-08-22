import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const uiRoot = resolve(import.meta.dirname, '..')
const sdkRoot = resolve(uiRoot, '../erpbridge-sdk')
const artifactRoot = join(uiRoot, '.scratch', 'artifacts')
mkdirSync(artifactRoot, { recursive: true })

execFileSync('npm', ['run', 'build'], { cwd: sdkRoot, stdio: 'inherit' })
const packedRaw = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', artifactRoot], { cwd: sdkRoot, encoding: 'utf8' })) as Array<{ filename: string }> | Record<string, { filename: string }>
const packed = Array.isArray(packedRaw) ? packedRaw[0] : packedRaw[Object.keys(packedRaw)[0] ?? '']
const filename = packed?.filename
if (!filename) throw new Error('SDK npm pack did not return a filename')

const tarball = join(artifactRoot, filename)
execFileSync('npm', ['install', '--no-save', '--ignore-scripts', tarball], { cwd: uiRoot, stdio: 'inherit' })

const packageJson = JSON.parse(readFileSync(join(sdkRoot, 'package.json'), 'utf8')) as { name: string; version: string }
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sdkRoot, encoding: 'utf8' }).trim()
const sha256 = createHash('sha256').update(readFileSync(tarball)).digest('hex')
writeFileSync(join(artifactRoot, 'sdk-manifest.json'), `${JSON.stringify({
  package: packageJson.name,
  version: packageJson.version,
  revision,
  tarball: filename,
  sha256,
  source: sdkRoot,
  createdAt: new Date().toISOString(),
}, null, 2)}\n`)
console.log(`staged ${packageJson.name}@${packageJson.version} from ${revision} (${sha256.slice(0, 12)}…)`)
