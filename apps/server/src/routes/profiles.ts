import { getDbInstance } from '@meapp/db'
import {
  avatarUploadSchema,
  contactAliasesSchema,
  editAliasSchema,
  editProfileSchema,
  profileSchema,
  usernameSchema,
} from '@meapp/shared'
import { Elysia } from 'elysia'
import { z } from 'zod'
import { ApiError, ErrorCode, createForbiddenError, createNotFoundError } from '../lib/errors.ts'
import { deleteObject, mediaEnabled, publicMediaUrl, putObject } from '../lib/mediaStorage.ts'
import { normalizeAvatar } from '../lib/profileImages.ts'
import { requireUser } from '../lib/session.ts'
import { authPlugin } from '../plugins/auth.ts'

function profile(id: string) {
  const row = getDbInstance()
    .sqlite.query(
      'SELECT id, username, COALESCE(display_name, username) AS displayName, avatar_url AS avatarUrl FROM users WHERE id=?',
    )
    .get(id)
  if (!row) throw createNotFoundError('Profile')
  return profileSchema.parse(row)
}

export const profileRoutes = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .get('/profile', ({ user, set }) => {
    set.headers['Cache-Control'] = 'no-store'
    return profile(requireUser(user).id)
  })
  .get(
    '/profiles',
    ({ user, query, set }) => {
      requireUser(user)
      set.headers['Cache-Control'] = 'no-store'
      const row = getDbInstance()
        .sqlite.query('SELECT id FROM users WHERE username=?')
        .get(query.username) as { id: string } | null
      if (!row) throw createNotFoundError('Profile')
      return profile(row.id)
    },
    { query: z.object({ username: usernameSchema }) },
  )
  .get(
    '/profiles/:id',
    ({ user, params, set }) => {
      requireUser(user)
      set.headers['Cache-Control'] = 'no-store'
      return profile(params.id)
    },
    { params: z.object({ id: z.string().uuid() }) },
  )
  .post(
    '/profile',
    ({ user, body }) => {
      const me = requireUser(user)
      getDbInstance()
        .sqlite.query('UPDATE users SET display_name=?, updated_at=? WHERE id=?')
        .run(body.displayName, Math.floor(Date.now() / 1000), me.id)
      return profile(me.id)
    },
    { body: editProfileSchema },
  )
  .post(
    '/profile/avatar',
    async ({ user, body }) => {
      const me = requireUser(user)
      const bytes = await normalizeAvatar(Buffer.from(body.image, 'base64'))
      if (!mediaEnabled())
        throw new ApiError(ErrorCode.INTERNAL_SERVER_ERROR, 'Avatar storage is not configured', 503)
      const id = crypto.randomUUID()
      const key = `avatars/${id}.webp`
      const url = publicMediaUrl(key)
      const sqlite = getDbInstance().sqlite
      // Durable pending record before the object write permits crash cleanup.
      sqlite
        .query('INSERT INTO profile_avatars (id,user_id,url,created_at) VALUES (?,?,?,?)')
        .run(id, me.id, url, Date.now())
      try {
        await putObject(key, new Uint8Array(bytes), 'image/webp')
      } catch {
        throw new ApiError(ErrorCode.INTERNAL_SERVER_ERROR, 'Avatar upload failed', 503)
      }
      sqlite
        .query('UPDATE users SET avatar_url=?, updated_at=? WHERE id=?')
        .run(url, Math.floor(Date.now() / 1000), me.id)
      return profile(me.id)
    },
    { body: avatarUploadSchema },
  )
  .post('/profile/avatar/remove', ({ user }) => {
    const me = requireUser(user)
    getDbInstance()
      .sqlite.query('UPDATE users SET avatar_url=NULL, updated_at=? WHERE id=?')
      .run(Math.floor(Date.now() / 1000), me.id)
    return profile(me.id)
  })
  .get('/contact-aliases', ({ user, set }) => {
    const me = requireUser(user)
    set.headers['Cache-Control'] = 'no-store'
    return contactAliasesSchema.parse(
      getDbInstance()
        .sqlite.query(
          'SELECT contact_user_id AS contactId, alias_ciphertext AS ciphertext, alias_revision AS revision FROM contacts WHERE user_id=?',
        )
        .all(me.id),
    )
  })
  .post(
    '/contact-aliases/:id',
    ({ user, params, body }) => {
      const me = requireUser(user)
      const sqlite = getDbInstance().sqlite
      sqlite.transaction(() => {
        const row = sqlite
          .query(
            'SELECT alias_revision AS revision FROM contacts WHERE user_id=? AND contact_user_id=?',
          )
          .get(me.id, params.id) as { revision: number } | null
        if (!row) throw createForbiddenError('Aliases can only be edited for your contacts')
        if (row.revision !== body.revision)
          throw new ApiError(
            ErrorCode.DUPLICATE_ITEM,
            'Alias changed on another device. Close the editor and try again.',
            409,
          )
        sqlite
          .query(
            'UPDATE contacts SET alias_ciphertext=?, alias_revision=alias_revision+1 WHERE user_id=? AND contact_user_id=?',
          )
          .run(body.ciphertext, me.id, params.id)
      })()
      return { revision: body.revision + 1, ciphertext: body.ciphertext }
    },
    { params: z.object({ id: z.string().uuid() }), body: editAliasSchema },
  )

export async function sweepProfileAvatars() {
  if (!mediaEnabled()) return
  const sqlite = getDbInstance().sqlite
  const rows = sqlite
    .query(
      'SELECT id FROM profile_avatars WHERE created_at<? AND NOT EXISTS (SELECT 1 FROM users WHERE users.avatar_url=profile_avatars.url) LIMIT 100',
    )
    .all(Date.now() - 3600_000) as { id: string }[]
  for (const row of rows) {
    try {
      await deleteObject(`avatars/${row.id}.webp`)
      sqlite.query('DELETE FROM profile_avatars WHERE id=?').run(row.id)
    } catch (error) {
      console.error('[Profile] Avatar cleanup failed', error)
    }
  }
}
