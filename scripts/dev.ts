import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const localRedisContainer = 'meapp-redis-local-dev'
const composeRedisContainer = 'meapp-redis-dev'
const redisImage = 'docker.io/library/redis:7-alpine'
const decoder = new TextDecoder()

function podman(...args: string[]) {
  const result = Bun.spawnSync(['podman', ...args], { cwd: root })
  return {
    ok: result.exitCode === 0,
    stdout: decoder.decode(result.stdout).trim(),
    stderr: decoder.decode(result.stderr).trim(),
  }
}

function requirePodman(...args: string[]) {
  const result = podman(...args)
  if (!result.ok) throw new Error(result.stderr || `podman ${args[0]} failed`)
  return result.stdout
}

function startRedis() {
  if (!podman('info').ok) {
    console.log('Starting Podman machine...')
    requirePodman('machine', 'start')
  }

  const composeContainer = podman(
    'inspect',
    '--type',
    'container',
    composeRedisContainer,
    '--format',
    '{{.State.Running}}',
  )
  const localContainer = podman(
    'inspect',
    '--type',
    'container',
    localRedisContainer,
    '--format',
    '{{.State.Running}}',
  )
  const useCompose =
    composeContainer.stdout === 'true' ||
    (localContainer.stdout !== 'true' && composeContainer.ok)
  const redisContainer = useCompose ? composeRedisContainer : localRedisContainer
  const running = useCompose ? composeContainer : localContainer
  if (!running.ok) {
    console.log('Creating local Redis container...')
    requirePodman(
      'run',
      '--detach',
      '--name',
      redisContainer,
      '--publish',
      '127.0.0.1:6379:6379',
      '--volume',
      'meapp-redis-dev-data:/data',
      redisImage,
    )
  } else if (running.stdout !== 'true') {
    console.log('Starting local Redis container...')
    requirePodman('start', redisContainer)
  }

  for (let attempt = 0; attempt < 30; attempt++) {
    if (podman('exec', redisContainer, 'redis-cli', 'ping').stdout === 'PONG') return
    Bun.sleepSync(500)
  }
  throw new Error(`Redis did not become ready. Check: podman logs ${redisContainer}`)
}

async function isRunning(url: string, expected: string) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) })
    return response.ok && (await response.text()).includes(expected)
  } catch {
    return false
  }
}

function portAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createServer()
    socket.once('error', () => resolve(false))
    socket.listen(port, '127.0.0.1', () => socket.close(() => resolve(true)))
  })
}

let server: ReturnType<typeof Bun.spawn> | undefined
let client: ReturnType<typeof Bun.spawn> | undefined

function stopChildren() {
  server?.kill()
  client?.kill()
}

try {
  startRedis()
  console.log('Redis ready.')

  if (await isRunning('http://127.0.0.1:3000/health', '"status":"ok"')) {
    console.log('API server already running on port 3000.')
  } else {
    if (!(await portAvailable(3000))) throw new Error('Port 3000 is in use by another app.')
    server = Bun.spawn(['bun', '--filter', '@meapp/server', 'dev'], {
      cwd: root,
      env: { ...process.env, HOST: '127.0.0.1' },
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    })
  }

  if (await isRunning('http://127.0.0.1:8081/status', 'packager-status:running')) {
    console.log('Expo already running on port 8081.')
  } else {
    let port = 8081
    while (port < 8091 && !(await portAvailable(port))) port++
    if (port === 8091) throw new Error('No free Expo port from 8081 to 8090.')
    console.log(`Starting Expo on port ${port}...`)
    client = Bun.spawn(['bun', '--filter', '@meapp/client', 'dev', '--port', String(port)], {
      cwd: root,
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    })
  }

  process.on('SIGINT', stopChildren)
  process.on('SIGTERM', stopChildren)
  const children = [server, client].filter((child) => child !== undefined)
  if (children.length === 0) {
    console.log('Everything is already running.')
    process.exit(0)
  }
  const exitCode = await Promise.race(children.map((child) => child.exited))
  stopChildren()
  if (exitCode !== 0) process.exitCode = exitCode
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  stopChildren()
  process.exitCode = 1
}
