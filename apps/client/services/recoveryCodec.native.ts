import type { PortableRecoverySnapshot } from '@meapp/shared'
import * as Crypto from 'expo-crypto'
import { Gunzip, gzipSync } from 'fflate'
import {
  PORTABLE_MAX_TEXT_BYTES,
  decodePortableValue,
  encodePortableValue,
} from './recoveryPortable/codec'
import {
  PortableRecoveryError,
  parsePortableSnapshot,
  serializePortableSnapshot,
} from './recoveryPortable/contract'

function base64(value: Uint8Array): string {
  const encoded = encodePortableValue(value)
  if (!Array.isArray(encoded) || encoded[0] !== 'bytes') throw new Error('Invalid binary value')
  return encoded[1]
}
function bytes(value: string): Uint8Array {
  const decoded = decodePortableValue(['bytes', value])
  if (!(decoded instanceof Uint8Array)) throw new Error('Invalid binary encoding')
  return decoded
}
export const phrase = () =>
  base64(Crypto.getRandomValues(new Uint8Array(32)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
function keyBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error('Enter the complete recovery key')
  return bytes(`${value.replaceAll('-', '+').replaceAll('_', '/')}=`)
}
function decompress(value: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = []
  let length = 0
  const stream = new Gunzip((chunk) => {
    length += chunk.length
    if (length > PORTABLE_MAX_TEXT_BYTES) throw new Error('Recovery plaintext exceeds size limit')
    chunks.push(chunk)
  })
  // Bounded input chunks keep the decompressor from allocating an entire large output at once.
  for (let offset = 0; offset < value.length; offset += 1024)
    stream.push(value.subarray(offset, offset + 1024), offset + 1024 >= value.length)
  if (!value.length) stream.push(value, true)
  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}
export async function encryptPortableRecovery(data: PortableRecoverySnapshot, keyText: string) {
  const key = await Crypto.AESEncryptionKey.import(keyBytes(keyText))
  const plaintext = gzipSync(new TextEncoder().encode(serializePortableSnapshot(data)))
  const sealed = await Crypto.aesEncryptAsync(plaintext, key, {
    nonce: { length: 12 },
    tagLength: 16,
    additionalData: new TextEncoder().encode(data.accountId),
  })
  return {
    iv: await sealed.iv('base64'),
    ciphertext: await sealed.ciphertext({ includeTag: true, encoding: 'base64' }),
  }
}
export async function decryptRecoverySnapshot(
  accountId: string,
  keyText: string,
  encrypted: { iv: string; ciphertext: string },
): Promise<PortableRecoverySnapshot> {
  const material = keyBytes(keyText)
  let plaintext: Uint8Array
  try {
    const key = await Crypto.AESEncryptionKey.import(material)
    plaintext = await Crypto.aesDecryptAsync(
      Crypto.AESSealedData.fromParts(encrypted.iv, encrypted.ciphertext, 16),
      key,
      {
        additionalData: new TextEncoder().encode(accountId),
      },
    )
  } catch {
    throw new Error('Recovery key is incorrect or the backup is damaged')
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(decompress(plaintext))
  if (!Array.isArray(JSON.parse(text)))
    throw new PortableRecoveryError(
      'INCOMPATIBLE_FORMAT',
      'Restore this older backup in the updated web app first, then update the backup for native recovery',
    )
  return parsePortableSnapshot(text, accountId)
}
