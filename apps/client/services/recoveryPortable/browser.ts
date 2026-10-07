import {
  PORTABLE_RECOVERY_FORMAT,
  PORTABLE_RECOVERY_SDK,
  PORTABLE_RECOVERY_VERSION,
  portablePendingClaimSchema,
  portablePrivateMetadataKeySchema,
} from '@meapp/shared'
import type { SignalProtocolLocalStore } from '@open-e2ee/signal-protocol-sdk'
import type { IDBPDatabase } from 'idb'
import { type Snapshot, decode } from '../recoveryCodec'
import { decodePortableValue, encodePortableValue, stringifyPortableValue } from './codec'
import {
  type PortablePendingClaim,
  type PortableRecoveryAdapter,
  PortableRecoveryError,
  type PortableRecoverySnapshot,
  detectRecoveryFormat,
  validatePortableImport,
  validatePortableSnapshot,
} from './contract'

const STORES = [
  'metadata',
  'identity',
  'contacts',
  'prekeys',
  'sessions',
  'securityEvents',
  'sesameUsers',
  'senderKeyRecords',
  'skippedSenderKeys',
  'messageRecords',
] as const
const ACCOUNT = 'meta:meapp:e2e:account'
const INSTALL = 'meta:meapp:e2e:install'
const DEVICE = 'meta:meapp:e2e:device-id'
const PENDING = 'meta:meapp:e2e:restore-pending'
const PRIVATE_KEY = 'meta:meapp:e2e:private-metadata-key'
const RECEIVED = 'received-content:'
type Rows = Record<string, Map<string | number, unknown>>
type Context = Parameters<PortableRecoveryAdapter['exportSnapshot']>[0]

function invalid(message: string): never {
  throw new PortableRecoveryError('INVALID_SNAPSHOT', message)
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid('Invalid browser recovery record')
  return value as Record<string, unknown>
}

function buffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer
}

function bytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array)) invalid('Invalid encrypted browser recovery value')
  return value
}

function fromBase64(value: string): Uint8Array {
  return bytes(decodePortableValue(['bytes', value]))
}

function base64(value: Uint8Array): string {
  const encoded = encodePortableValue(value)
  if (!Array.isArray(encoded) || encoded[0] !== 'bytes') invalid('Invalid binary value')
  return encoded[1]
}

async function aesKey(value: unknown): Promise<CryptoKey> {
  const material = bytes(value)
  if (material.length !== 32) invalid('Invalid browser storage key')
  return crypto.subtle.importKey('raw', buffer(material), 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function decrypt(key: CryptoKey, value: unknown): Promise<string> {
  const encrypted = bytes(value)
  if (encrypted.length < 28) invalid('Invalid encrypted browser record')
  return new TextDecoder('utf-8', { fatal: true }).decode(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: buffer(encrypted.subarray(0, 12)) },
      key,
      buffer(encrypted.subarray(12)),
    ),
  )
}

async function encrypt(key: CryptoKey, plaintext: string): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: buffer(iv) },
      key,
      new TextEncoder().encode(plaintext),
    ),
  )
  const result = new Uint8Array(iv.length + ciphertext.length)
  result.set(iv)
  result.set(ciphertext, iv.length)
  return result
}

function sameClaim(left: PortablePendingClaim, right: PortablePendingClaim): boolean {
  return (
    left.accountId === right.accountId &&
    left.oldInstallId === right.oldInstallId &&
    left.newInstallId === right.newInstallId &&
    left.proof === right.proof
  )
}

function pendingClaim(value: unknown, accountId: string): PortablePendingClaim | null {
  if (value === undefined || value === '') return null
  if (typeof value !== 'string') invalid('Invalid pending browser recovery claim')
  // Existing recovery lifecycle stores the three wire fields without a version.
  const fields = record(JSON.parse(value))
  const parsed = portablePendingClaimSchema.safeParse({ version: 1, accountId, ...fields })
  if (!parsed.success || parsed.data.accountId !== accountId)
    throw new PortableRecoveryError('CLAIM_CONFLICT', 'Invalid pending browser recovery claim')
  return parsed.data
}

