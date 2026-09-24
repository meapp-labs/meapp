import {
  type BundleResponse,
  CIPHERTEXT_TYPE_PRE_KEY,
  CIPHERTEXT_TYPE_WHISPER,
  type DeviceInfo,
  E2E_CIPHERTEXT_MAX,
  type EncryptedMessageInput,
  encryptedMessageSchema,
} from '@meapp/shared'

import { getFetcher, postFetcher } from '../lib/api'
import { uuid } from '../lib/uuid'

/**
 * Client scaffolding for the Phase-10 E2E relay. The server is a dumb relay:
 * it stores public keys and opaque ciphertext, and never sees plaintext or
 * private keys. This module owns the transport + local key-store contract;
 * actual X3DH/PQXDH + Double Ratchet crypto plugs in via E2ECryptoProvider
 * (libsignal) in a later phase.
 */

// ─────────────────────────────────────────────────────────────
// Key storage (SecureStore on native; placeholder contract for web)
// ─────────────────────────────────────────────────────────────

export interface E2EKeyStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

const keyStoreBackend: E2EKeyStore = {
  // Wire to expo-secure-store in the crypto phase; native-only for now.
  async get() {
    return null
  },
  async set() {},
  async remove() {},
}

export const E2EKeyNamespace = {
  identityPrivate: (deviceId: string) => `e2e_identity_priv_${deviceId}`,
  signedPrekeyPrivate: (deviceId: string, id: number) => `e2e_sprekey_priv_${deviceId}_${id}`,
  oneTimePrekeyPrivate: (deviceId: string, id: number) => `e2e_otprekey_priv_${deviceId}_${id}`,
  session: (remoteUserId: string, remoteDeviceId: string) =>
    `e2e_session_${remoteUserId}_${remoteDeviceId}`,
} as const

// ─────────────────────────────────────────────────────────────
// Device identity
// ─────────────────────────────────────────────────────────────

const DEVICE_ID_KEY = 'meapp_e2e_device_id'

/**
 * Stable per-install device id (uuidv7). Persisted so re-registrations are
 * idempotent across app restarts.
 */
export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await keyStoreBackend.get(DEVICE_ID_KEY)
  if (existing) return existing

  const deviceId = uuid()
  await keyStoreBackend.set(DEVICE_ID_KEY, deviceId)
  return deviceId
}

/** Registers this install's device + identity key with the relay. */
export async function registerDevice(input: {
  deviceId: string
  platform: 'ios' | 'android' | 'web'
  identityKeyPublic: string
}): Promise<{ deviceId: string; registered: boolean }> {
  return postFetcher('e2e/device', input)
}

// ─────────────────────────────────────────────────────────────
// Prekey bundles
// ─────────────────────────────────────────────────────────────

export interface PrekeyUpload {
  prekeyId: number
  prekeyPublic: string
  signedPrekeyId: number
  signedPrekeyPublic: string
  signedPrekeySignature: string
  signedPrekeyExpiresAt: string
  kyberPrekeyId: number
  kyberPrekeyPublic: string
  kyberPrekeySignature: string
  isLastResort: boolean
}

/**
 * Uploads a batch of one-time prekeys (server caps at 150). Call after
 * registration and whenever the remaining OTP count drops low — the server
 * only signals refill via GET /e2e/devices consumers.
 */
export async function uploadPrekeyBundle(input: {
  deviceId: string
  identityKeyPublic: string
  prekeys: PrekeyUpload[]
}): Promise<{ uploaded: number; deviceId: string }> {
  return postFetcher('e2e/bundle', input)
}

/**
 * Fetches (and atomically consumes) a prekey bundle for the target user.
 * One-time prekeys are single-use server-side; falling back to a
 * last-resort bundle is normal under load and still safe (signed prekey).
 */
export async function fetchBundle(targetUserId: string): Promise<BundleResponse[]> {
  return getFetcher<BundleResponse[]>('e2e/bundle', { userId: targetUserId })
}

/** Lists a user's registered devices (safety-number UI, refill signal). */
export async function listDevices(targetUserId: string): Promise<DeviceInfo[]> {
  return getFetcher<DeviceInfo[]>('e2e/devices', { userId: targetUserId })
}

// ─────────────────────────────────────────────────────────────
// Encrypted send
// ─────────────────────────────────────────────────────────────

/** Validates + sends an opaque ciphertext message through the relay. */
export async function sendEncryptedMessage(
  input: EncryptedMessageInput,
): Promise<{ id: string; sequence: number }> {
  const parsed = encryptedMessageSchema.safeParse(input)
  if (!parsed.success) {
    throw new Error(`Invalid encrypted message: ${parsed.error.issues[0]?.message}`)
  }
  return postFetcher('send-message', parsed.data)
}

/**
 * Guard for the crypto phase: ciphertext must fit the server-side cap
 * BEFORE base64 expansion is applied client-side.
 */
export const maxPlaintextBytesForCiphertext = (ciphertextB64Length: number): number =>
  Math.floor((ciphertextB64Length * 3) / 4)

export const CIPHERTEXT_LIMITS = {
  /** Max base64 ciphertext accepted by the server. */
  ciphertextB64Max: E2E_CIPHERTEXT_MAX,
  /** Practical max plaintext to encrypt (~8KB after base64 + ratchet overhead). */
  plaintextBytes: 8 * 1024,
} as const

export { CIPHERTEXT_TYPE_PRE_KEY, CIPHERTEXT_TYPE_WHISPER }
