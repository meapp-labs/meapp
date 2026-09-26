import { getDbInstance } from '@meapp/db'
import { Elysia, t } from 'elysia'

import { isE2EEnabled } from '../lib/config.ts'
import {
  createAuthError,
  createDuplicateItemError,
  createNotFoundError,
  createValidationError,
} from '../lib/errors.ts'
import { requireUser } from '../lib/session.ts'
import { authPlugin } from '../plugins/auth.ts'
import { broadcastToRoom } from '../ws/chat.ts'

const SESSION_TTL_MS = 5 * 60_000
type LinkStatus = 'waiting' | 'connected' | 'ready' | 'linked_pending_ack' | 'completed'
type LinkSession = {
  id: string
  userId: string
  ownerInstallId: string
  ownerPublicKey: string
  newInstallId?: string
  newPublicKey?: string
  platform?: 'web' | 'android'
  encryptedMessage?: string | undefined
  deviceId: number
  status: LinkStatus
  expiresAt: number
}

const sessions = new Map<string, LinkSession>()

function removePendingDevice(session: LinkSession): void {
  if (session.status !== 'linked_pending_ack' || !session.newInstallId) return
  const sqlite = getDbInstance().sqlite
  const newInstallId = session.newInstallId
  sqlite.transaction(() => {
    sqlite
      .query('DELETE FROM relay_prekeys WHERE user_id = ? AND device_id = ?')
      .run(session.userId, session.deviceId)
    sqlite
      .query('DELETE FROM relay_identities WHERE user_id = ? AND device_id = ?')
      .run(session.userId, session.deviceId)
    sqlite
      .query('DELETE FROM devices WHERE user_id = ? AND device_id = ?')
      .run(session.userId, newInstallId)
  })()
}

function isPublicKey(value: string): boolean {
  const decoded = Buffer.from(value, 'base64')
  return decoded.length === 32 && decoded.toString('base64') === value
}

function cleanupExpired(): void {
  const now = Date.now()
  for (const [id, session] of sessions) {
    if (session.expiresAt > now) continue
    removePendingDevice(session)
    sessions.delete(id)
  }
}

function getSession(sessionId: string, userId: string): LinkSession {
  cleanupExpired()
  const session = sessions.get(sessionId)
  if (!session || session.userId !== userId) throw createNotFoundError('Device link')
  return session
}

function requireOwner(session: LinkSession, installId: string): void {
  if (session.ownerInstallId !== installId) throw createAuthError('Not the approving device')
}

function requireNew(session: LinkSession, installId: string): void {
  if (session.newInstallId !== installId) throw createAuthError('Not the new device')
}

const idField = t.String({ format: 'uuid' })
const publicKeyField = t.String({ minLength: 40, maxLength: 48 })

