import { expect, test } from 'bun:test'
import { type CommandResult, ensureDevRedis } from './devRedis.ts'

const ok = (stdout = ''): CommandResult => ({ ok: true, stdout, stderr: '' })
const fail = (stderr = 'not found'): CommandResult => ({ ok: false, stdout: '', stderr })
const primary = 'meapp-redis-local-dev'
const compatible = `${primary}-compat`
const composed = 'meapp-redis-dev'
const options = { platform: 'win32', log: () => {}, warn: () => {}, sleep: async () => {} }

test('missing Podman and a failed machine start return degraded mode instead of throwing', async () => {
  expect(
    await ensureDevRedis({
      ...options,
      run: async () => {
        throw new Error('ENOENT')
      },
    }),
  ).toBe(false)
  const commands: string[][] = []
  expect(
    await ensureDevRedis({
      ...options,
      run: async (...args) => {
        commands.push(args)
        return fail('Podman machine could not start')
      },
    }),
  ).toBe(false)
  expect(commands).toEqual([['info'], ['machine', 'start']])
})

test('an existing compatibility container is reused without starting the broken original', async () => {
  const commands: string[][] = []
  expect(
    await ensureDevRedis({
      ...options,
      run: async (...args) => {
        commands.push(args)
        if (args[0] === 'inspect')
          return args[3] === composed ? fail() : ok(args[3] === compatible ? 'true' : 'false')
        return ok(args[0] === 'exec' ? 'PONG' : '')
      },
    }),
  ).toBe(true)
  expect(commands.some((args) => args[0] === 'start' || args[0] === 'run')).toBe(false)
  expect(commands.at(-1)).toEqual(['exec', compatible, 'redis-cli', 'ping'])
})

test('the WSL pids failure gets a targeted compatibility container sharing the original volume', async () => {
  const commands: string[][] = []
  expect(
    await ensureDevRedis({
      ...options,
      run: async (...args) => {
        commands.push(args)
        if (args[0] === 'inspect') {
          if (args.at(-1) === '{{json .Mounts}}')
            return ok(
              JSON.stringify([
                { Type: 'volume', Destination: '/data', Name: 'existing-redis-data' },
              ]),
            )
          return args[3] === primary ? ok('false') : fail()
        }
        if (args[0] === 'start')
          return fail('crun: controller `pids` is not available under /sys/fs/cgroup/non-systemd')
        return ok(args[0] === 'exec' ? 'PONG' : '')
      },
    }),
  ).toBe(true)
  const created = commands.find((args) => args[0] === 'run')
  expect(created).toContain('--cgroups=disabled')
  expect(created).toContain(compatible)
  expect(created).toContain('existing-redis-data:/data')
  expect(created).toContain('127.0.0.1:6379:6379')
  expect(commands.some((args) => ['rm', 'stop', 'update', 'rename'].includes(args[0] ?? ''))).toBe(
    false,
  )
})

test('compose containers and unrelated failures are left untouched, with degraded startup', async () => {
  for (const name of [composed, primary]) {
    const commands: string[][] = []
    expect(
      await ensureDevRedis({
        ...options,
        run: async (...args) => {
          commands.push(args)
          if (args[0] === 'inspect') return args[3] === name ? ok('false') : fail()
          if (args[0] === 'start')
            return fail(name === composed ? 'controller `pids` is not available' : 'storage error')
          return ok()
        },
      }),
    ).toBe(false)
    expect(commands.some((args) => args[0] === 'run')).toBe(false)
  }
})

test('compatibility recovery refuses a running original or an unknown data volume', async () => {
  for (const running of [true, false]) {
    let inspections = 0
    const commands: string[][] = []
    expect(
      await ensureDevRedis({
        ...options,
        run: async (...args) => {
          commands.push(args)
          if (args[0] === 'inspect') {
            if (args.at(-1) === '{{json .Mounts}}') return ok('[]')
            if (args[3] !== primary) return fail()
            return ok(++inspections > 1 && running ? 'true' : 'false')
          }
          if (args[0] === 'start') return fail('controller `pids` is not available')
          return ok()
        },
      }),
    ).toBe(false)
    expect(commands.some((args) => args[0] === 'run')).toBe(false)
  }
})

test('unready Redis has bounded polling and does not abort development startup', async () => {
  let pings = 0
  expect(
    await ensureDevRedis({
      ...options,
      run: async (...args) => {
        if (args[0] === 'inspect') return args[3] === primary ? ok('true') : fail()
        if (args[0] === 'exec') {
          pings++
          return fail('Redis not ready')
        }
        return ok()
      },
    }),
  ).toBe(false)
  expect(pings).toBe(30)
})
