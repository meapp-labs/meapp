import { createHmac, timingSafeEqual } from 'node:crypto'
import { link, mkdir, open, stat, unlink } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { MEDIA_MAX_BYTES } from '@meapp/shared'
import { env } from './config.ts'

export function localObjectPath(key: string) {
  if (!/^(?:cap\/[a-f0-9]{32}\/(?:orig|thumb)\.enc|avatars\/[a-f0-9-]{36}\.webp)$/.test(key))
    throw new Error('Invalid local object key')
  if (!env.MEDIA_LOCAL_DIRECTORY) throw new Error('Local media directory is not configured')
  const root = resolve(env.MEDIA_LOCAL_DIRECTORY)
  const target = resolve(root, ...key.split('/'))
  if (!target.startsWith(`${root}${sep}`)) throw new Error('Invalid local object path')
  return target
}
function signature(key: string, expiry: number, size: number, mime: string) {
  return createHmac('sha256', env.WS_TICKET_SECRET)
    .update(JSON.stringify(['meapp-local-media-put-v1', key, expiry, size, mime]))
    .digest('hex')
}
export function localSignedPut(key: string, seconds: number, size: number, mime: string) {
  localObjectPath(key)
  if (!Number.isSafeInteger(size) || size < 1 || size > MEDIA_MAX_BYTES)
    throw new Error('Invalid local upload size')
  const expiry = Math.floor(Date.now() / 1000) + seconds
  const query = new URLSearchParams({
    expiry: String(expiry),
    size: String(size),
    mime,
    signature: signature(key, expiry, size, mime),
  })
  return `${env.MEDIA_LOCAL_PUBLIC_URL?.replace(/\/$/, '')}/${key}?${query}`
}
export async function localHead(key: string) {
  try {
    return (await stat(localObjectPath(key))).size
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
export async function localDelete(key: string) {
  try {
    await unlink(localObjectPath(key))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

/** Separate loopback process: large uploads do not raise the API's 700 KiB cap. */
export async function handleLocalMedia(request: Request): Promise<Response> {
  const headers = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }
  const respond = (status: number, message: string) => new Response(message, { status, headers })
  const url = new URL(request.url)
  const key = url.pathname.slice(1)
  let path: string
  try {
    path = localObjectPath(key)
  } catch {
    return respond(404, 'Not found')
  }
  if (request.method === 'GET' || request.method === 'HEAD') {
    const file = Bun.file(path)
    if (!(await file.exists())) return respond(404, 'Not found')
    return new Response(request.method === 'HEAD' ? null : file, {
      headers: {
        ...headers,
        'Content-Type': key.startsWith('avatars/') ? 'image/webp' : 'application/octet-stream',
        'Content-Length': String(file.size),
        'Cache-Control': 'public, max-age=3600',
      },
    })
  }
  if (request.method !== 'PUT') return respond(405, 'Method not allowed')
  const expiry = Number(url.searchParams.get('expiry'))
  const size = Number(url.searchParams.get('size'))
  const mime = url.searchParams.get('mime') ?? ''
  const supplied = url.searchParams.get('signature') ?? ''
  if (
    !Number.isSafeInteger(expiry) ||
    expiry < Math.floor(Date.now() / 1000) ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > MEDIA_MAX_BYTES ||
    !/^[a-f0-9]{64}$/.test(supplied) ||
    !timingSafeEqual(
      Buffer.from(supplied, 'hex'),
      Buffer.from(signature(key, expiry, size, mime), 'hex'),
    )
  )
    return respond(403, 'Invalid upload authorization')
  if (
    request.headers.get('content-type') !== mime ||
    (request.headers.has('content-length') &&
      Number(request.headers.get('content-length')) !== size)
  )
    return respond(400, 'Upload headers do not match reservation')
  if (await Bun.file(path).exists()) return respond(412, 'Object already exists')
  if (!request.body) return respond(400, 'Missing body')
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${crypto.randomUUID()}.partial`
  const file = await open(temporary, 'wx')
  const reader = request.body.getReader()
  let count = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      count += chunk.value.length
      if (count > size) {
        await reader.cancel()
        return respond(413, 'Upload exceeds reservation')
      }
      let offset = 0
      while (offset < chunk.value.length) {
        const result = await file.write(chunk.value, offset, chunk.value.length - offset)
        if (!result.bytesWritten) throw new Error('Local storage write failed')
        offset += result.bytesWritten
      }
    }
    if (count !== size) return respond(400, 'Upload is incomplete')
    await file.sync()
    await file.close()
    try {
      await link(temporary, path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        return respond(412, 'Object already exists')
      throw error
    }
    return respond(201, 'Stored')
  } finally {
    reader.releaseLock()
    await file.close().catch(() => undefined)
    await unlink(temporary).catch(() => undefined)
  }
}
