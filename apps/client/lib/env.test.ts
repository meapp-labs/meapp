import { expect, test } from 'bun:test'

async function inspect(url: string, variant: string) {
  const child = Bun.spawn([process.execPath, `${import.meta.dir}/envValidation.fixture.ts`], {
    env: {
      ...process.env,
      APP_VARIANT: 'development',
      MEAPP_TEST_APP_VARIANT: variant,
      EXPO_PUBLIC_API_URL: url,
      EXPO_PUBLIC_ENV: 'preview',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code, stdout, stderr }
}

test('explicit public environment values select the configured API', async () => {
  const result = await inspect('https://api.example.test', 'production')
  expect(result.code).toBe(0)
  expect(JSON.parse(result.stdout)).toMatchObject({
    EXPO_PUBLIC_API_URL: 'https://api.example.test',
    EXPO_PUBLIC_ENV: 'preview',
  })
})

test('exported production configuration rejects a cleartext API without runtime APP_VARIANT', async () => {
  const result = await inspect('http://127.0.0.1:18080', 'production')
  expect(result.code).toBe(1)
  expect(result.stderr).toContain('Production build requires an https EXPO_PUBLIC_API_URL')
  expect((await inspect('http://127.0.0.1:18080', 'development')).code).toBe(0)
})

test('production export fails before bundling when the API configuration is unsafe', async () => {
  const child = Bun.spawn([process.execPath, '-e', "await import('./app.config.ts')"], {
    cwd: import.meta.dir.replace(/[\\/]lib$/, ''),
    env: {
      ...process.env,
      APP_VARIANT: 'production',
      EXPO_PUBLIC_API_URL: 'http://127.0.0.1:18080',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  expect(code).not.toBe(0)
  expect(stderr).toContain('Production builds require an HTTPS EXPO_PUBLIC_API_URL')
})
