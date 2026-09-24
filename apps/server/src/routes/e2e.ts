import { and, eq, getDbInstance, schema } from '@meapp/db'
import {
  type BundleResponse,
  type DeviceInfo,
  bundleUploadSchema,
  deviceRegistrationSchema,
} from '@meapp/shared'
import { Elysia, t } from 'elysia'

import { E2E_CONFIG, isE2EEnabled } from '../lib/config.ts'
import { ErrorCode, createNotFoundError, createValidationError } from '../lib/errors.ts'
import { requireUser } from '../lib/session.ts'
import { authPlugin } from '../plugins/auth.ts'

const bundleQuery = t.Object({
  userId: t.Optional(t.String({ format: 'uuid' })),
  deviceId: t.Optional(t.String({ format: 'uuid' })),
})

export const e2eRoutes = new Elysia({ prefix: '/api/e2e' })
  .use(authPlugin)
  .onBeforeHandle(({ set }) => {
    // Whole E2E surface is feature-flagged; 404 keeps it invisible when off.
    if (!isE2EEnabled()) {
      set.status = 404
      return { message: 'Not found', code: ErrorCode.ITEM_NOT_FOUND }
    }
    return undefined
  })

  // ── Device registry (V10.0: one device per user) ─────────────────────
  .post(
    '/device',
    async ({ body, user }) => {
      const me = requireUser(user)
      const { deviceId, platform, identityKeyPublic } = body

      const db = getDbInstance()
      const existing = await db.db
        .select()
        .from(schema.devices)
        .where(and(eq(schema.devices.userId, me.id), eq(schema.devices.deviceId, deviceId)))
        .get()

      if (existing) {
        // Idempotent re-registration (app restart, key rotation)
        await db.db
          .update(schema.devices)
          .set({ platform, lastActiveAt: new Date() })
          .where(and(eq(schema.devices.userId, me.id), eq(schema.devices.deviceId, deviceId)))
      } else {
        const others = await db.db
          .select({ deviceId: schema.devices.deviceId })
          .from(schema.devices)
          .where(eq(schema.devices.userId, me.id))
          .all()

        // V10.0 scope: 1 device per user. Registering a second device
        // replaces the previous one (bundles of the old device stay until
        // expiry; peers re-fetch bundles on send failure).
        if (others.length > 0 && !others.some((d) => d.deviceId === deviceId)) {
          await db.db.delete(schema.devices).where(eq(schema.devices.userId, me.id))
          await db.db.delete(schema.identityKeys).where(eq(schema.identityKeys.userId, me.id))
          await db.db.delete(schema.prekeyBundles).where(eq(schema.prekeyBundles.userId, me.id))
        }

        await db.db.insert(schema.devices).values({ userId: me.id, deviceId, platform })
      }

      await db.db
        .insert(schema.identityKeys)
        .values({ userId: me.id, deviceId, identityKeyPublic, lastSeenAt: new Date() })
        .onConflictDoUpdate({
          target: [schema.identityKeys.userId, schema.identityKeys.deviceId],
          set: { identityKeyPublic, lastSeenAt: new Date() },
        })

      return { deviceId, registered: true }
    },
    { body: deviceRegistrationSchema },
  )

  // ── Bundle upload (auth, deviceId bound, transactional insert) ───────
  .post(
    '/bundle',
    async ({ body, user, set }) => {
      const me = requireUser(user)
      const { deviceId, identityKeyPublic, prekeys } = body

      if (prekeys.length > E2E_CONFIG.MAX_PREKEYS_PER_UPLOAD) {
        throw createValidationError(`Max ${E2E_CONFIG.MAX_PREKEYS_PER_UPLOAD} prekeys per upload`)
      }

      const db = getDbInstance()

      // Device must be registered first and identity key must match.
      const device = await db.db
        .select()
        .from(schema.devices)
        .where(and(eq(schema.devices.userId, me.id), eq(schema.devices.deviceId, deviceId)))
        .get()
      if (!device) {
        throw createValidationError('Register device via POST /api/e2e/device first')
      }

      const identity = await db.db
        .select()
        .from(schema.identityKeys)
        .where(
          and(eq(schema.identityKeys.userId, me.id), eq(schema.identityKeys.deviceId, deviceId)),
        )
        .get()
      if (identity && identity.identityKeyPublic !== identityKeyPublic) {
        throw createValidationError('identityKeyPublic does not match registered identity key')
      }

      const now = Date.now()
      for (const pk of prekeys) {
        const expires = new Date(pk.signedPrekeyExpiresAt).getTime()
        if (expires <= now || expires > now + E2E_CONFIG.SIGNED_PREKEY_MAX_TTL_MS) {
          throw createValidationError('signedPrekeyExpiresAt must be in the future, max 30 days')
        }
        if (pk.isLastResort && prekeys.filter((p) => p.isLastResort).length > 1) {
          throw createValidationError('At most one last-resort prekey per upload')
        }
      }

      // Transactional insert; conflicts on (user, device, prekeyId) ignored —
      // clients may retry uploads after network errors.
      const insert = db.sqlite.query(
        `INSERT OR IGNORE INTO prekey_bundles
         (id, user_id, device_id, prekey_id, prekey_public, signed_prekey_id, signed_prekey_public,
          signed_prekey_signature, signed_prekey_expires_at, kyber_prekey_id, kyber_prekey_public,
          kyber_prekey_signature, is_last_resort, used, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      )

      db.sqlite.transaction(() => {
        for (const pk of prekeys) {
          insert.run(
            Bun.randomUUIDv7(),
            me.id,
            deviceId,
            pk.prekeyId,
            pk.prekeyPublic,
            pk.signedPrekeyId,
            pk.signedPrekeyPublic,
            pk.signedPrekeySignature,
            new Date(pk.signedPrekeyExpiresAt).getTime(),
            pk.kyberPrekeyId,
            pk.kyberPrekeyPublic,
            pk.kyberPrekeySignature,
            pk.isLastResort ? 1 : 0,
            now,
          )
        }
      })()

      set.status = 201
      return { uploaded: prekeys.length, deviceId }
    },
    { body: bundleUploadSchema },
  )

  // ── Bundle claim (ATOMIC via BEGIN IMMEDIATE, last-resort fallback) ──
  .get(
    '/bundle',
    ({ query, user }): BundleResponse | BundleResponse[] => {
      const me = requireUser(user)
      const sqlite = getDbInstance().sqlite
      const targetUserId = query.userId ?? me.id

      const claimOne = (deviceId: string): BundleResponse | null => {
        type ClaimRow = {
          id: string
          prekey_id: number
          prekey_public: string
          signed_prekey_id: number
          signed_prekey_public: string
          signed_prekey_signature: string
          kyber_prekey_id: number
          kyber_prekey_public: string
          kyber_prekey_signature: string
          is_last_resort: number
        }
        const identity = sqlite
          .query(
            'SELECT identity_key_public FROM identity_keys WHERE user_id = ? AND device_id = ?',
          )
          .get(targetUserId, deviceId) as { identity_key_public: string } | undefined
        if (!identity) return null

        sqlite.exec('BEGIN IMMEDIATE')
        try {
          let row = sqlite
            .query(
              `SELECT id, prekey_id, prekey_public, signed_prekey_id, signed_prekey_public,
                      signed_prekey_signature, kyber_prekey_id, kyber_prekey_public,
                      kyber_prekey_signature, is_last_resort
               FROM prekey_bundles
               WHERE user_id = ? AND device_id = ? AND used = 0 AND is_last_resort = 0
                 AND signed_prekey_expires_at > ?
               ORDER BY created_at LIMIT 1`,
            )
            .get(targetUserId, deviceId, Date.now()) as ClaimRow | undefined

          if (row) {
            sqlite.query('UPDATE prekey_bundles SET used = 1 WHERE id = ?').run(row.id)
          } else {
            // Last-resort fallback: reusable, never marked used.
            row = sqlite
              .query(
                `SELECT id, prekey_id, prekey_public, signed_prekey_id, signed_prekey_public,
                        signed_prekey_signature, kyber_prekey_id, kyber_prekey_public,
                        kyber_prekey_signature, is_last_resort
                 FROM prekey_bundles
                 WHERE user_id = ? AND device_id = ? AND is_last_resort = 1
                 ORDER BY created_at LIMIT 1`,
              )
              .get(targetUserId, deviceId) as ClaimRow | undefined
          }
          sqlite.exec('COMMIT')

          if (!row) {
            return {
              userId: targetUserId,
              deviceId,
              identityKeyPublic: identity.identity_key_public,
              prekeyBundle: null,
            }
          }

          return {
            userId: targetUserId,
            deviceId,
            identityKeyPublic: identity.identity_key_public,
            prekeyBundle: {
              prekeyId: row.prekey_id,
              prekeyPublic: row.prekey_public,
              signedPrekeyId: row.signed_prekey_id,
              signedPrekeyPublic: row.signed_prekey_public,
              signedPrekeySignature: row.signed_prekey_signature,
              kyberPrekeyId: row.kyber_prekey_id,
              kyberPrekeyPublic: row.kyber_prekey_public,
              kyberPrekeySignature: row.kyber_prekey_signature,
              isLastResort: row.is_last_resort === 1,
            },
          }
        } catch (err) {
          try {
            sqlite.exec('ROLLBACK')
          } catch {}
          throw err
        }
      }

      if (query.deviceId) {
        const bundle = claimOne(query.deviceId)
        if (!bundle) {
          throw createNotFoundError('Device')
        }
        return bundle
      }

      // All devices of the target user (multi-device future; 1 device in V10.0)
      const deviceRows = sqlite
        .query('SELECT device_id FROM devices WHERE user_id = ?')
        .all(targetUserId) as Array<{ device_id: string }>

      if (deviceRows.length === 0) {
        throw createNotFoundError('Devices for user')
      }

      return deviceRows
        .map((d) => claimOne(d.device_id))
        .filter((b): b is BundleResponse => b !== null)
    },
    { query: bundleQuery },
  )

  // ── Device list (safety number UI, prekey refill signal) ─────────────
  .get(
    '/devices',
    ({ query, user }): DeviceInfo[] => {
      requireUser(user)
      const sqlite = getDbInstance().sqlite
      const targetUserId = query.userId
      if (!targetUserId) {
        throw createValidationError('userId query parameter is required')
      }

      const rows = sqlite
        .query(
          `SELECT d.user_id, d.device_id, d.platform, d.last_active_at, i.identity_key_public
           FROM devices d
           LEFT JOIN identity_keys i ON i.user_id = d.user_id AND i.device_id = d.device_id
           WHERE d.user_id = ?`,
        )
        .all(targetUserId) as Array<{
        user_id: string
        device_id: string
        platform: string | null
        last_active_at: number | null
        identity_key_public: string | null
      }>

      return rows.map((r) => ({
        userId: r.user_id,
        deviceId: r.device_id,
        identityKeyPublic: r.identity_key_public ?? '',
        platform: (r.platform as DeviceInfo['platform']) ?? null,
        lastSeenAt: r.last_active_at ? new Date(r.last_active_at).toISOString() : null,
      }))
    },
    {
      query: t.Object({ userId: t.String({ format: 'uuid' }) }),
    },
  )
