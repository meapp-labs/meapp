import { randomBytes } from 'node:crypto'
import { getDbInstance } from '@meapp/db'
import {
  mediaCommitSchema,
  mediaIntentSchema,
  mediaStatusSchema,
  mediaVariantSchema,
} from '@meapp/shared'
import { Elysia } from 'elysia'
import { canAccessRoom } from '../lib/authz.ts'
import { env, isE2EEnabled } from '../lib/config.ts'
import { devSeedMediaOrigin } from '../lib/devSeed.ts'
import { ApiError, ErrorCode, createAuthError, createValidationError } from '../lib/errors.ts'
import {
  deleteObject,
  headObject,
  mediaEnabled,
  mediaPublicOrigin,
  signedObjectUrl,
} from '../lib/mediaStorage.ts'
import { requireUser } from '../lib/session.ts'
import { authPlugin } from '../plugins/auth.ts'
import { broadcastToRoom } from '../ws/chat.ts'

const UPLOAD_TTL = 10 * 60
const PENDING_TTL = 24 * 60 * 60
const COMMITTED_TTL = 7 * 24 * 60 * 60
const nowSeconds = () => Math.floor(Date.now() / 1000)

type Row = {
  id: string
  client_id: string
  room_id: string
  sender_id: string
  storage_key: string
  state: 'pending' | 'committed' | 'linked' | 'deleting' | 'expired'
  variants_json: string
  cipher_total: number
  created_at: number
  last_upload_expiry: number
}

function requireMedia() {
  if (!isE2EEnabled()) throw createValidationError('Encrypted messages are required for media')
  if (!mediaEnabled())
    throw new ApiError(ErrorCode.INTERNAL_SERVER_ERROR, 'Media storage is not configured', 503)
}

