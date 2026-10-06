import { createHash, createHmac } from 'node:crypto'
import { env } from './config.ts'

const encode = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const hmac = (key: Buffer | string, value: string) =>
  createHmac('sha256', key).update(value).digest()

export const mediaEnabled = () =>
  Boolean(
    env.R2_ACCOUNT_ID &&
      env.R2_ACCESS_KEY_ID &&
      env.R2_SECRET_ACCESS_KEY &&
      env.R2_BUCKET &&
      env.R2_PUBLIC_URL,
  )

function credentials() {
  if (!mediaEnabled()) throw new Error('Encrypted media storage is not configured')
  return {
    account: env.R2_ACCOUNT_ID as string,
    access: env.R2_ACCESS_KEY_ID as string,
    secret: env.R2_SECRET_ACCESS_KEY as string,
    bucket: env.R2_BUCKET as string,
  }
}

export function publicMediaUrl(key: string) {
  return `${env.R2_PUBLIC_URL?.replace(/\/$/, '')}/${key}`
}

/** S3 SigV4 query signature. Only a fixed object key and method are delegated. */
export function signedObjectUrl(
  method: 'PUT' | 'HEAD' | 'DELETE',
  key: string,
  expiresSeconds: number,
  requestHeaders: Record<string, string> = {},
) {
  const { account, access, secret, bucket } = credentials()
  const host = `${account}.r2.cloudflarestorage.com`
  const path = `/${encode(bucket)}/${key.split('/').map(encode).join('/')}`
  const now = new Date()
  const dateTime = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const day = dateTime.slice(0, 8)
  const scope = `${day}/auto/s3/aws4_request`
  const headers: Record<string, string> = {
    host,
    ...Object.fromEntries(Object.entries(requestHeaders).map(([k, v]) => [k.toLowerCase(), v])),
  }
  const headerNames = Object.keys(headers).sort()
  const signedHeaders = headerNames.join(';')
  const params: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${access}/${scope}`,
    'X-Amz-Date': dateTime,
    'X-Amz-Expires': String(expiresSeconds),
    'X-Amz-SignedHeaders': signedHeaders,
  }
  const query = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encode(k)}=${encode(v)}`)
    .join('&')
  const canonicalHeaders = headerNames.map((name) => `${name}:${headers[name]?.trim()}\n`).join('')
  const request = [method, path, query, canonicalHeaders, signedHeaders, 'UNSIGNED-PAYLOAD'].join(
    '\n',
  )
  const stringToSign = ['AWS4-HMAC-SHA256', dateTime, scope, sha256(request)].join('\n')
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secret}`, day), 'auto'), 's3'), 'aws4_request')
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')
  return `https://${host}${path}?${query}&X-Amz-Signature=${signature}`
}

export async function headObject(key: string): Promise<number | null> {
  const response = await fetch(signedObjectUrl('HEAD', key, 60), {
    method: 'HEAD',
    signal: AbortSignal.timeout(15_000),
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`R2 HEAD failed (${response.status})`)
  const length = response.headers.get('content-length')
  if (length === null || !/^\d+$/.test(length))
    throw new Error('R2 returned an invalid object length')
  const size = Number(length)
  if (!Number.isSafeInteger(size)) throw new Error('R2 returned an invalid object length')
  return size
}

export async function deleteObject(key: string): Promise<void> {
  const response = await fetch(signedObjectUrl('DELETE', key, 60), {
    method: 'DELETE',
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok && response.status !== 404)
    throw new Error(`R2 DELETE failed (${response.status})`)
}
