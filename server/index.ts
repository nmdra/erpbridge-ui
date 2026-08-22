import { startBff } from './app.js'

const started = await startBff()
console.log(`ERPBridge UI BFF listening at ${started.url}`)

const shutdown = async () => {
  await started.close()
  process.exit(0)
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
