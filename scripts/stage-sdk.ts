import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REQUIRED_SDK_VERSION = '1.0.0'
const uiRoot = resolve(import.meta.dirname, '..')
const sdkRoot = resolve(uiRoot, '../erpbridge-sdk')
const artifactRoot = join(uiRoot, '.scratch', 'artifacts')
mkdirSync(artifactRoot, { recursive: true })

const sourceJson = JSON.parse(readFileSync(join(sdkRoot, 'package.json'), 'utf8')) as { name?: string; version?: string }
if (sourceJson.version !== REQUIRED_SDK_VERSION) {
  throw new Error(`sdk:stage requires @erpbridge/sdk@${REQUIRED_SDK_VERSION}, but ${sdkRoot} declares version ${sourceJson.version ?? 'unknown'}; check out the ${REQUIRED_SDK_VERSION} release commit first`)
}

execFileSync('npm', ['run', 'build'], { cwd: sdkRoot, stdio: 'inherit' })
const packedRaw = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', artifactRoot], { cwd: sdkRoot, encoding: 'utf8' })) as Array<{ filename?: string; version?: string }> | Record<string, { filename?: string; version?: string }>
const packed = Array.isArray(packedRaw) ? packedRaw[0] : packedRaw[Object.keys(packedRaw)[0] ?? '']
const filename = packed?.filename
if (!filename) throw new Error('SDK npm pack did not return a filename')
if (packed?.version !== REQUIRED_SDK_VERSION) {
  throw new Error(`sdk:stage requires @erpbridge/sdk@${REQUIRED_SDK_VERSION}, but the packed worktree reported version ${packed?.version ?? 'unknown'}; check out the ${REQUIRED_SDK_VERSION} release commit first`)
}

const tarball = join(artifactRoot, filename)
execFileSync('npm', ['install', '--no-save', '--ignore-scripts', tarball], { cwd: uiRoot, stdio: 'inherit' })

const installedJson = JSON.parse(readFileSync(join(uiRoot, 'node_modules', '@erpbridge', 'sdk', 'package.json'), 'utf8')) as { name: string; version: string }
if (installedJson.version !== REQUIRED_SDK_VERSION || installedJson.name !== '@erpbridge/sdk') {
  throw new Error(`staged install is ${installedJson.name}@${installedJson.version}, expected @erpbridge/sdk@${REQUIRED_SDK_VERSION}`)
}
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sdkRoot, encoding: 'utf8' }).trim()
const sha256 = createHash('sha256').update(readFileSync(tarball)).digest('hex')
writeFileSync(join(artifactRoot, 'sdk-manifest.json'), `${JSON.stringify({
  package: installedJson.name,
  version: installedJson.version,
  revision,
  tarball: filename,
  sha256,
  source: sdkRoot,
  createdAt: new Date().toISOString(),
}, null, 2)}\n`)
console.log(`staged ${installedJson.name}@${installedJson.version} from ${revision} (${sha256.slice(0, 12)}…)`)