/** Five-minute, authenticated relay for SDK-encrypted device provisioning. */
export const deviceLinkRoutes = new Elysia({ prefix: '/api/e2e/link' })
  .use(authPlugin)
  .onBeforeHandle(({ set }) => {
    if (!isE2EEnabled()) {
      set.status = 404
      return { message: 'Not found', code: 'ITEM_NOT_FOUND' }
    }
    return undefined
  })
  .get(
    '/devices',
    ({ query, user }) => {
      const me = requireUser(user)
      const sqlite = getDbInstance().sqlite
      const current = sqlite
        .query('SELECT protocol_device_id FROM devices WHERE user_id = ? AND device_id = ?')
        .get(me.id, query.installId) as { protocol_device_id: number } | null
      if (!current) throw createAuthError('This device is not linked')
      const devices = sqlite
        .query(`SELECT d.protocol_device_id AS deviceId, d.platform,
        d.last_active_at AS lastActiveAt, d.history_complete AS historyComplete,
        ri.created_at AS createdAt
        FROM devices d JOIN relay_identities ri ON ri.user_id = d.user_id AND ri.device_id = d.protocol_device_id
        WHERE d.user_id = ? ORDER BY d.protocol_device_id`)
        .all(me.id) as Array<{
        deviceId: number
        platform: string
        lastActiveAt: number | null
        createdAt: number
        historyComplete: number
      }>
      return {
        currentDeviceId: current.protocol_device_id,
        devices: devices.map((device) => ({
          ...device,
          historyComplete: Boolean(device.historyComplete),
        })),
      }
    },
    { query: t.Object({ installId: idField }) },
  )
  .post(
    '/revoke',
    ({ body, user }) => {
      const me = requireUser(user)
      const sqlite = getDbInstance().sqlite
      const current = sqlite
        .query('SELECT protocol_device_id FROM devices WHERE user_id = ? AND device_id = ?')
        .get(me.id, body.installId) as { protocol_device_id: number } | null
      if (!current) throw createAuthError('This device is not linked')
      if (current.protocol_device_id === body.deviceId)
        throw createValidationError('A device cannot revoke itself')
      sqlite.transaction(() => {
        sqlite
          .query('DELETE FROM message_envelopes WHERE target_user_id = ? AND target_device_id = ?')
          .run(me.id, body.deviceId)
        sqlite
          .query('DELETE FROM relay_prekeys WHERE user_id = ? AND device_id = ?')
          .run(me.id, body.deviceId)
        sqlite
          .query('DELETE FROM relay_identities WHERE user_id = ? AND device_id = ?')
          .run(me.id, body.deviceId)
        sqlite
          .query('DELETE FROM devices WHERE user_id = ? AND protocol_device_id = ?')
          .run(me.id, body.deviceId)
      })()
      for (const session of sessions.values()) {
        if (session.userId === me.id && session.deviceId === body.deviceId)
          sessions.delete(session.id)
      }
      return { revoked: true }
    },
    { body: t.Object({ installId: idField, deviceId: t.Integer({ minimum: 1, maximum: 5 }) }) },
  )
  .post(
    '/start',
    ({ body, user }) => {
      const me = requireUser(user)
      cleanupExpired()
      const sqlite = getDbInstance().sqlite
      // A restart can discard a pending in-memory handshake. Reclaim linked
      // slots that never published an identity after their acknowledgment TTL.
      sqlite
        .query(`DELETE FROM devices WHERE user_id = ? AND protocol_device_id > 1
        AND last_active_at < ? AND NOT EXISTS (
          SELECT 1 FROM relay_identities ri
          WHERE ri.user_id = devices.user_id AND ri.device_id = devices.protocol_device_id
        )`)
        .run(me.id, Math.floor(Date.now() / 1000) - 10 * 60)
      const owner = sqlite
        .query(
          `SELECT protocol_device_id FROM devices
           WHERE user_id = ? AND device_id = ?`,
        )
        .get(me.id, body.installId) as { protocol_device_id: number } | null
      const identity = sqlite
        .query('SELECT 1 AS valid FROM relay_identities WHERE user_id = ? AND install_id = ?')
        .get(me.id, body.installId)
      if (!owner || !identity) throw createAuthError('This device has no encryption keys')
      if (!isPublicKey(body.ephemeralPublicKey)) throw createValidationError('Invalid link key')
      const used = new Set(
        (
          sqlite
            .query('SELECT protocol_device_id AS id FROM devices WHERE user_id = ?')
            .all(me.id) as Array<{
            id: number
          }>
        ).map((row) => row.id),
      )
      for (const session of sessions.values()) {
        if (session.userId === me.id && session.status !== 'completed') used.add(session.deviceId)
      }
      const deviceId = [2, 3, 4, 5].find((id) => !used.has(id))
      if (!deviceId) throw createDuplicateItemError('This account already has five devices')
      const id = Bun.randomUUIDv7()
      sessions.set(id, {
        id,
        userId: me.id,
        ownerInstallId: body.installId,
        ownerPublicKey: body.ephemeralPublicKey,
        deviceId,
        status: 'waiting',
        expiresAt: Date.now() + SESSION_TTL_MS,
      })
      return { sessionId: id }
    },
    { body: t.Object({ installId: idField, ephemeralPublicKey: publicKeyField }) },
  )
  .post(
    '/connect',
    ({ body, user }) => {
      const me = requireUser(user)
      const session = getSession(body.sessionId, me.id)
      if (session.status !== 'waiting')
        throw createDuplicateItemError('Device link is already in use')
      if (session.ownerInstallId === body.installId)
        throw createValidationError('The approving device cannot link itself')
      if (!isPublicKey(body.ephemeralPublicKey)) throw createValidationError('Invalid link key')
      const existing = getDbInstance()
        .sqlite.query('SELECT 1 AS valid FROM devices WHERE user_id = ? AND device_id = ?')
        .get(me.id, body.installId)
      if (existing) throw createDuplicateItemError('This installation is already linked')
      session.newInstallId = body.installId
      session.newPublicKey = body.ephemeralPublicKey
      session.platform = body.platform
      session.status = 'connected'
      return { connected: true }
    },
    {
      body: t.Object({
        sessionId: idField,
        installId: idField,
        ephemeralPublicKey: publicKeyField,
        platform: t.Union([t.Literal('web'), t.Literal('android')]),
      }),
    },
  )
  .get(
    '/status',
    ({ query, user }) => {
      const me = requireUser(user)
      const session = getSession(query.sessionId, me.id)
      if (query.installId === session.ownerInstallId) {
        return {
          status: session.status,
          expiresAt: session.expiresAt,
          deviceId: session.deviceId,
          newDeviceEphemeralPublicKey: session.newPublicKey ?? null,
          platform: session.platform ?? null,
        }
      }
      requireNew(session, query.installId)
      return {
        status: session.status,
        expiresAt: session.expiresAt,
        deviceId: session.deviceId,
        encryptedMessage: session.encryptedMessage ?? null,
        primaryEphemeralPublicKey: session.ownerPublicKey,
      }
    },
    { query: t.Object({ sessionId: idField, installId: idField }) },
  )
  .post(
    '/send',
    ({ body, user }) => {
      const me = requireUser(user)
      const session = getSession(body.sessionId, me.id)
      requireOwner(session, body.installId)
      if (session.status !== 'connected')
        throw createValidationError('Device link is not connected')
      session.encryptedMessage = body.encryptedMessage
      session.status = 'ready'
      return { sent: true }
    },
    {
      body: t.Object({
        sessionId: idField,
        installId: idField,
        encryptedMessage: t.String({ minLength: 1, maxLength: 16 * 1024 }),
      }),
    },
  )
  .post(
    '/complete',
    ({ body, user }) => {
      const me = requireUser(user)
      const session = getSession(body.sessionId, me.id)
      requireNew(session, body.installId)
      if (session.status === 'linked_pending_ack') return { deviceId: session.deviceId }
      if (session.status !== 'ready' || !session.platform)
        throw createValidationError('Device link is not ready')
      getDbInstance()
        .sqlite.query(
          `INSERT INTO devices (user_id, device_id, protocol_device_id, platform, last_active_at, history_complete)
           VALUES (?, ?, ?, ?, ?, 0)`,
        )
        .run(
          me.id,
          body.installId,
          session.deviceId,
          session.platform,
          Math.floor(Date.now() / 1000),
        )
      session.status = 'linked_pending_ack'
      session.expiresAt = Date.now() + SESSION_TTL_MS
      return { deviceId: session.deviceId }
    },
    { body: t.Object({ sessionId: idField, installId: idField }) },
  )
  .post(
    '/ack',
    ({ body, user }) => {
      const me = requireUser(user)
      const session = getSession(body.sessionId, me.id)
      requireNew(session, body.installId)
      if (session.status !== 'linked_pending_ack')
        throw createValidationError('Device link is not awaiting acknowledgment')
      session.status = 'completed'
      session.encryptedMessage = undefined
      sessions.delete(session.id)
      return { linked: true }
    },
    { body: t.Object({ sessionId: idField, installId: idField }) },
  )
  .post(
    '/history/done',
    ({ body, user }) => {
      const me = requireUser(user)
      const sqlite = getDbInstance().sqlite
      const owner = sqlite
        .query('SELECT device_id FROM relay_identities WHERE user_id = ? AND install_id = ?')
        .get(me.id, body.installId) as { device_id: number } | null
      if (!owner || owner.device_id === body.targetDeviceId)
        throw createAuthError('A different linked device must transfer history')
      const updated = sqlite
        .query(`UPDATE devices SET history_complete = 1, history_unavailable = ?
        WHERE user_id = ? AND protocol_device_id = ? AND history_complete = 0`)
        .run(body.unavailable, me.id, body.targetDeviceId)
      if (!updated.changes) {
        const target = sqlite
          .query('SELECT 1 AS valid FROM devices WHERE user_id = ? AND protocol_device_id = ?')
          .get(me.id, body.targetDeviceId)
        if (!target) throw createNotFoundError('Linked device')
      }
      return { complete: true }
    },
    {
      body: t.Object({
        targetDeviceId: t.Integer({ minimum: 2, maximum: 5 }),
        installId: idField,
        unavailable: t.Integer({ minimum: 0, maximum: 1_000_000 }),
      }),
    },
  )
  .get(
    '/history/status',
    ({ query, user }) => {
      const me = requireUser(user)
      const row = getDbInstance()
        .sqlite.query(`SELECT d.history_complete AS historyComplete,
        d.history_unavailable AS historyUnavailable FROM devices d
        JOIN relay_identities ri ON ri.user_id = d.user_id AND ri.device_id = d.protocol_device_id
        WHERE d.user_id = ? AND d.device_id = ? AND d.protocol_device_id > 1`)
        .get(me.id, query.installId) as {
        historyComplete: number
        historyUnavailable: number
      } | null
      if (!row) throw createAuthError('This linked device is not registered')
      return {
        historyDone: Boolean(row.historyComplete),
        historyUnavailable: row.historyUnavailable,
      }
    },
    { query: t.Object({ installId: idField }) },
  )
  .post(
    '/cancel',
    ({ body, user }) => {
      const me = requireUser(user)
      const session = getSession(body.sessionId, me.id)
      if (body.installId !== session.ownerInstallId && body.installId !== session.newInstallId) {
        throw createAuthError('Not part of this device link')
      }
      removePendingDevice(session)
      sessions.delete(session.id)
      return { cancelled: true }
    },
    { body: t.Object({ sessionId: idField, installId: idField }) },
  )
  .get(
    '/history',
    ({ query, user }) => {
      const me = requireUser(user)
      const sqlite = getDbInstance().sqlite
      const owner = sqlite
        .query('SELECT device_id FROM relay_identities WHERE user_id = ? AND install_id = ?')
        .get(me.id, query.installId) as { device_id: number } | null
      if (!owner) throw createAuthError('This device has no encryption keys')
      const rows = sqlite
        .query(`SELECT m.rowid AS cursor, m.id, m.client_id AS clientId,
          m.room_id AS roomId, m.user_id AS userId, m.sender_protocol_device_id AS fromProtocolDeviceId,
          e.source_user_id AS envelopeSourceUserId, e.source_device_id AS envelopeSourceDeviceId,
          e.ciphertext
          FROM messages m JOIN room_members rm ON rm.room_id = m.room_id AND rm.user_id = ?
          LEFT JOIN message_envelopes e ON e.message_id = m.id AND e.target_user_id = ? AND e.target_device_id = ?
          WHERE m.rowid > ? AND m.is_encrypted = 1
          ORDER BY m.rowid ASC LIMIT 101`)
        .all(me.id, me.id, owner.device_id, Number(query.after ?? 0)) as Array<{
        cursor: number
        id: string
        clientId: string
        roomId: string
        userId: string
        fromProtocolDeviceId: number
        envelopeSourceUserId: string | null
        envelopeSourceDeviceId: number | null
        ciphertext: string | null
      }>
      return { messages: rows.slice(0, 100), hasMore: rows.length > 100 }
    },
    { query: t.Object({ installId: idField, after: t.Optional(t.String({ pattern: '^\\d+$' })) }) },
  )
  .post(
    '/history',
    async ({ body, user }) => {
      const me = requireUser(user)
      const sqlite = getDbInstance().sqlite
      const source = sqlite
        .query('SELECT device_id FROM relay_identities WHERE user_id = ? AND install_id = ?')
        .get(me.id, body.installId) as { device_id: number } | null
      const target = sqlite
        .query('SELECT 1 AS valid FROM relay_identities WHERE user_id = ? AND device_id = ?')
        .get(me.id, body.targetDeviceId)
      if (!source || !target || source.device_id === body.targetDeviceId)
        throw createAuthError('Device link is not ready for history transfer')
      const changedRooms = new Map<string, { id: string; sequence: number }>()
      sqlite.transaction(() => {
        const check = sqlite.query(`SELECT m.room_id AS roomId, m.sequence, m.id FROM messages m
          JOIN room_members rm ON rm.room_id = m.room_id AND rm.user_id = ?
          WHERE m.id = ? AND m.is_encrypted = 1`)
        const insert = sqlite.query(`INSERT OR IGNORE INTO message_envelopes
          (message_id, target_user_id, target_device_id, source_user_id, source_device_id, ciphertext)
          VALUES (?, ?, ?, ?, ?, ?)`)
        for (const envelope of body.envelopes) {
          const message = check.get(me.id, envelope.messageId) as {
            roomId: string
            sequence: number
            id: string
          } | null
          if (!message) throw createAuthError('A history message is outside this account')
          const result = insert.run(
            envelope.messageId,
            me.id,
            body.targetDeviceId,
            me.id,
            source.device_id,
            envelope.ciphertext,
          )
          if (result.changes) changedRooms.set(message.roomId, message)
        }
      })()
      await Promise.all(
        [...changedRooms.entries()].map(([roomId, message]) =>
          broadcastToRoom(
            roomId,
            JSON.stringify({
              type: 'message',
              payload: {
                id: message.id,
                roomId,
                sequence: message.sequence,
                ciphertext: 'history-update',
              },
            }),
          ),
        ),
      )
      return { stored: body.envelopes.length }
    },
    {
      body: t.Object({
        installId: idField,
        targetDeviceId: t.Integer({ minimum: 2, maximum: 5 }),
        envelopes: t.Array(
          t.Object({
            messageId: idField,
            ciphertext: t.String({ minLength: 1, maxLength: 12 * 1024 }),
          }),
          { minItems: 1, maxItems: 25 },
        ),
      }),
    },
  )
