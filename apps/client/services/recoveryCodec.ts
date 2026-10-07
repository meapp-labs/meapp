import type { PortableRecoverySnapshot } from '@meapp/shared'
import { PORTABLE_MAX_TEXT_BYTES } from './recoveryPortable/codec'
import { parsePortableSnapshot, serializePortableSnapshot } from './recoveryPortable/contract'

type Encoded = null | string | number | boolean | Encoded[] | { [key: string]: Encoded }
type StoreRow = { key: string | number; value: Encoded }
export type Snapshot = {
  version: 1
  storeVersion?: number
  accountId: string
  installId: string
  proof: string
  stores: Record<string, StoreRow[]>
}

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function bytes(encoded: string): Uint8Array {
  return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
}

function buffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(new ArrayBuffer(value.length))
  copy.set(value)
  return copy.buffer
}

export const phrase = () =>
  base64(crypto.getRandomValues(new Uint8Array(32)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
const phraseBytes = (value: string) =>
  bytes(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4))

export function encode(value: unknown): Encoded {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value instanceof Uint8Array) return { $meappBytes: base64(value) }
  if (value instanceof ArrayBuffer) return { $meappBuffer: base64(new Uint8Array(value)) }
  if (Array.isArray(value)) return value.map(encode)
  if (
    typeof value === 'object' &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.fromEntries(Object.entries(value).map(([key, part]) => [key, encode(part)]))
  }
  throw new Error('Encrypted device storage contains an unsupported value')
}

export function decode(value: Encoded): unknown {
  if (Array.isArray(value)) return value.map(decode)
  if (value && typeof value === 'object') {
    if (Object.keys(value).length === 1 && typeof value.$meappBytes === 'string')
      return bytes(value.$meappBytes)
    if (Object.keys(value).length === 1 && typeof value.$meappBuffer === 'string')
      return buffer(bytes(value.$meappBuffer))
    return Object.fromEntries(Object.entries(value).map(([key, part]) => [key, decode(part)]))
  }
  return value
}

async function compress(plaintext: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream('gzip')
  const pending = new Response(stream.readable).arrayBuffer()
  const sink = stream.writable.getWriter()
  await sink.write(buffer(plaintext))
  await sink.close()
  return new Uint8Array(await pending)
}

async function decompress(compressed: Uint8Array): Promise<Uint8Array> {
  const reader = new Blob([buffer(compressed)])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
    .getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > PORTABLE_MAX_TEXT_BYTES) {
        await reader.cancel()
        throw new Error('Recovery plaintext exceeds size limit')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

export async function encryptSnapshot(data: Snapshot, keyText: string) {
  return encryptRecoveryText(data.accountId, JSON.stringify(data), keyText)
}

export async function encryptPortableRecovery(data: PortableRecoverySnapshot, keyText: string) {
  return encryptRecoveryText(data.accountId, serializePortableSnapshot(data), keyText)
}

async function encryptRecoveryText(accountId: string, text: string, keyText: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(keyText)) throw new Error('Enter the complete recovery key')
  const key = await crypto.subtle.importKey('raw', buffer(phraseBytes(keyText)), 'AES-GCM', false, [
    'encrypt',
  ])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = await compress(new TextEncoder().encode(text))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: buffer(iv), additionalData: new TextEncoder().encode(accountId) },
    key,
    buffer(plaintext),
  )
  return { iv: base64(iv), ciphertext: base64(new Uint8Array(ciphertext)) }
}

export async function decryptSnapshot(
  accountId: string,
  keyText: string,
  encrypted: { iv: string; ciphertext: string },
): Promise<Snapshot> {
  const text = await decryptRecoveryText(accountId, keyText, encrypted)
  return validateLegacySnapshot(JSON.parse(text), accountId)
}

export async function decryptRecoverySnapshot(
  accountId: string,
  keyText: string,
  encrypted: { iv: string; ciphertext: string },
): Promise<Snapshot | PortableRecoverySnapshot> {
  const text = await decryptRecoveryText(accountId, keyText, encrypted)
  const parsed: unknown = JSON.parse(text)
  return Array.isArray(parsed)
    ? parsePortableSnapshot(text, accountId)
    : validateLegacySnapshot(parsed, accountId)
}

async function decryptRecoveryText(
  accountId: string,
  keyText: string,
  encrypted: { iv: string; ciphertext: string },
): Promise<string> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(keyText)) throw new Error('Enter the complete recovery key')
  let plaintext: ArrayBuffer
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      buffer(phraseBytes(keyText)),
      'AES-GCM',
      false,
      ['decrypt'],
    )
    plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: buffer(bytes(encrypted.iv)),
        additionalData: new TextEncoder().encode(accountId),
      },
      key,
      buffer(bytes(encrypted.ciphertext)),
    )
  } catch {
    throw new Error('Recovery key is incorrect or the backup is damaged')
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(
    await decompress(new Uint8Array(plaintext)),
  )
}

function validateLegacySnapshot(value: unknown, accountId: string): Snapshot {
  if (!value || typeof value !== 'object') throw new Error('Invalid recovery backup')
  const parsed = value as Snapshot
  if (parsed.version !== 1) throw new Error('Recovery backup is incompatible with this app version')
  if (
    parsed.version !== 1 ||
    parsed.accountId !== accountId ||
    !parsed.installId ||
    !parsed.proof ||
    !parsed.stores
  )
    throw new Error('Invalid recovery backup')
  return parsed
}