async function logicalSnapshot(rows: Rows, context: Context): Promise<PortableRecoverySnapshot> {
  const metadata = rows.metadata
  if (
    !metadata ||
    metadata.get(ACCOUNT) !== context.accountId ||
    metadata.get(INSTALL) !== context.installId
  )
    throw new PortableRecoveryError(
      'ACCOUNT_MISMATCH',
      'Browser recovery binding does not match this account and install',
    )
  if (Number(metadata.get(DEVICE)) !== context.deviceId)
    invalid('Browser recovery device binding does not match')
  if (metadata.get('meta:meapp:e2e:recovery-proof') !== context.proof)
    invalid('Browser recovery proof does not match')
  if (pendingClaim(metadata.get(PENDING), context.accountId))
    throw new PortableRecoveryError(
      'CLAIM_CONFLICT',
      'Complete pending recovery before creating a backup',
    )
  const key = await aesKey(metadata.get('databaseKey'))
  const identities: unknown[] = []
  for (const [name, value] of rows.identity ?? []) {
    if (name !== 'keyPair:aci' && name !== 'keyPair:pni') invalid('Unknown browser identity record')
    const keyPair = record(JSON.parse(await decrypt(key, value)))
    const registrationId = metadata.get(`registrationId:${name.slice(8)}`)
    // The pinned SDK's manager writes the ID in the key pair without always
    // populating its separate metadata cache. Check that cache when it exists.
    if (registrationId !== undefined && registrationId !== keyPair.registrationId)
      invalid('Identity registration binding does not match')
    identities.push({ identityType: name.slice(8), keyPair })
  }
  const contacts: unknown[] = []
  for (const [name, value] of rows.contacts ?? []) {
    const row = record(value)
    if (typeof name !== 'string' || row.key !== name || typeof row.userId !== 'string')
      invalid('Invalid browser contact key')
    const identityType = name.endsWith(':aci') ? 'aci' : name.endsWith(':pni') ? 'pni' : null
    if (!identityType || name !== `${row.userId}:${identityType}`)
      invalid('Invalid browser contact binding')
    const trust = record(JSON.parse(await decrypt(key, row.data)))
    if (row.revision !== trust.revision) invalid('Contact revision does not match encrypted record')
    contacts.push({ userId: row.userId, identityType, record: trust })
  }
  const receivedContent: unknown[] = []
  const privateMetadata: unknown[] = []
  let privateKey: CryptoKey | null = null
  for (const [name, value] of metadata) {
    if (typeof name !== 'string') continue
    if (name.startsWith(RECEIVED)) {
      const content = record(JSON.parse(await decrypt(key, value)))
      if (content.id !== name.slice(RECEIVED.length) || Number(content.receivedAt) <= 0)
        invalid('Invalid received history binding')
      receivedContent.push(content)
    } else if (
      name.startsWith('meta:') &&
      portablePrivateMetadataKeySchema.safeParse(name.slice(5)).success
    ) {
      if (typeof value !== 'string') invalid('Invalid encrypted private metadata')
      const [version, nonce, ciphertext, extra] = value.split(':')
      if (version !== 'v1' || !nonce || !ciphertext || extra !== undefined)
        invalid('Private history must be encrypted')
      if (!privateKey) {
        const storedKey = metadata.get(PRIVATE_KEY)
        if (typeof storedKey !== 'string') invalid('Private history storage key is missing')
        privateKey = await aesKey(fromBase64(storedKey))
      }
      const iv = fromBase64(nonce)
      if (iv.length !== 12) invalid('Invalid private history nonce')
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: buffer(iv) },
        privateKey,
        buffer(fromBase64(ciphertext)),
      )
      privateMetadata.push({
        key: name.slice(5),
        value: new TextDecoder('utf-8', { fatal: true }).decode(plaintext),
      })
    }
  }
  return validatePortableSnapshot(
    {
      format: PORTABLE_RECOVERY_FORMAT,
      version: PORTABLE_RECOVERY_VERSION,
      sdkVersion: PORTABLE_RECOVERY_SDK,
      createdAt: context.createdAt,
      accountId: context.accountId,
      sourceInstallId: context.installId,
      sourceDeviceId: context.deviceId,
      proof: context.proof,
      identities,
      contacts,
      receivedContent,
      privateMetadata,
    },
    context.accountId,
  )
}

