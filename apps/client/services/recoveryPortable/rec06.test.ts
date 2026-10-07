import { expect, test } from 'bun:test'
test('web/native portable codecs and storage adapters interoperate in an isolated process', async () => {
  const process = Bun.spawn(
    [
      Bun.argv[0] ?? 'bun',
      'run',
      new URL('./rec06.fixture.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const [stdout, stderr, exit] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])
  expect(exit, stderr).toBe(0)
  expect(stdout).toContain('REC06 PASS')
})
