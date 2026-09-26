import { getDbInstance } from '@meapp/db'
import { Elysia, t } from 'elysia'

import { canAccessRoom } from '../lib/authz.ts'
import { isE2EEnabled } from '../lib/config.ts'
import {
  createAuthError,
  createDuplicateItemError,
  createNotFoundError,
  createValidationError,
} from '../lib/errors.ts'
import { requireUser } from '../lib/session.ts'
import { authPlugin } from '../plugins/auth.ts'

const keyType = t.Union([
  t.Literal('ecPreKey'),
  t.Literal('ecSignedPreKey'),
  t.Literal('kemOneTimePreKey'),
  t.Literal('kemLastResortPreKey'),
])
type KeyType = 'ecPreKey' | 'ecSignedPreKey' | 'kemOneTimePreKey' | 'kemLastResortPreKey'
type PrekeyRow = {
  key_id: number
  public_key: string
  signature: string | null
  created_at: number
}
type IdentityRow = {
  device_id: number
  install_id: string
  registration_id: number
  x25519_public_key: string
  ed25519_public_key: string
}

const keyMetadata = (row?: PrekeyRow | null) =>
  row
    ? {
        keyId: row.key_id,
        publicKey: row.public_key,
        createdAt: row.created_at,
        expiresAt: row.created_at + 30 * 24 * 60 * 60 * 1000,
      }
    : null

const getCurrentKey = (userId: string, deviceId: number, type: KeyType): PrekeyRow | null =>
  (getDbInstance()
    .sqlite.query(
      `SELECT key_id, public_key, signature, created_at FROM relay_prekeys
       WHERE user_id = ? AND device_id = ? AND type = ? AND consumed = 0
       ORDER BY key_id DESC LIMIT 1`,
    )
    .get(userId, deviceId, type) as PrekeyRow | null) ?? null

const getInventory = (userId: string, deviceId: number) => {
  const sqlite = getDbInstance().sqlite
  const counts = sqlite
    .query(
      `SELECT type, COUNT(*) AS total FROM relay_prekeys
       WHERE user_id = ? AND device_id = ? AND consumed = 0 AND type IN ('ecPreKey', 'kemOneTimePreKey')
       GROUP BY type`,
    )
    .all(userId, deviceId) as Array<{ type: KeyType; total: number }>
  return {
    ecSignedPreKey: keyMetadata(getCurrentKey(userId, deviceId, 'ecSignedPreKey')),
    kemLastResortPreKey: keyMetadata(getCurrentKey(userId, deviceId, 'kemLastResortPreKey')),
    ecOneTimePreKeyCount: counts.find((row) => row.type === 'ecPreKey')?.total ?? 0,
    kemOneTimePreKeyCount: counts.find((row) => row.type === 'kemOneTimePreKey')?.total ?? 0,
  }
}

const requireRegistered = (userId: string, installId: string) => {
  const device = getDbInstance()
    .sqlite.query(
      'SELECT protocol_device_id AS id FROM devices WHERE user_id = ? AND device_id = ?',
    )
    .get(userId, installId) as { id: number } | null
  if (!device) throw createAuthError('Register this device first')
  return device.id
}