function uploadsFor(row: Row) {
  const variants = mediaVariantSchema.array().parse(JSON.parse(row.variants_json))
  return variants.map(({ name, size }) => ({
    name,
    url: signedObjectUrl('PUT', `${row.storage_key}/${name}.enc`, UPLOAD_TTL, {
      'content-type': 'application/octet-stream',
      // Fetch derives Content-Length from the Blob; callers cannot upload beyond
      // the reservation using this URL. Browser JS must not set this header.
      'content-length': String(size),
      'if-none-match': '*',
      'cache-control': 'public, max-age=31536000, immutable',
    }),
    headers: {
      'Content-Type': 'application/octet-stream',
      'If-None-Match': '*',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  }))
}

export const mediaRoutes = new Elysia({ prefix: '/api/media' })
  .use(authPlugin)
  .get('/config', ({ user }) => {
    requireMedia()
    requireUser(user)
    return { publicUrl: mediaPublicOrigin() }
  })
  .post(
    '/intent',
    async ({ body, user }) => {
      requireMedia()
      const me = requireUser(user)
      if (!(await canAccessRoom(me.id, body.roomId))) throw createAuthError('Not a room member')
      const sqlite = getDbInstance().sqlite
      const variants = [...body.variants].sort((a, b) => a.name.localeCompare(b.name))
      const variantsJson = JSON.stringify(variants)
      const cipherTotal = variants.reduce((sum, v) => sum + v.size, 0)
      let row: Row
      sqlite.exec('BEGIN IMMEDIATE')
      try {
        const existing = sqlite
          .query('SELECT * FROM attachments WHERE sender_id=? AND client_id=?')
          .get(me.id, body.clientId) as Row | null
        if (existing) {
          if (existing.room_id !== body.roomId || existing.variants_json !== variantsJson) {
            throw new ApiError(ErrorCode.DUPLICATE_ITEM, 'Attachment intent changed on retry', 409)
          }
          if (existing.state === 'expired' || existing.state === 'deleting') {
            throw new ApiError(
              ErrorCode.ITEM_NOT_FOUND,
              'Attachment has expired; create a new intent',
              410,
            )
          }
          if (existing.state === 'pending') {
            if (existing.created_at + PENDING_TTL <= nowSeconds()) {
              throw new ApiError(
                ErrorCode.ITEM_NOT_FOUND,
                'Attachment has expired; create a new intent',
                410,
              )
            }
            sqlite
              .query('UPDATE attachments SET last_upload_expiry=? WHERE id=?')
              .run(nowSeconds() + UPLOAD_TTL, existing.id)
          }
          row = existing
        } else {
          const quota = sqlite
            .query(
              "SELECT COALESCE(SUM(cipher_total),0) AS total FROM attachments WHERE sender_id=? AND state<>'expired'",
            )
            .get(me.id) as { total: number }
          if (quota.total + cipherTotal > env.MEDIA_USER_QUOTA_BYTES) {
            throw new ApiError(ErrorCode.MEDIA_QUOTA_EXCEEDED, 'Media storage quota reached', 413)
          }
          row = {
            id: Bun.randomUUIDv7(),
            client_id: body.clientId,
            room_id: body.roomId,
            sender_id: me.id,
            storage_key: `cap/${randomBytes(16).toString('hex')}`,
            state: 'pending',
            variants_json: variantsJson,
            cipher_total: cipherTotal,
            created_at: nowSeconds(),
            last_upload_expiry: nowSeconds() + UPLOAD_TTL,
          }
          sqlite
            .query(`INSERT INTO attachments (id,client_id,room_id,sender_id,storage_key,state,variants_json,cipher_total,created_at,last_upload_expiry)
          VALUES (?,?,?,?,?,?,?,?,?,?)`)
            .run(
              row.id,
              row.client_id,
              row.room_id,
              row.sender_id,
              row.storage_key,
              row.state,
              row.variants_json,
              row.cipher_total,
              row.created_at,
              row.last_upload_expiry,
            )
        }
        sqlite.exec('COMMIT')
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
      return {
        attachmentId: row.id,
        base: row.storage_key,
        state: row.state,
        uploads: row.state === 'pending' ? uploadsFor(row) : [],
      }
    },
    { body: mediaIntentSchema },
  )
  .post(
    '/:id/commit',
    async ({ params, body, user }) => {
      requireMedia()
      const me = requireUser(user)
      const sqlite = getDbInstance().sqlite
      const row = sqlite
        .query('SELECT * FROM attachments WHERE id=? AND sender_id=?')
        .get(params.id, me.id) as Row | null
      if (!row) throw new ApiError(ErrorCode.ITEM_NOT_FOUND, 'Attachment not found', 404)
      if (body.clientId !== row.client_id)
        throw createValidationError('Attachment client ID does not match')
      if (!(await canAccessRoom(me.id, row.room_id))) throw createAuthError('Not a room member')
      if (row.state === 'expired' || row.state === 'deleting')
        throw new ApiError(ErrorCode.ITEM_NOT_FOUND, 'Attachment expired', 410)
      if (row.state === 'committed' || row.state === 'linked') return { ok: true }
      const variants = mediaVariantSchema.array().parse(JSON.parse(row.variants_json))
      for (const variant of variants) {
        const size = await headObject(`${row.storage_key}/${variant.name}.enc`)
        if (size !== variant.size)
          throw new ApiError(
            ErrorCode.VALIDATION_ERROR,
            'Encrypted upload is missing or has the wrong size',
            409,
          )
      }
      const result = sqlite
        .query(
          "UPDATE attachments SET state='committed',committed_at=? WHERE id=? AND state='pending'",
        )
        .run(nowSeconds(), row.id)
      if (result.changes === 0) {
        const state = (
          sqlite.query('SELECT state FROM attachments WHERE id=?').get(row.id) as {
            state: string
          } | null
        )?.state
        if (state !== 'committed' && state !== 'linked')
          throw new ApiError(ErrorCode.ITEM_NOT_FOUND, 'Attachment expired', 410)
      }
      return { ok: true }
    },
    { body: mediaCommitSchema },
  )
  .get('/:id/status', async ({ params, user, set }) => {
    const fixtureOrigin = devSeedMediaOrigin(params.id)
    if (!fixtureOrigin) requireMedia()
    const me = requireUser(user)
    const row = getDbInstance()
      .sqlite.query('SELECT * FROM attachments WHERE id=?')
      .get(params.id) as (Row & { linked_at: number | null }) | null
    if (!row) throw new ApiError(ErrorCode.ITEM_NOT_FOUND, 'Attachment not found', 404)
    if (!(await canAccessRoom(me.id, row.room_id))) throw createAuthError('Not a room member')
    set.headers['Cache-Control'] = 'no-store'
    const expired =
      row.state === 'deleting' ||
      row.state === 'expired' ||
      (row.state === 'linked' &&
        env.MEDIA_LINKED_TTL_SECONDS > 0 &&
        (row.linked_at === null || row.linked_at + env.MEDIA_LINKED_TTL_SECONDS <= nowSeconds()))
    return mediaStatusSchema.parse({
      available: row.state === 'linked' && !expired,
      state: expired ? 'expired' : row.state,
      ...(fixtureOrigin ? { publicUrl: fixtureOrigin } : {}),
    })
  })
  .delete('/:id', async ({ params, user }) => {
    const me = requireUser(user)
    const sqlite = getDbInstance().sqlite
    const row = sqlite
      .query('SELECT * FROM attachments WHERE id=? AND sender_id=?')
      .get(params.id, me.id) as Row | null
    if (!row) throw new ApiError(ErrorCode.ITEM_NOT_FOUND, 'Attachment not found', 404)
    if (!(await canAccessRoom(me.id, row.room_id))) throw createAuthError('Not a room member')
    // Durable tombstone precedes object deletion. Exact message retries still
    // return their original result; this attachment can never be linked again.
    sqlite
      .query(
        "UPDATE attachments SET state='deleting' WHERE id=? AND state NOT IN ('deleting','expired')",
      )
      .run(row.id)
    await broadcastToRoom(
      row.room_id,
      JSON.stringify({
        type: 'media-deleted',
        payload: { roomId: row.room_id, attachmentId: row.id },
      }),
    )
    void sweepMedia()
    return { ok: true }
  })

/** Claim in SQLite before touching R2 so sends can never link an object being deleted. */
let sweepPromise: Promise<void> | null = null
export function sweepMedia(): Promise<void> {
  sweepPromise ??= sweepMediaPass().finally(() => {
    sweepPromise = null
  })
  return sweepPromise
}
async function sweepMediaPass(): Promise<void> {
  if (!mediaEnabled()) return
  const sqlite = getDbInstance().sqlite
  const now = nowSeconds()
  if (env.MEDIA_LINKED_TTL_SECONDS > 0) {
    const expired = sqlite
      .query(
        "UPDATE attachments SET state='deleting' WHERE state='linked' AND linked_at<=? RETURNING id,room_id",
      )
      .all(now - env.MEDIA_LINKED_TTL_SECONDS) as { id: string; room_id: string }[]
    for (const row of expired)
      await broadcastToRoom(
        row.room_id,
        JSON.stringify({
          type: 'media-deleted',
          payload: { roomId: row.room_id, attachmentId: row.id },
        }),
      )
  }
  const rows = sqlite
    .query(`SELECT * FROM attachments WHERE state='deleting'
    OR (state='pending' AND created_at<? AND last_upload_expiry<?)
    OR (state='committed' AND committed_at<?) LIMIT 100`)
    .all(now - PENDING_TTL, now - UPLOAD_TTL, now - COMMITTED_TTL) as Row[]
  for (const row of rows) {
    try {
      if (row.state !== 'deleting') {
        const claimed = sqlite
          .query(`UPDATE attachments SET state='deleting' WHERE id=? AND state=? AND
            ((state='pending' AND created_at<? AND last_upload_expiry<?)
              OR (state='committed' AND committed_at<?))`)
          .run(row.id, row.state, now - PENDING_TTL, now - UPLOAD_TTL, now - COMMITTED_TTL)
        if (claimed.changes === 0) continue
      }
      const variants = mediaVariantSchema.array().parse(JSON.parse(row.variants_json))
      for (const variant of variants) await deleteObject(`${row.storage_key}/${variant.name}.enc`)
      // Keep tombstones for idempotent 410. Recheck recently expired keys in case
      // an already-started PUT completed after the first delete.
      sqlite
        .query("UPDATE attachments SET state='expired' WHERE id=? AND state='deleting'")
        .run(row.id)
    } catch (error) {
      console.error('[media] Cleanup deferred:', error)
    }
  }
  const late = sqlite
    .query("SELECT * FROM attachments WHERE state='expired' AND last_upload_expiry>? LIMIT 100")
    .all(now - PENDING_TTL) as Row[]
  for (const row of late) {
    try {
      for (const variant of mediaVariantSchema.array().parse(JSON.parse(row.variants_json))) {
        await deleteObject(`${row.storage_key}/${variant.name}.enc`)
      }
    } catch (error) {
      console.error('[media] Late cleanup deferred:', error)
    }
  }
}
