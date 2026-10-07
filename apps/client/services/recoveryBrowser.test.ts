import { expect, test } from 'bun:test'

test('browser recovery retries safely and restores history with fresh protocol sessions', async () => {
  const child = Bun.spawn([process.execPath, 'services/recoveryBrowser.fixture.ts'], {
    cwd: import.meta.dir.replace(/[\\/]services$/, ''),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (code !== 0) throw new Error(`${stdout}\n${stderr}`)
  expect(stdout).toContain('failure status passed')
}, 30000)
