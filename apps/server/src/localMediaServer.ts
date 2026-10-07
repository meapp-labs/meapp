import { env } from './lib/config.ts'
import { handleLocalMedia } from './lib/localMediaStorage.ts'

if (env.MEDIA_STORAGE !== 'local')
  throw new Error('Set MEDIA_STORAGE=local to run the local object server')
const development = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/
const origins = (env.DOMAIN ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
let activeUploads = 0
Bun.serve({
  hostname: '127.0.0.1',
  port: env.MEDIA_LOCAL_PORT,
  maxRequestBodySize: 100 * 1024 * 1024,
  idleTimeout: 255,
  async fetch(request) {
    const origin = request.headers.get('origin')
    const allowed =
      origin &&
      (env.NODE_ENV !== 'production'
        ? development.test(origin)
        : origins.some(
            (value) =>
              new URL(value.includes('://') ? value : `https://${value}`).origin === origin,
          ))
    let response: Response
    if (request.method === 'OPTIONS') response = new Response(null, { status: allowed ? 204 : 403 })
    else if (request.method === 'PUT' && activeUploads >= 4)
      response = new Response('Retry when another upload finishes', { status: 429 })
    else {
      if (request.method === 'PUT') activeUploads++
      try {
        response = await handleLocalMedia(request)
      } catch (error) {
        console.error('[Local media] Request failed', error)
        response = new Response('Storage unavailable', { status: 503 })
      } finally {
        if (request.method === 'PUT') activeUploads--
      }
    }
    if (allowed) {
      response.headers.set('Access-Control-Allow-Origin', origin)
      response.headers.set('Vary', 'Origin')
      response.headers.set('Access-Control-Allow-Methods', 'GET, HEAD, PUT, OPTIONS')
      response.headers.set(
        'Access-Control-Allow-Headers',
        'Content-Type, If-None-Match, Cache-Control',
      )
      response.headers.set('Access-Control-Expose-Headers', 'Content-Length')
    }
    return response
  },
})
console.log(`Local media server listening on 127.0.0.1:${env.MEDIA_LOCAL_PORT}`)
