import { spawn } from 'node:child_process'

const children = [
  spawn('npm', ['run', 'dev:bff'], { stdio: 'inherit', shell: process.platform === 'win32' }),
  spawn('npm', ['run', 'dev:web'], { stdio: 'inherit', shell: process.platform === 'win32' }),
]

const stop = (signal) => {
  for (const child of children) child.kill(signal)
}
process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))
for (const child of children) child.on('exit', (code) => { if (code && code !== 130) stop('SIGTERM') })
