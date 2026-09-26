import type { SignalProtocolLocalStore } from '@open-e2ee/signal-protocol-sdk'

const KEY_NAME = 'meapp:e2e:private-metadata-key'

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(new ArrayBuffer(bytes.length))
  copy.set(bytes)
  return copy.buffer
}

async function getKey(storage: SignalProtocolLocalStore): Promise<CryptoKey> {
  let encoded = await storage.getMetadata(KEY_NAME)
  if (!encoded) {
    const candidate = toBase64(crypto.getRandomValues(new Uint8Array(32)))
    const created = await storage.compareAndSetMetadata(KEY_NAME, null, candidate)
    encoded = created ? candidate : await storage.getMetadata(KEY_NAME)
  }
  if (!encoded) throw new Error('Private metadata key is unavailable')
  return crypto.subtle.importKey('raw', toArrayBuffer(fromBase64(encoded)), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])
}

export async function getPrivateMetadata(
  storage: SignalProtocolLocalStore,
  key: string,
): Promise<string | null> {
  const saved = await storage.getMetadata(key)
  if (saved === null) return null
  const [version, nonce, ciphertext] = saved.split(':')
  if (version !== 'v1' || !nonce || !ciphertext) {
    throw new Error('Private metadata is not encrypted')
  }
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(fromBase64(nonce)) },
    await getKey(storage),
    toArrayBuffer(fromBase64(ciphertext)),
  )
  return new TextDecoder().decode(plaintext)
}

export async function setPrivateMetadata(
  storage: SignalProtocolLocalStore,
  key: string,
  value: string,
): Promise<void> {
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(nonce) },
    await getKey(storage),
    toArrayBuffer(new TextEncoder().encode(value)),
  )
  await storage.setMetadata(key, `v1:${toBase64(nonce)}:${toBase64(new Uint8Array(ciphertext))}`)
}

export const deletePrivateMetadata = (storage: SignalProtocolLocalStore, key: string) =>
  storage.deleteMetadata(key)
