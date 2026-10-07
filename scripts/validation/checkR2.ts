import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Use configured credentials only for one newly generated ciphertext object.
// No database connection, bucket listing, existing-object access or sweeping.
process.env.NODE_ENV = 'development'
process.env.MEDIA_STORAGE = 'r2'
process.env.DATABASE_URL = join(tmpdir(), 'meapp-built-validation-20261007', 'r2-unused.db')
const { deleteObject, headObject, mediaEnabled, publicMediaUrl, signedObjectUrl } = await import(
  '../../apps/server/src/lib/mediaStorage'
)
if (!mediaEnabled()) throw new Error('R2 credentials are not configured')
const key = `cap/${crypto.randomUUID().replaceAll('-', '')}/orig.enc`
const bytes = crypto.getRandomValues(new Uint8Array(1024))
const headers = {
  'Content-Type': 'application/octet-stream',
  'Content-Length': String(bytes.length),
  'If-None-Match': '*',
}
const result: Record<string, unknown> = { scope: 'one disposable R2 object', bytes: bytes.length }
try {
  const url = signedObjectUrl('PUT', key, 60, headers)
  const cors = await fetch(url, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://127.0.0.1:18081',
      'Access-Control-Request-Method': 'PUT',
      'Access-Control-Request-Headers': 'content-type,if-none-match',
    },
    signal: AbortSignal.timeout(15000),
  })
  result.localBrowserCors = cors.headers.get('access-control-allow-origin') !== null
  const upload = await fetch(url, {
    method: 'PUT',
    headers,
    body: bytes,
    signal: AbortSignal.timeout(15000),
  })
  result.uploadStatus = upload.status
  if (!upload.ok) throw new Error(`R2 upload rejected (${upload.status})`)
  result.headSize = await headObject(key)
  const repeat = await fetch(url, {
    method: 'PUT',
    headers,
    body: bytes,
    signal: AbortSignal.timeout(15000),
  })
  result.repeatStatus = repeat.status
  const download = await fetch(publicMediaUrl(key), { signal: AbortSignal.timeout(15000) })
  result.downloadStatus = download.status
  if (!download.ok) throw new Error(`R2 public download rejected (${download.status})`)
  const returned = new Uint8Array(await download.arrayBuffer())
  result.exactCiphertext =
    returned.length === bytes.length && returned.every((byte, index) => byte === bytes[index])
  if (result.headSize !== bytes.length || result.repeatStatus !== 412 || !result.exactCiphertext)
    throw new Error('R2 integrity/immutability check failed')
} catch (error) {
  // Avoid logging presigned URLs or credentials carried by network errors.
  result.failure = error instanceof Error ? error.name : 'StorageError'
  process.exitCode = 1
} finally {
  try {
    await deleteObject(key)
    result.cleanedUp = (await headObject(key)) === null
    if (!result.cleanedUp) process.exitCode = 1
  } catch {
    result.cleanedUp = false
    process.exitCode = 1
  }
  console.log(JSON.stringify(result))
}
