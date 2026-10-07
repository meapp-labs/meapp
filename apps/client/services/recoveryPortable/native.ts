import {
  PORTABLE_RECOVERY_FORMAT,
  PORTABLE_RECOVERY_SDK,
  PORTABLE_RECOVERY_VERSION,
  portablePendingClaimSchema,
  portablePrivateMetadataKeySchema,
} from '@meapp/shared'
import {
  type PortablePendingClaim,
  type PortableRecoveryAdapter,
  PortableRecoveryError,
  type PortableRecoverySnapshot,
  validatePortableImport,
  validatePortableSnapshot,
} from './contract'

type Bind = string | number | null
export interface NativeRecoverySql {
  getFirstAsync<T>(sql: string, ...params: Bind[]): Promise<T | null>
  getAllAsync<T>(sql: string, ...params: Bind[]): Promise<T[]>
  runAsync(sql: string, ...params: Bind[]): Promise<unknown>
}
export interface NativeRecoveryDriver {
  /** Exclusive transaction; supplied connection only; rollback on any rejection. */
  transaction<T>(work: (sql: NativeRecoverySql) => Promise<T>): Promise<T>
}

const ACCOUNT = 'meapp:e2e:account'
const INSTALL = 'meapp:e2e:install'
const DEVICE = 'meapp:e2e:device-id'
const PROOF = 'meapp:e2e:recovery-proof'
const PENDING = 'meapp:e2e:restore-pending'
// Static pinned-SDK table names, never derived from backup contents.
const TABLES = [
  'kyber_prekey_used',
  'ec_one_time_prekeys',
  'ec_signed_prekeys',
  'kyber_one_time_prekeys',
  'kyber_prekeys',
  'sessions',
  'sender_keys',
  'skipped_sender_keys',
  'message_records',
  'group_master_keys',
  'group_state_cache',
  'profile_keys',
  'auth_credential_cache',
  'recipient_identities',
  'identity_keys',
  'metadata',
]

async function metadata(sql: NativeRecoverySql): Promise<Map<string, string>> {
  const rows = await sql.getAllAsync<{ key: string; value: string }>(
    'SELECT key, value FROM metadata',
  )
  return new Map(rows.map((row) => [row.key, row.value]))
}
async function put(sql: NativeRecoverySql, key: string, value: string): Promise<void> {
  await sql.runAsync(
    'INSERT OR REPLACE INTO metadata (key, value, updated_at) VALUES (?, ?, ?)',
    key,
    value,
    Date.now(),
  )
}
function pendingClaim(value: string | undefined, accountId: string): PortablePendingClaim | null {
  if (!value) return null
  const parsed = portablePendingClaimSchema.safeParse({
    version: 1,
    accountId,
    ...JSON.parse(value),
  })
  if (!parsed.success || parsed.data.accountId !== accountId)
    throw new PortableRecoveryError('CLAIM_CONFLICT', 'Invalid pending recovery claim')
  return parsed.data
}
async function checkVersion(sql: NativeRecoverySql): Promise<void> {
  const version = await sql.getFirstAsync<{ user_version: number }>('PRAGMA user_version')
  if (version?.user_version !== 1)
    throw new PortableRecoveryError(
      'INCOMPATIBLE_FORMAT',
      'Native encryption storage version is incompatible',
    )
}

/** SQLCipher protects every logical value at rest. Its key stays in the keychain. */
export class NativeRecoveryAdapter implements PortableRecoveryAdapter {
  constructor(
    private readonly accountId: string,
    private readonly driver: NativeRecoveryDriver,
  ) {}

  async exportSnapshot(
    context: Parameters<PortableRecoveryAdapter['exportSnapshot']>[0],
  ): Promise<PortableRecoverySnapshot> {
    if (context.accountId !== this.accountId)
      throw new PortableRecoveryError(
        'ACCOUNT_MISMATCH',
        'Recovery adapter belongs to another account',
      )
    return this.driver.transaction(async (sql) => {
      await checkVersion(sql)
      const values = await metadata(sql)
      if (values.get(ACCOUNT) !== context.accountId || values.get(INSTALL) !== context.installId)
        throw new PortableRecoveryError(
          'ACCOUNT_MISMATCH',
          'Native recovery binding does not match',
        )
      if (Number(values.get(DEVICE)) !== context.deviceId || values.get(PROOF) !== context.proof)
        throw new PortableRecoveryError(
          'INVALID_SNAPSHOT',
          'Native recovery device or proof does not match',
        )
      if (pendingClaim(values.get(PENDING), this.accountId))
        throw new PortableRecoveryError(
          'CLAIM_CONFLICT',
          'Complete pending recovery before creating a backup',
        )
      const identities = await sql.getAllAsync<{
        id: string
        identity_type: string
        registration_id: number
        dh_public_key: string
        dh_private_key: string
        signing_public_key: string
        signing_private_key: string
      }>('SELECT * FROM identity_keys')
      const contacts = await sql.getAllAsync<{
        recipient_id: string
        identity_type: string
        record_json: string
      }>('SELECT * FROM recipient_identities')
      return validatePortableSnapshot(
        {
          format: PORTABLE_RECOVERY_FORMAT,
          version: PORTABLE_RECOVERY_VERSION,
          sdkVersion: PORTABLE_RECOVERY_SDK,
          accountId: this.accountId,
          sourceInstallId: context.installId,
          sourceDeviceId: context.deviceId,
          proof: context.proof,
          createdAt: context.createdAt,
          identities: identities.map((row) => {
            if (row.id !== `primary_${row.identity_type}`)
              throw new PortableRecoveryError('INVALID_SNAPSHOT', 'Unknown native identity record')
            return {
              identityType: row.identity_type,
              keyPair: {
                dhKey: { publicKey: row.dh_public_key, privateKey: row.dh_private_key },
                signingKey: {
                  publicKey: row.signing_public_key,
                  privateKey: row.signing_private_key,
                },
                registrationId: row.registration_id,
              },
            }
          }),
          contacts: contacts.map((row) => {
            const suffix = `:${row.identity_type}`
            if (!row.recipient_id.endsWith(suffix))
              throw new PortableRecoveryError('INVALID_SNAPSHOT', 'Invalid native contact binding')
            return {
              userId: row.recipient_id.slice(0, -suffix.length),
              identityType: row.identity_type,
              record: JSON.parse(row.record_json),
            }
          }),
          receivedContent: Array.from(values)
            .filter(([key]) => key.startsWith('received-content:'))
            .map(([key, value]) => {
              const content = JSON.parse(value) as { id?: unknown }
              if (content.id !== key.slice('received-content:'.length))
                throw new PortableRecoveryError(
                  'INVALID_SNAPSHOT',
                  'Invalid native history binding',
                )
              return content
            }),
          privateMetadata: Array.from(values)
            .filter(([key]) => portablePrivateMetadataKeySchema.safeParse(key).success)
            .map(([key, value]) => ({ key, value })),
        },
        this.accountId,
      )
    })
  }

