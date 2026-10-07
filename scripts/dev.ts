import { createServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureDevRedis } from './devRedis.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const podmanChildren = new Set<ReturnType<typeof Bun.spawn>>()
async function podman(...args: string[]) {
  try {
    const child = Bun.spawn(['podman', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
    podmanChildren.add(child)
    const timeout =
      args[0] === 'machine' || args[0] === 'run' ? 90_000 : args[0] === 'exec' ? 1500 : 10_000
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeout)
    try {
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      return {
        ok: exitCode === 0 && !timedOut,
        stdout: stdout.trim(),
        stderr: timedOut ? `podman ${args[0]} timed out` : stderr.trim(),
      }
    } finally {
      clearTimeout(timer)
      podmanChildren.delete(child)
    }
  } catch (error) {
    return { ok: false, stdout: '', stderr: error instanceof Error ? error.message : String(error) }
  }
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
  for (const child of podmanChildren) child.kill()
  server?.kill()
  client?.kill()
}

try {
  const stop = () => {
    stopChildren()
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  await ensureDevRedis({ run: podman })

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
    let exited = false
    void server.exited.then(() => {
      exited = true
    })
    const deadline = Date.now() + 30_000
    while (!(await isRunning('http://127.0.0.1:3000/health', '"status":"ok"'))) {
      if (exited) throw new Error('API server exited before becoming ready. See the error above.')
      if (Date.now() >= deadline)
        throw new Error(
          'API server did not respond on port 3000 within 30 seconds. See the server output above.',
        )
      await Bun.sleep(250)
    }
    console.log('API server ready on http://127.0.0.1:3000.')
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
