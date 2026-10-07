export type CommandResult = { ok: boolean; stdout: string; stderr: string }
type Options = {
  run: (...args: string[]) => Promise<CommandResult>
  platform?: string
  log?: (message: string) => void
  warn?: (message: string) => void
  sleep?: (milliseconds: number) => Promise<unknown>
}
const local = 'meapp-redis-local-dev'
const compat = `${local}-compat`
const compose = 'meapp-redis-dev'
const image = 'docker.io/library/redis:7-alpine'
const missingController = /controller\s+[`'"]?pids[`'"]?\s+is not available/i

/** Redis is optional. Keep Podman failures outside the API startup failure path. */
export async function ensureDevRedis({
  run,
  platform = process.platform,
  log = console.log,
  warn = console.warn,
  sleep = Bun.sleep,
}: Options): Promise<boolean> {
  const require = async (...args: string[]) => {
    const result = await run(...args)
    if (!result.ok) throw new Error(result.stderr || `podman ${args[0]} failed`)
    return result.stdout
  }
  const inspect = (name: string) =>
    run('inspect', '--type', 'container', name, '--format', '{{.State.Running}}')
  const create = (name: string, volume: string, compatibility = false) =>
    require('run', '--detach', ...(compatibility
      ? ['--cgroups=disabled']
      : []), '--name', name, '--publish', '127.0.0.1:6379:6379', '--volume', `${volume}:/data`, image)
  try {
    if (!(await run('info')).ok) {
      log('Starting Podman machine...')
      await require('machine', 'start')
    }
    const [composed, primary, compatible] = await Promise.all([
      inspect(compose),
      inspect(local),
      inspect(compat),
    ])
    let name =
      composed.stdout === 'true'
        ? compose
        : primary.stdout === 'true'
          ? local
          : compatible.stdout === 'true'
            ? compat
            : composed.ok
              ? compose
              : compatible.ok
                ? compat
                : local
    const state = name === compose ? composed : name === compat ? compatible : primary
    try {
      if (!state.ok) {
        log('Creating local Redis container...')
        await create(name, 'meapp-redis-dev-data')
      } else if (state.stdout !== 'true') {
        log('Starting local Redis container...')
        await require('start', name)
      }
    } catch (error) {
      // WSL can lose rootless cgroup delegation. Apply the workaround only to
      // our stopped local dev container, preserving it and its existing volume.
      if (platform !== 'win32' || name !== local || !missingController.test(String(error)))
        throw error
      const stopped = await inspect(local)
      if (!stopped.ok || stopped.stdout !== 'false') throw error
      const mounts = JSON.parse(
        await require('inspect', '--type', 'container', local, '--format', '{{json .Mounts}}'),
      ) as { Type: string; Destination: string; Name: string }[]
      const volume = mounts.find(
        (mount) => mount.Type === 'volume' && mount.Destination === '/data',
      )?.Name
      if (!volume) throw new Error('Cannot safely reuse the local Redis data volume.')
      log(
        'WSL cgroup failure: using a local Redis compatibility container with the same data volume.',
      )
      const existing = await inspect(compat)
      if (!existing.ok) await create(compat, volume, true)
      else if (existing.stdout !== 'true') await require('start', compat)
      name = compat
    }
    for (let attempt = 0; attempt < 30; attempt++) {
      const ping = await run('exec', name, 'redis-cli', 'ping')
      if (ping.ok && ping.stdout === 'PONG') {
        log('Redis ready.')
        return true
      }
      await sleep(500)
    }
    throw new Error(`Redis did not become ready. Check: podman logs ${name}`)
  } catch (error) {
    warn(`[Dev] Redis unavailable: ${error instanceof Error ? error.message : String(error)}`)
    warn(
      '[Dev] Starting without Redis: in-memory rate limits and WebSocket tickets; local-only message broadcasts.',
    )
    return false
  }
}