  async importSnapshot(
    input: PortableRecoverySnapshot,
    pending: PortablePendingClaim,
  ): Promise<void> {
    const { snapshot, claim } = validatePortableImport(input, pending, this.accountId)
    await this.driver.transaction(async (sql) => {
      await checkVersion(sql)
      const count = await sql.getFirstAsync<{ count: number }>(
        'SELECT count(*) AS count FROM identity_keys',
      )
      if (count?.count)
        throw new PortableRecoveryError(
          'IDENTITY_CONFLICT',
          'This device already has encryption keys',
        )
      const values = await metadata(sql)
      if (values.has(ACCOUNT) && values.get(ACCOUNT) !== this.accountId)
        throw new PortableRecoveryError(
          'ACCOUNT_MISMATCH',
          'Native storage belongs to another account',
        )
      if (pendingClaim(values.get(PENDING), this.accountId))
        throw new PortableRecoveryError(
          'CLAIM_CONFLICT',
          'Another recovery is pending on this device',
        )
      for (const table of TABLES) await sql.runAsync(`DELETE FROM ${table}`)
      for (const row of snapshot.identities) {
        const pair = row.keyPair
        await sql.runAsync(
          `INSERT INTO identity_keys
          (id, identity_type, public_key, registration_id, dh_public_key, dh_private_key,
           signing_public_key, signing_private_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          `primary_${row.identityType}`,
          row.identityType,
          pair.dhKey.publicKey,
          pair.registrationId,
          pair.dhKey.publicKey,
          pair.dhKey.privateKey,
          pair.signingKey.publicKey,
          pair.signingKey.privateKey,
          Date.now(),
          Date.now(),
        )
      }
      for (const row of snapshot.contacts)
        await sql.runAsync(
          'INSERT INTO recipient_identities (recipient_id, identity_type, record_json, updated_at) VALUES (?, ?, ?, ?)',
          `${row.userId}:${row.identityType}`,
          row.identityType,
          JSON.stringify(row.record),
          Date.now(),
        )
      for (const row of snapshot.receivedContent)
        await put(sql, `received-content:${row.id}`, JSON.stringify(row))
      for (const row of snapshot.privateMetadata) await put(sql, row.key, row.value)
      await put(sql, ACCOUNT, this.accountId)
      await put(sql, INSTALL, claim.newInstallId)
      await put(sql, DEVICE, String(snapshot.sourceDeviceId))
      await put(sql, PROOF, snapshot.proof)
      await put(sql, PENDING, JSON.stringify(claim))
    })
  }

  async readPendingClaim(accountId: string): Promise<PortablePendingClaim | null> {
    if (accountId !== this.accountId)
      throw new PortableRecoveryError(
        'ACCOUNT_MISMATCH',
        'Recovery adapter belongs to another account',
      )
    return this.driver.transaction(async (sql) =>
      pendingClaim((await metadata(sql)).get(PENDING), accountId),
    )
  }

  async completePendingClaim(input: PortablePendingClaim): Promise<void> {
    const claim = portablePendingClaimSchema.parse(input)
    if (claim.accountId !== this.accountId)
      throw new PortableRecoveryError(
        'ACCOUNT_MISMATCH',
        'Recovery adapter belongs to another account',
      )
    await this.driver.transaction(async (sql) => {
      const values = await metadata(sql)
      const current = pendingClaim(values.get(PENDING), this.accountId)
      if (
        !current ||
        current.oldInstallId !== claim.oldInstallId ||
        current.newInstallId !== claim.newInstallId ||
        current.proof !== claim.proof ||
        values.get(INSTALL) !== claim.newInstallId
      )
        throw new PortableRecoveryError(
          'CLAIM_CONFLICT',
          'Pending recovery claim changed; reopen recovery',
        )
      await sql.runAsync('DELETE FROM metadata WHERE key = ?', PENDING)
    })
  }
}