/** Converts an authenticated legacy snapshot in memory without touching any database. */
export async function convertLegacyBrowserSnapshot(
  value: unknown,
  accountId: string,
  createdAt: number,
): Promise<PortableRecoverySnapshot> {
  if (detectRecoveryFormat(value) !== 'legacy-web-v1')
    invalid('Expected a legacy browser recovery backup')
  // Validate complexity and input types before traversing the older recursive codec.
  stringifyPortableValue(value)
  const snapshot = value as Snapshot
  if (snapshot.accountId !== accountId)
    throw new PortableRecoveryError('ACCOUNT_MISMATCH', 'Legacy backup belongs to another account')
  if (
    Object.keys(snapshot.stores).length !== STORES.length ||
    STORES.some((name) => !Array.isArray(snapshot.stores[name]))
  )
    throw new PortableRecoveryError(
      'INCOMPATIBLE_FORMAT',
      'Legacy browser store set is incompatible',
    )
  const rows: Rows = {}
  for (const name of STORES) {
    const entries = new Map<string | number, unknown>()
    for (const candidate of snapshot.stores[name] ?? []) {
      const row = record(candidate)
      if (
        Object.keys(row).length !== 2 ||
        !Object.hasOwn(row, 'value') ||
        (typeof row.key !== 'string' &&
          (typeof row.key !== 'number' || !Number.isFinite(row.key))) ||
        entries.has(row.key as string | number)
      )
        invalid('Invalid or duplicate legacy browser row')
      const decoded = decode(candidate.value)
      if (
        [
          'contacts',
          'sessions',
          'sesameUsers',
          'senderKeyRecords',
          'skippedSenderKeys',
          'messageRecords',
        ].includes(name) &&
        record(decoded).key !== row.key
      )
        invalid('Legacy inline row key does not match')
      entries.set(row.key as string | number, decoded)
    }
    rows[name] = entries
  }
  return logicalSnapshot(rows, {
    accountId,
    installId: snapshot.installId,
    deviceId: Number(rows.metadata?.get(DEVICE)),
    proof: snapshot.proof,
    createdAt,
  })
}

/** An initialized, account-scoped SDK store is supplied by the recovery coordinator. */
export class BrowserRecoveryAdapter implements PortableRecoveryAdapter {
  constructor(
    private readonly accountId: string,
    private readonly storage: SignalProtocolLocalStore,
  ) {}

  private database(): IDBPDatabase {
    const db = Reflect.get(this.storage, 'db') as IDBPDatabase | null
    if (!db)
      throw new PortableRecoveryError(
        'STORAGE_UNAVAILABLE',
        'Browser encryption storage is unavailable',
      )
    const names = Array.from(db.objectStoreNames)
    if (
      db.version !== 6 ||
      names.length !== STORES.length ||
      STORES.some((name) => !names.includes(name))
    )
      throw new PortableRecoveryError(
        'INCOMPATIBLE_FORMAT',
        'Browser encryption storage version is incompatible',
      )
    return db
  }

  async exportSnapshot(context: Context): Promise<PortableRecoverySnapshot> {
    if (context.accountId !== this.accountId)
      throw new PortableRecoveryError(
        'ACCOUNT_MISMATCH',
        'Recovery adapter belongs to another account',
      )
    const db = this.database()
    const tx = db.transaction(['metadata', 'identity', 'contacts'], 'readonly')
    const rows: Rows = {}
    await Promise.all(
      ['metadata', 'identity', 'contacts'].map(async (name) => {
        const store = tx.objectStore(name)
        const [keys, values] = await Promise.all([store.getAllKeys(), store.getAll()])
        rows[name] = new Map(keys.map((key, index) => [key as string | number, values[index]]))
      }),
    )
    await tx.done
    // All WebCrypto work happens after the consistent read transaction completes.
    return logicalSnapshot(rows, context)
  }

