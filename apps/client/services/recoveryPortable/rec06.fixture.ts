import 'fake-indexeddb/auto'
import { Database } from 'bun:sqlite'
import { expect, mock } from 'bun:test'
import { MeappIndexedDbStore } from '../e2eBrowserStore'
import { e2eSchemaSql } from '../e2eSchemaSql'
import {
  phrase,
  decryptRecoverySnapshot as webDecrypt,
  encryptPortableRecovery as webEncrypt,
} from '../recoveryCodec'
import { BrowserRecoveryAdapter } from './browser'
import { claimForSnapshot } from './contract'
import { NativeRecoveryAdapter, type NativeRecoveryDriver, type NativeRecoverySql } from './native'
import { rec01Snapshot } from './rec01.fixture'

// This exercises the native wire codec with a Web Crypto stand-in for Expo AES.
// Actual Expo AES / SQLCipher / keychain acceptance still requires a physical device.
type Sealed = { ivBytes: Uint8Array; ciphertextBytes: Uint8Array }
const buffer = (bytes: Uint8Array) => new Uint8Array(bytes).buffer
mock.module('expo-crypto', () => ({
  getRandomValues: (bytes: Uint8Array) => crypto.getRandomValues(bytes),
  AESEncryptionKey: {
    import: (bytes: Uint8Array) =>
      crypto.subtle.importKey('raw', buffer(bytes), 'AES-GCM', false, ['encrypt', 'decrypt']),
  },
  AESSealedData: {
    fromParts: (iv: string, ciphertext: string) => ({
      ivBytes: new Uint8Array(Buffer.from(iv, 'base64')),
      ciphertextBytes: new Uint8Array(Buffer.from(ciphertext, 'base64')),
    }),
  },
  async aesEncryptAsync(
    plaintext: Uint8Array,
    key: CryptoKey,
    options: { additionalData: Uint8Array },
  ) {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: buffer(options.additionalData), tagLength: 128 },
      key,
      buffer(plaintext),
    )
    return {
      iv: async () => Buffer.from(iv).toString('base64'),
      ciphertext: async () => Buffer.from(encrypted).toString('base64'),
    }
  },
  async aesDecryptAsync(sealed: Sealed, key: CryptoKey, options: { additionalData: Uint8Array }) {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: buffer(sealed.ivBytes),
          additionalData: buffer(options.additionalData),
          tagLength: 128,
        },
        key,
        buffer(sealed.ciphertextBytes),
      ),
    )
  },
}))
const nativeCodec = await import('../recoveryCodec.native')
const db = new Database(':memory:')
db.exec(e2eSchemaSql.replaceAll('--> statement-breakpoint', ''))
db.exec('PRAGMA user_version = 1')
const sql: NativeRecoverySql = {
  getFirstAsync: async <T>(query: string, ...params: (string | number | null)[]) =>
    db.query(query).get(...params) as T | null,
  getAllAsync: async <T>(query: string, ...params: (string | number | null)[]) =>
    db.query(query).all(...params) as T[],
  runAsync: async (query, ...params) => db.query(query).run(...params),
}
const driver: NativeRecoveryDriver = {
  async transaction<T>(work: (sql: NativeRecoverySql) => Promise<T>) {
    db.exec('BEGIN IMMEDIATE')
    try {
      const value = await work(sql)
      db.exec('COMMIT')
      return value
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  },
}
const snapshot = rec01Snapshot()
const key = phrase()
const browser = new MeappIndexedDbStore()
Reflect.set(browser, 'dbName', `rec06-${crypto.randomUUID()}`)
await browser.initialize()
try {
  const decodedNative = await nativeCodec.decryptRecoverySnapshot(
    snapshot.accountId,
    key,
    await webEncrypt(snapshot, key),
  )
  expect(decodedNative).toEqual(snapshot)
  const native = new NativeRecoveryAdapter(snapshot.accountId, driver)
  const nativeClaim = claimForSnapshot(decodedNative, crypto.randomUUID())
  await native.importSnapshot(decodedNative, nativeClaim)
  await native.completePendingClaim(nativeClaim)
  const fromNative = await native.exportSnapshot({
    accountId: snapshot.accountId,
    installId: nativeClaim.newInstallId,
    deviceId: 1,
    proof: snapshot.proof,
    createdAt: snapshot.createdAt,
  })
  const sealedNative = await nativeCodec.encryptPortableRecovery(fromNative, key)
  const decodedWeb = await webDecrypt(snapshot.accountId, key, sealedNative)
  expect(decodedWeb).toEqual(fromNative)
  const web = new BrowserRecoveryAdapter(snapshot.accountId, browser)
  const webClaim = claimForSnapshot(fromNative, crypto.randomUUID())
  await web.importSnapshot(fromNative, webClaim)
  await web.completePendingClaim(webClaim)
  const fromWeb = await web.exportSnapshot({
    accountId: snapshot.accountId,
    installId: webClaim.newInstallId,
    deviceId: 1,
    proof: snapshot.proof,
    createdAt: snapshot.createdAt,
  })
  expect(fromWeb.identities).toEqual(snapshot.identities)
  expect(fromWeb.contacts).toEqual(snapshot.contacts)
  expect(fromWeb.privateMetadata).toEqual(snapshot.privateMetadata)
  await expect(
    nativeCodec.decryptRecoverySnapshot('other-account', key, sealedNative),
  ).rejects.toThrow('incorrect')
  await expect(
    nativeCodec.decryptRecoverySnapshot(snapshot.accountId, phrase(), sealedNative),
  ).rejects.toThrow('incorrect')
  console.log(
    'REC06 PASS: web/native wire codec and real IndexedDB/SQLite adapter interoperability',
  )
} finally {
  const connection = Reflect.get(browser, 'db')
  connection.close()
  db.close()
}
