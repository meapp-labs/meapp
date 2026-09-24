/**
 * Cross-runtime UUID generation. `Bun.randomUUIDv7` exists only inside Bun;
 * the Expo client (Hermes) needs the Web Crypto API — polyfilled by Expo
 * (crypto.getRandomValues). Falls back to a manual RFC-4122 v4 build if
 * crypto.randomUUID is unavailable.
 */
export function uuid(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c?.randomUUID) {
    return c.randomUUID()
  }
  if (c?.getRandomValues) {
    const bytes = new Uint8Array(16)
    c.getRandomValues(bytes)
    const b6 = bytes[6] ?? 0
    const b8 = bytes[8] ?? 0
    bytes[6] = (b6 & 0x0f) | 0x40 // version 4
    bytes[8] = (b8 & 0x3f) | 0x80 // variant 10
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  throw new Error('No secure random source available for UUID generation')
}