  async importSnapshot(
    input: PortableRecoverySnapshot,
    pending: PortablePendingClaim,
  ): Promise<void> {
    const { snapshot, claim } = validatePortableImport(input, pending, this.accountId)
    const db = this.database()
    const material = bytes(await db.get('metadata', 'databaseKey'))
    const key = await aesKey(material)
    const privateMaterial = crypto.getRandomValues(new Uint8Array(32))
    const privateKey = await aesKey(privateMaterial)
    const identityRows = await Promise.all(
      snapshot.identities.map(async (row) => ({
        key: `keyPair:${row.identityType}`,
        value: await encrypt(key, JSON.stringify(row.keyPair)),
      })),
    )
    const contactRows = await Promise.all(
      snapshot.contacts.map(async (row) => ({
        key: `${row.userId}:${row.identityType}`,
        userId: row.userId,
        revision: row.record.revision,
        data: await encrypt(key, JSON.stringify(row.record)),
      })),
    )
    const historyRows = await Promise.all(
      snapshot.receivedContent.map(async (row) => ({
        key: `${RECEIVED}${row.id}`,
        value: await encrypt(key, JSON.stringify(row)),
      })),
    )
    const privateRows = await Promise.all(
      snapshot.privateMetadata.map(async (row) => {
        const encrypted = await encrypt(privateKey, row.value)
        return {
          key: `meta:${row.key}`,
          value: `v1:${base64(encrypted.subarray(0, 12))}:${base64(encrypted.subarray(12))}`,
        }
      }),
    )
    // Precompute encryption before opening IDB: no asynchronous crypto inside writes.
    const tx = db.transaction([...STORES], 'readwrite')
    try {
      const metadata = tx.objectStore('metadata')
      const [count, storedAccount, currentKey, currentPending] = await Promise.all([
        tx.objectStore('identity').count(),
        metadata.get(ACCOUNT),
        metadata.get('databaseKey'),
        metadata.get(PENDING),
      ])
      if (count)
        throw new PortableRecoveryError(
          'IDENTITY_CONFLICT',
          'This browser already has encryption keys',
        )
      if (storedAccount !== undefined && storedAccount !== this.accountId)
        throw new PortableRecoveryError(
          'ACCOUNT_MISMATCH',
          'Browser storage belongs to another account',
        )
      if (pendingClaim(currentPending, this.accountId))
        throw new PortableRecoveryError(
          'CLAIM_CONFLICT',
          'Another recovery is pending in this browser',
        )
      if (base64(bytes(currentKey)) !== base64(material))
        throw new PortableRecoveryError(
          'STORAGE_UNAVAILABLE',
          'Browser storage key changed during recovery',
        )
      for (const name of STORES) await tx.objectStore(name).clear()
      await metadata.put(material, 'databaseKey')
      for (const row of identityRows) await tx.objectStore('identity').put(row.value, row.key)
      for (const row of contactRows) await tx.objectStore('contacts').put(row)
      for (const row of snapshot.identities)
        await metadata.put(row.keyPair.registrationId, `registrationId:${row.identityType}`)
      for (const row of [...historyRows, ...privateRows]) await metadata.put(row.value, row.key)
      await metadata.put(base64(privateMaterial), PRIVATE_KEY)
      await metadata.put(this.accountId, ACCOUNT)
      await metadata.put(claim.newInstallId, INSTALL)
      await metadata.put(String(snapshot.sourceDeviceId), DEVICE)
      await metadata.put(snapshot.proof, 'meta:meapp:e2e:recovery-proof')
      await metadata.put(JSON.stringify(claim), PENDING)
      await tx.done
    } catch (error) {
      try {
        tx.abort()
      } catch {}
      await tx.done.catch(() => undefined)
      throw error
    }
  }

  async readPendingClaim(accountId: string): Promise<PortablePendingClaim | null> {
    if (accountId !== this.accountId)
      throw new PortableRecoveryError(
        'ACCOUNT_MISMATCH',
        'Recovery adapter belongs to another account',
      )
    return pendingClaim(await this.database().get('metadata', PENDING), accountId)
  }

  async completePendingClaim(claim: PortablePendingClaim): Promise<void> {
    const expected = portablePendingClaimSchema.parse(claim)
    if (expected.accountId !== this.accountId)
      throw new PortableRecoveryError(
        'ACCOUNT_MISMATCH',
        'Recovery adapter belongs to another account',
      )
    const tx = this.database().transaction('metadata', 'readwrite')
    try {
      const current = pendingClaim(await tx.store.get(PENDING), this.accountId)
      if (
        !current ||
        !sameClaim(current, expected) ||
        (await tx.store.get(INSTALL)) !== expected.newInstallId
      )
        throw new PortableRecoveryError(
          'CLAIM_CONFLICT',
          'Pending recovery claim changed; reopen recovery',
        )
      await tx.store.delete(PENDING)
      await tx.done
    } catch (error) {
      try {
        tx.abort()
      } catch {}
      await tx.done.catch(() => undefined)
      throw error
    }
  }
}