/** Public-key relay only. Device private keys and plaintext never reach these routes. */
export const e2eRelayRoutes = new Elysia({ prefix: '/api/e2e/relay' })
  .use(authPlugin)
  .onBeforeHandle(({ set }) => {
    if (!isE2EEnabled()) {
      set.status = 404
      return { message: 'Not found', code: 'ITEM_NOT_FOUND' }
    }
    return undefined
  })
  .post(
    '/register',
    ({ body, user }) => {
      const me = requireUser(user)
      const sqlite = getDbInstance().sqlite
      const installed = sqlite
        .query('SELECT protocol_device_id FROM devices WHERE user_id = ? AND device_id = ?')
        .get(me.id, body.installId) as { protocol_device_id: number } | null
      const anyDevice = sqlite
        .query('SELECT 1 AS valid FROM devices WHERE user_id = ? LIMIT 1')
        .get(me.id)
      if (anyDevice && !installed) {
        throw createDuplicateItemError('Approve this browser from an already linked device')
      }
      sqlite
        .query(
          `INSERT OR IGNORE INTO devices (user_id, device_id, platform, last_active_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(me.id, body.installId, body.platform, Math.floor(Date.now() / 1000))
      return { deviceId: installed?.protocol_device_id ?? 1 }
    },
    {
      body: t.Object({
        installId: t.String({ format: 'uuid' }),
        platform: t.Union([t.Literal('android'), t.Literal('web')]),
      }),
    },
  )
  .post(
    '/identity',
    ({ body, user }) => {
      const me = requireUser(user)
      const deviceId = requireRegistered(me.id, body.installId)
      const sqlite = getDbInstance().sqlite
      const existing = sqlite
        .query(
          `SELECT install_id, registration_id, x25519_public_key, ed25519_public_key
           FROM relay_identities WHERE user_id = ? AND device_id = ?`,
        )
        .get(me.id, deviceId) as IdentityRow | null
      if (deviceId > 1) {
        const primary = sqlite
          .query(`SELECT registration_id, x25519_public_key, ed25519_public_key
            FROM relay_identities WHERE user_id = ? AND device_id = 1`)
          .get(me.id) as IdentityRow | null
        if (
          !primary ||
          primary.registration_id !== body.registrationId ||
          primary.x25519_public_key !== body.identity.x25519PublicKey ||
          primary.ed25519_public_key !== body.identity.ed25519PublicKey
        )
          throw createValidationError('Linked device identity must match the approving account')
      }
      if (existing) {
        if (
          existing.install_id !== body.installId ||
          existing.registration_id !== body.registrationId ||
          existing.x25519_public_key !== body.identity.x25519PublicKey ||
          existing.ed25519_public_key !== body.identity.ed25519PublicKey
        ) {
          throw createDuplicateItemError('Device identity changed; account recovery is required')
        }
      } else {
        sqlite
          .query(
            `INSERT INTO relay_identities
             (user_id, device_id, install_id, registration_id, x25519_public_key, ed25519_public_key, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            me.id,
            deviceId,
            body.installId,
            body.registrationId,
            body.identity.x25519PublicKey,
            body.identity.ed25519PublicKey,
            Date.now(),
          )
      }
      return { registered: true }
    },
    {
      body: t.Object({
        installId: t.String({ format: 'uuid' }),
        registrationId: t.Integer({ minimum: 1, maximum: 65535 }),
        identity: t.Object({
          version: t.Literal(1),
          x25519PublicKey: t.String({ minLength: 1, maxLength: 128 }),
          ed25519PublicKey: t.String({ minLength: 1, maxLength: 128 }),
        }),
      }),
    },
  )
  .get(
    '/identity',
    ({ query, user }) => {
      requireUser(user)
      const row = getDbInstance()
        .sqlite.query(
          'SELECT x25519_public_key, ed25519_public_key FROM relay_identities WHERE user_id = ? ORDER BY device_id LIMIT 1',
        )
        .get(query.userId) as Pick<IdentityRow, 'x25519_public_key' | 'ed25519_public_key'> | null
      return row
        ? {
            version: 1,
            x25519PublicKey: row.x25519_public_key,
            ed25519PublicKey: row.ed25519_public_key,
          }
        : null
    },
    { query: t.Object({ userId: t.String({ format: 'uuid' }) }) },
  )
  .get(
    '/inventory',
    ({ query, user }) => {
      const me = requireUser(user)
      const deviceId = requireRegistered(me.id, query.installId)
      return getInventory(me.id, deviceId)
    },
    { query: t.Object({ installId: t.String({ format: 'uuid' }) }) },
  )
  .post(
    '/prekeys',
    ({ body, user }) => {
      const me = requireUser(user)
      const deviceId = requireRegistered(me.id, body.installId)
      const identity = getDbInstance()
        .sqlite.query('SELECT 1 AS valid FROM relay_identities WHERE user_id = ? AND device_id = ?')
        .get(me.id, deviceId)
      if (!identity) throw createValidationError('Publish the device identity first')
      const sqlite = getDbInstance().sqlite
      sqlite.transaction(() => {
        for (const key of body.keys) {
          const existing = sqlite
            .query(
              `SELECT public_key, signature FROM relay_prekeys
               WHERE user_id = ? AND device_id = ? AND type = ? AND key_id = ?`,
            )
            .get(me.id, deviceId, key.type, key.keyId) as {
            public_key: string
            signature: string | null
          } | null
          if (existing) {
            if (
              existing.public_key !== key.publicKey ||
              existing.signature !== (key.signature ?? null)
            ) {
              throw createDuplicateItemError('Prekey ID was reused with different key material')
            }
            continue
          }
          sqlite
            .query(
              `INSERT INTO relay_prekeys
               (user_id, device_id, type, key_id, public_key, signature, consumed, created_at)
               VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
            )
            .run(
              me.id,
              deviceId,
              key.type,
              key.keyId,
              key.publicKey,
              key.signature ?? null,
              Date.now(),
            )
        }
      })()
      return { uploaded: body.keys.length }
    },
    {
      body: t.Object({
        installId: t.String({ format: 'uuid' }),
        keys: t.Array(
          t.Object({
            type: keyType,
            keyId: t.Integer({ minimum: 0, maximum: 0xffffff }),
            publicKey: t.String({ minLength: 1, maxLength: 4096 }),
            signature: t.Optional(t.String({ minLength: 1, maxLength: 256 })),
          }),
          { minItems: 1, maxItems: 205 },
        ),
      }),
    },
  )
  .get(
    '/devices',
    ({ query, user }) => {
      requireUser(user)
      const rows = getDbInstance()
        .sqlite.query('SELECT device_id, created_at FROM relay_identities WHERE user_id = ?')
        .all(query.userId) as Array<{ device_id: number; created_at: number }>
      return rows.map((row) => ({
        deviceId: row.device_id,
        registered: true,
        linked: row.device_id > 1,
        enabled: true,
        createdAt: row.created_at,
      }))
    },
    { query: t.Object({ userId: t.String({ format: 'uuid' }) }) },
  )
  .post(
    '/bundle',
    ({ body, user }) => {
      const me = requireUser(user)
      const sqlite = getDbInstance().sqlite
      const sharedRoom = sqlite
        .query(
          `SELECT 1 AS allowed FROM room_members mine
         JOIN room_members theirs ON theirs.room_id = mine.room_id
         WHERE mine.user_id = ? AND theirs.user_id = ? LIMIT 1`,
        )
        .get(me.id, body.userId)
      if (me.id !== body.userId && !sharedRoom)
        throw createAuthError('No conversation with this recipient')
      sqlite.exec('BEGIN IMMEDIATE')
      try {
        const identity = sqlite
          .query(
            `SELECT registration_id, x25519_public_key, ed25519_public_key
             FROM relay_identities WHERE user_id = ? AND device_id = ?`,
          )
          .get(body.userId, body.deviceId) as Omit<IdentityRow, 'install_id'> | null
        const signed = getCurrentKey(body.userId, body.deviceId, 'ecSignedPreKey')
        const lastResort = getCurrentKey(body.userId, body.deviceId, 'kemLastResortPreKey')
        if (!identity || !signed || !lastResort) {
          sqlite.exec('COMMIT')
          return null
        }
        const oneTime = getCurrentKey(body.userId, body.deviceId, 'ecPreKey')
        const kemOneTime = getCurrentKey(body.userId, body.deviceId, 'kemOneTimePreKey')
        for (const [type, key] of [
          ['ecPreKey', oneTime],
          ['kemOneTimePreKey', kemOneTime],
        ] as const) {
          if (key) {
            sqlite
              .query(
                'UPDATE relay_prekeys SET consumed = 1 WHERE user_id = ? AND device_id = ? AND type = ? AND key_id = ?',
              )
              .run(body.userId, body.deviceId, type, key.key_id)
          }
        }
        sqlite.exec('COMMIT')
        return {
          registrationId: identity.registration_id,
          deviceId: body.deviceId,
          identity: {
            version: 1,
            x25519PublicKey: identity.x25519_public_key,
            ed25519PublicKey: identity.ed25519_public_key,
          },
          ecSignedPreKey: {
            keyId: signed.key_id,
            publicKey: signed.public_key,
            signature: signed.signature,
          },
          ecOneTimePreKey: oneTime
            ? { keyId: oneTime.key_id, publicKey: oneTime.public_key }
            : null,
          kemLastResortPreKey: {
            keyId: lastResort.key_id,
            publicKey: lastResort.public_key,
            signature: lastResort.signature,
          },
          kemOneTimePreKey: kemOneTime
            ? {
                keyId: kemOneTime.key_id,
                publicKey: kemOneTime.public_key,
                signature: kemOneTime.signature,
              }
            : null,
        }
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
    {
      body: t.Object({
        userId: t.String({ format: 'uuid' }),
        deviceId: t.Integer({ minimum: 1, maximum: 5 }),
      }),
    },
  )
  .post(
    '/clear-stale-kem',
    ({ body, user }) => {
      const me = requireUser(user)
      const deviceId = requireRegistered(me.id, body.installId)
      const result = getDbInstance()
        .sqlite.query(
          `UPDATE relay_prekeys SET consumed = 1
         WHERE user_id = ? AND device_id = ? AND type = 'kemOneTimePreKey' AND consumed = 0`,
        )
        .run(me.id, deviceId)
      return { cleared: result.changes }
    },
    { body: t.Object({ installId: t.String({ format: 'uuid' }) }) },
  )
  .get(
    '/recipients',
    async ({ query, user }) => {
      const me = requireUser(user)
      if (!(await canAccessRoom(me.id, query.conversationId))) {
        throw createAuthError('You are not a participant in this conversation')
      }
      const rows = getDbInstance()
        .sqlite.query(
          `SELECT rm.user_id AS userId, u.username AS username, ri.device_id AS deviceId
         FROM room_members rm JOIN users u ON u.id = rm.user_id
         LEFT JOIN relay_identities ri ON ri.user_id = rm.user_id
         WHERE rm.room_id = ?`,
        )
        .all(query.conversationId) as Array<{
        userId: string
        username: string
        deviceId: number | null
      }>
      if (rows.length === 0) throw createNotFoundError('Recipients')
      if (rows.some((row) => !row.deviceId))
        throw createValidationError('A recipient has not enabled encryption')
      const myDeviceId = requireRegistered(me.id, query.installId)
      return rows
        .filter((row) => row.userId !== me.id || row.deviceId !== myDeviceId)
        .map(({ userId, username, deviceId }) => ({ userId, username, deviceId: Number(deviceId) }))
    },
    {
      query: t.Object({
        conversationId: t.String({ format: 'uuid' }),
        installId: t.String({ format: 'uuid' }),
      }),
    },
  )
