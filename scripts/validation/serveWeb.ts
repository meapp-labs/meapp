import { resolve, sep } from 'node:path'

// Serve an isolated exported bundle; never expose the checkout or bind to LAN.
const root = resolve(process.env.MEAPP_VALIDATION_WEB_ROOT ?? '')
if (!process.env.MEAPP_VALIDATION_WEB_ROOT) throw new Error('Set MEAPP_VALIDATION_WEB_ROOT')
const port = Number(process.env.MEAPP_VALIDATION_WEB_PORT ?? 18081)
Bun.serve({
  hostname: '127.0.0.1',
  port,
  async fetch(request) {
    const pathname = decodeURIComponent(new URL(request.url).pathname)
    const path = resolve(root, `.${pathname}`)
    if (path !== root && !path.startsWith(`${root}${sep}`))
      return new Response('Not found', { status: 404 })
    const file = Bun.file(path)
    if (path !== root && (await file.exists())) return new Response(file)
    if (pathname.includes('.')) return new Response('Not found', { status: 404 })
    return new Response(Bun.file(resolve(root, 'index.html')))
  },
})
console.log(`Validation web bundle: http://127.0.0.1:${port}`)
