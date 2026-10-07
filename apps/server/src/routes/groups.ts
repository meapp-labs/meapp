import { createHash, randomBytes } from 'node:crypto'
import { getDbInstance, insertMessageWithSequence } from '@meapp/db'
import {
  MAX_GROUP_MEMBERS,
  addGroupMemberSchema,
  createInviteSchema,
  joinInviteSchema,
  leaveGroupSchema,
  transferAdminSchema,
  updateGroupSchema,
} from '@meapp/shared'
import { Elysia } from 'elysia'
import { requireRoomAccess } from '../lib/authz.ts'
import { chatTimestampIso } from '../lib/dbTime.ts'
import {
  createDuplicateItemError,
  createForbiddenError,
  createNotFoundError,
  createUserNotFoundError,
  createValidationError,
} from '../lib/errors.ts'
import { requireUser } from '../lib/session.ts'
import { authPlugin } from '../plugins/auth.ts'
import { broadcastRevokeUserRoomAccess, broadcastToRoom } from '../ws/chat.ts'

export { MAX_GROUP_MEMBERS } from '@meapp/shared'

type Sqlite = ReturnType<typeof getDbInstance>['sqlite']
function assertMembership(db: Sqlite, roomId: string, userId: string, admin = false) {
  const room = db.query('SELECT type FROM rooms WHERE id=?').get(roomId) as { type: string } | null
  if (!room || room.type !== 'group')
    throw createValidationError('Group operation requires a group room')
  const member = db
    .query('SELECT role FROM room_members WHERE room_id=? AND user_id=?')
    .get(roomId, userId) as { role: string } | null
  if (!member || (admin && member.role !== 'admin'))
    throw createForbiddenError('Group permission is no longer available')
  return member
}
function assertCapacity(db: Sqlite, roomId: string) {
  const count = db.query('SELECT COUNT(*) AS n FROM room_members WHERE room_id=?').get(roomId) as {
    n: number
  }
  if (count.n >= MAX_GROUP_MEMBERS)
    throw createValidationError('Group has reached maximum membership capacity')
}
function assertUnblocked(db: Sqlite, first: string, second: string) {
  if (
    db
      .query(
        'SELECT 1 FROM ignored_users WHERE (user_id=? AND ignored_user_id=?) OR (user_id=? AND ignored_user_id=?)',
      )
      .get(first, second, second, first)
  )
    throw createForbiddenError('Contact block prevents membership change')
}

export const groupRoutes = new Elysia({ prefix: '/api' })
  .use(authPlugin)

  // ─────────────────────────────────────────────────────────────
  // GET /rooms/:id/members — List room members with roles
  // ─────────────────────────────────────────────────────────────
  .get('/rooms/:id/members', async ({ params: { id }, user }) => {
    const me = requireUser(user)
    await requireRoomAccess(me.id, id)

    const sqlite = getDbInstance().sqlite
    const room = sqlite.query('SELECT id, type, name FROM rooms WHERE id = ?').get(id) as {
      id: string
      type: string
      name: string
    } | null

    if (!room) throw createNotFoundError('Room')

    const members = sqlite
      .query(
        `SELECT rm.user_id as userId, rm.role, rm.joined_at as joinedAt,
                u.username, u.name, u.display_name as displayName, u.avatar_url as avatarUrl
         FROM room_members rm
         JOIN users u ON u.id = rm.user_id
         WHERE rm.room_id = ?
         ORDER BY rm.joined_at ASC`,
      )
      .all(id) as Array<{
      userId: string
      role: 'admin' | 'member'
      joinedAt: number
      username: string
      name: string | null
      displayName: string | null
      avatarUrl: string | null
    }>

    return members.map((m) => ({
      userId: m.userId,
      username: m.username,
      displayName: m.displayName ?? m.name ?? undefined,
      avatarUrl: m.avatarUrl ?? undefined,
      role: m.role,
      joinedAt: chatTimestampIso(m.joinedAt),
    }))
  })

  // ─────────────────────────────────────────────────────────────
  // POST /rooms/:id/members — Admin adds member directly
  // ─────────────────────────────────────────────────────────────
  .post(
    '/rooms/:id/members',
    async ({ params: { id }, body, user }) => {
      const me = requireUser(user)
      const sqlite = getDbInstance().sqlite

      const room = sqlite.query('SELECT id, type, name FROM rooms WHERE id = ?').get(id) as {
        id: string
        type: string
        name: string
      } | null
      if (!room) throw createNotFoundError('Room')
      if (room.type === 'dm') {
        throw createValidationError('Direct messages have immutable membership')
      }

      const callerMembership = sqlite
        .query('SELECT role FROM room_members WHERE room_id = ? AND user_id = ?')
        .get(id, me.id) as { role: string } | null
      if (!callerMembership) throw createForbiddenError('You are not a member of this group')
      if (callerMembership.role !== 'admin') {
        throw createForbiddenError('Only group admins can add members')
      }

      const targetUser = sqlite
        .query('SELECT id, username FROM users WHERE username = ?')
        .get(body.username) as { id: string; username: string } | null
      if (!targetUser) throw createUserNotFoundError(body.username)

      const alreadyMember = sqlite
        .query('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?')
        .get(id, targetUser.id)
      if (alreadyMember) {
        throw createDuplicateItemError('User is already a member of this group')
      }

      // Block checks
      const isBlocked = sqlite
        .query(
          `SELECT 1 FROM ignored_users
           WHERE (user_id = ? AND ignored_user_id = ?)
              OR (user_id = ? AND ignored_user_id = ?)`,
        )
        .get(me.id, targetUser.id, targetUser.id, me.id)
      if (isBlocked) {
        throw createForbiddenError('Cannot add user due to contact block')
      }

      const countRow = sqlite
        .query('SELECT COUNT(*) as total FROM room_members WHERE room_id = ?')
        .get(id) as { total: number }
      if (countRow.total >= MAX_GROUP_MEMBERS) {
        throw createValidationError('Group has reached maximum membership capacity')
      }

      const memberRole = body.role ?? 'member'
      const joinedAtTimestamp = Math.floor(Date.now() / 1000)
      const eventText = `${me.username} added ${targetUser.username}`
      const msgClientId = Bun.randomUUIDv7()

      const result = await insertMessageWithSequence(sqlite, {
        roomId: id,
        userId: me.id,
        clientId: msgClientId,
        text: eventText,
        mutation: (db) => {
          assertMembership(db, id, me.id, true)
          assertCapacity(db, id)
          assertUnblocked(db, me.id, targetUser.id)
          db.query(
            'INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)',
          ).run(id, targetUser.id, memberRole, joinedAtTimestamp)
        },
      })

      const broadcastMsg = JSON.stringify({
        type: 'message',
        payload: {
          id: result.id,
          clientId: msgClientId,
          roomId: id,
          userId: me.id,
          from: me.username,
          sequence: result.sequence,
          text: eventText,
          createdAt: new Date(result.createdAt * 1000).toISOString(),
        },
      })
      await broadcastToRoom(id, broadcastMsg)

      return {
        success: true,
        member: {
          userId: targetUser.id,
          username: targetUser.username,
          role: memberRole,
          joinedAt: chatTimestampIso(joinedAtTimestamp),
        },
      }
    },
    { body: addGroupMemberSchema },
  )

  // ─────────────────────────────────────────────────────────────
  // POST /rooms/:id/leave — Member leaves group (with last-admin check)
  // ─────────────────────────────────────────────────────────────
  .post(
    '/rooms/:id/leave',
    async ({ params: { id }, body, user }) => {
      const me = requireUser(user)
      const sqlite = getDbInstance().sqlite

      const room = sqlite.query('SELECT id, type, name FROM rooms WHERE id = ?').get(id) as {
        id: string
        type: string
        name: string
      } | null
      if (!room) throw createNotFoundError('Room')
      if (room.type === 'dm') {
        throw createValidationError('Cannot leave a direct message')
      }

      const callerMembership = sqlite
        .query('SELECT role FROM room_members WHERE room_id = ? AND user_id = ?')
        .get(id, me.id) as { role: string } | null
      if (!callerMembership) throw createForbiddenError('You are not a member of this group')

      const memberCountRow = sqlite
        .query('SELECT COUNT(*) as total FROM room_members WHERE room_id = ?')
        .get(id) as { total: number }
      const totalMembers = memberCountRow.total

      const adminCountRow = sqlite
        .query("SELECT COUNT(*) as total FROM room_members WHERE room_id = ? AND role = 'admin'")
        .get(id) as { total: number }
      const totalAdmins = adminCountRow.total

      // Last admin validation
      let transferTargetId: string | undefined
      if (callerMembership.role === 'admin' && totalAdmins === 1 && totalMembers > 1) {
        const candidateId = body?.transferToUserId
        if (!candidateId) {
          throw createValidationError(
            'Last admin must transfer admin role before leaving the group',
          )
        }
        if (candidateId === me.id) {
          throw createValidationError('Cannot transfer admin role to yourself')
        }
        const targetIsMember = sqlite
          .query('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?')
          .get(id, candidateId)
        if (!targetIsMember) {
          throw createValidationError('Target user for admin transfer is not a member of this room')
        }
        transferTargetId = candidateId
      }

      const eventText = `${me.username} left the group`
      const msgClientId = Bun.randomUUIDv7()

      const result = await insertMessageWithSequence(sqlite, {
        roomId: id,
        userId: me.id,
        clientId: msgClientId,
        text: eventText,
        mutation: (db) => {
          const member = assertMembership(db, id, me.id)
          const admins = db
            .query("SELECT COUNT(*) AS n FROM room_members WHERE room_id=? AND role='admin'")
            .get(id) as { n: number }
          const members = db
            .query('SELECT COUNT(*) AS n FROM room_members WHERE room_id=?')
            .get(id) as { n: number }
          if (member.role === 'admin' && admins.n === 1 && members.n > 1) {
            transferTargetId = body.transferToUserId
            if (
              !transferTargetId ||
              transferTargetId === me.id ||
              !db
                .query('SELECT 1 FROM room_members WHERE room_id=? AND user_id=?')
                .get(id, transferTargetId)
            )
              throw createValidationError('Last admin must transfer admin role to a current member')
          }
          if (transferTargetId) {
            db.query(
              "UPDATE room_members SET role = 'admin' WHERE room_id = ? AND user_id = ?",
            ).run(id, transferTargetId)
          }
          db.query('DELETE FROM room_members WHERE room_id = ? AND user_id = ?').run(id, me.id)
          db.query('DELETE FROM room_invites WHERE room_id=? AND inviter_id=?').run(id, me.id)
        },
      })

      // Immediate live socket eviction
      await broadcastRevokeUserRoomAccess(me.id, id)

      // Broadcast leave event to remaining members
      const broadcastMsg = JSON.stringify({
        type: 'message',
        payload: {
          id: result.id,
          clientId: msgClientId,
          roomId: id,
          userId: me.id,
          from: me.username,
          sequence: result.sequence,
          text: eventText,
          createdAt: new Date(result.createdAt * 1000).toISOString(),
        },
      })
      await broadcastToRoom(id, broadcastMsg)

      return { success: true }
    },
    { body: leaveGroupSchema },
  )

  // ─────────────────────────────────────────────────────────────
  // DELETE /rooms/:id/members/:userId — Admin removes a member
  // ─────────────────────────────────────────────────────────────
  .delete('/rooms/:id/members/:userId', async ({ params: { id, userId: targetUserId }, user }) => {
    const me = requireUser(user)
    const sqlite = getDbInstance().sqlite

    const room = sqlite.query('SELECT id, type, name FROM rooms WHERE id = ?').get(id) as {
      id: string
      type: string
      name: string
    } | null
    if (!room) throw createNotFoundError('Room')
    if (room.type === 'dm') {
      throw createValidationError('Direct messages have immutable membership')
    }

    const callerMembership = sqlite
      .query('SELECT role FROM room_members WHERE room_id = ? AND user_id = ?')
      .get(id, me.id) as { role: string } | null
    if (!callerMembership) throw createForbiddenError('You are not a member of this group')
    if (callerMembership.role !== 'admin') {
      throw createForbiddenError('Only group admins can remove members')
    }

    if (targetUserId === me.id) {
      throw createValidationError('Use the leave endpoint to leave the group')
    }

    const targetMember = sqlite
      .query(
        `SELECT rm.role, u.username
           FROM room_members rm
           JOIN users u ON u.id = rm.user_id
           WHERE rm.room_id = ? AND rm.user_id = ?`,
      )
      .get(id, targetUserId) as { role: string; username: string } | null
    if (!targetMember) throw createNotFoundError('Member not found in this group')

    // Check last admin protection
    if (targetMember.role === 'admin') {
      const adminCount = sqlite
        .query("SELECT COUNT(*) as total FROM room_members WHERE room_id = ? AND role = 'admin'")
        .get(id) as { total: number }
      if (adminCount.total <= 1) {
        throw createValidationError('Cannot remove the last admin of the group')
      }
    }

    const eventText = `${me.username} removed ${targetMember.username}`
    const msgClientId = Bun.randomUUIDv7()

    const result = await insertMessageWithSequence(sqlite, {
      roomId: id,
      userId: me.id,
      clientId: msgClientId,
      text: eventText,
      mutation: (db) => {
        assertMembership(db, id, me.id, true)
        const target = db
          .query('SELECT role FROM room_members WHERE room_id=? AND user_id=?')
          .get(id, targetUserId) as { role: string } | null
        if (!target) throw createNotFoundError('Member')
        if (
          target.role === 'admin' &&
          (
            db
              .query("SELECT COUNT(*) AS n FROM room_members WHERE room_id=? AND role='admin'")
              .get(id) as { n: number }
          ).n <= 1
        )
          throw createValidationError('Cannot remove the last admin')
        db.query('DELETE FROM room_members WHERE room_id = ? AND user_id = ?').run(id, targetUserId)
        db.query('DELETE FROM room_invites WHERE room_id=? AND inviter_id=?').run(id, targetUserId)
      },
    })

    // Immediate socket eviction
    await broadcastRevokeUserRoomAccess(targetUserId, id)

    const broadcastMsg = JSON.stringify({
      type: 'message',
      payload: {
        id: result.id,
        clientId: msgClientId,
        roomId: id,
        userId: me.id,
        from: me.username,
        sequence: result.sequence,
        text: eventText,
        createdAt: new Date(result.createdAt * 1000).toISOString(),
      },
    })
    await broadcastToRoom(id, broadcastMsg)

    return { success: true }
  })

  // ─────────────────────────────────────────────────────────────
  // PATCH /rooms/:id — Rename group
  // ─────────────────────────────────────────────────────────────
  .patch(
    '/rooms/:id',
    async ({ params: { id }, body, user }) => {
      const me = requireUser(user)
      const sqlite = getDbInstance().sqlite

      const room = sqlite.query('SELECT id, type, name FROM rooms WHERE id = ?').get(id) as {
        id: string
        type: string
        name: string
      } | null
      if (!room) throw createNotFoundError('Room')
      if (room.type === 'dm') {
        throw createValidationError('Cannot rename a direct message')
      }

      const callerMembership = sqlite
        .query('SELECT role FROM room_members WHERE room_id = ? AND user_id = ?')
        .get(id, me.id) as { role: string } | null
      if (!callerMembership) throw createForbiddenError('You are not a member of this group')
      if (callerMembership.role !== 'admin') {
        throw createForbiddenError('Only group admins can rename the group')
      }

      const newName = body.name.trim()
      if (!newName) throw createValidationError('Group name cannot be empty')

      const eventText = `${me.username} renamed the group to "${newName}"`
      const msgClientId = Bun.randomUUIDv7()

      const result = await insertMessageWithSequence(sqlite, {
        roomId: id,
        userId: me.id,
        clientId: msgClientId,
        text: eventText,
        mutation: (db) => {
          assertMembership(db, id, me.id, true)
          db.query('UPDATE rooms SET name = ? WHERE id = ?').run(newName, id)
        },
      })

      const broadcastMsg = JSON.stringify({
        type: 'message',
        payload: {
          id: result.id,
          clientId: msgClientId,
          roomId: id,
          userId: me.id,
          from: me.username,
          sequence: result.sequence,
          text: eventText,
          createdAt: new Date(result.createdAt * 1000).toISOString(),
        },
      })
      await broadcastToRoom(id, broadcastMsg)

      return { id, name: newName }
    },
    { body: updateGroupSchema },
  )

  // ─────────────────────────────────────────────────────────────
  // POST /rooms/:id/transfer-admin — Transfer or promote admin
  // ─────────────────────────────────────────────────────────────
  .post(
    '/rooms/:id/transfer-admin',
    async ({ params: { id }, body, user }) => {
      const me = requireUser(user)
      const sqlite = getDbInstance().sqlite

      const room = sqlite.query('SELECT id, type, name FROM rooms WHERE id = ?').get(id) as {
        id: string
        type: string
        name: string
      } | null
      if (!room) throw createNotFoundError('Room')
      if (room.type === 'dm') {
        throw createValidationError('Direct messages have no group roles')
      }

      const callerMembership = sqlite
        .query('SELECT role FROM room_members WHERE room_id = ? AND user_id = ?')
        .get(id, me.id) as { role: string } | null
      if (!callerMembership) throw createForbiddenError('You are not a member of this group')
      if (callerMembership.role !== 'admin') {
        throw createForbiddenError('Only group admins can promote or transfer admin')
      }

      const targetMember = sqlite
        .query(
          `SELECT rm.role, u.username
           FROM room_members rm
           JOIN users u ON u.id = rm.user_id
           WHERE rm.room_id = ? AND rm.user_id = ?`,
        )
        .get(id, body.newAdminUserId) as { role: string; username: string } | null
      if (!targetMember) throw createNotFoundError('Target user is not a member of this group')

      const eventText = `${me.username} promoted ${targetMember.username} to admin`
      const msgClientId = Bun.randomUUIDv7()

      const result = await insertMessageWithSequence(sqlite, {
        roomId: id,
        userId: me.id,
        clientId: msgClientId,
        text: eventText,
        mutation: (db) => {
          assertMembership(db, id, me.id, true)
          if (
            !db
              .query('SELECT 1 FROM room_members WHERE room_id=? AND user_id=?')
              .get(id, body.newAdminUserId)
          )
            throw createNotFoundError('Member')
          db.query("UPDATE room_members SET role = 'admin' WHERE room_id = ? AND user_id = ?").run(
            id,
            body.newAdminUserId,
          )
        },
      })

      const broadcastMsg = JSON.stringify({
        type: 'message',
        payload: {
          id: result.id,
          clientId: msgClientId,
          roomId: id,
          userId: me.id,
          from: me.username,
          sequence: result.sequence,
          text: eventText,
          createdAt: new Date(result.createdAt * 1000).toISOString(),
        },
      })
      await broadcastToRoom(id, broadcastMsg)

      return { success: true }
    },
    { body: transferAdminSchema },
  )

  // ─────────────────────────────────────────────────────────────
  // POST /rooms/:id/invites — Create expiring hashed invite
  // ─────────────────────────────────────────────────────────────
  .post(
    '/rooms/:id/invites',
    async ({ params: { id }, body, user }) => {
      const me = requireUser(user)
      const sqlite = getDbInstance().sqlite

      const room = sqlite.query('SELECT id, type, name FROM rooms WHERE id = ?').get(id) as {
        id: string
        type: string
        name: string
      } | null
      if (!room) throw createNotFoundError('Room')
      if (room.type === 'dm') {
        throw createValidationError('Cannot invite to a direct message')
      }

      const callerMembership = sqlite
        .query('SELECT role FROM room_members WHERE room_id = ? AND user_id = ?')
        .get(id, me.id) as { role: string } | null
      if (!callerMembership) throw createForbiddenError('You are not a member of this group')
      if (callerMembership.role !== 'admin') {
        throw createForbiddenError('Only group admins can create invite links')
      }

      const rawToken = Bun.randomUUIDv7() + randomBytes(16).toString('hex')
      const tokenHash = createHash('sha256').update(rawToken).digest('hex')
      const expiresInHours = body.expiresInHours ?? 24
      const expiresAt = Math.floor(Date.now() / 1000) + expiresInHours * 3600
      const maxUses = body.maxUses ?? 1
      const role = body.role ?? 'member'
      const createdAt = Math.floor(Date.now() / 1000)

      sqlite
        .query(
          `INSERT INTO room_invites (token_hash, room_id, inviter_id, role, max_uses, uses_count, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
        )
        .run(tokenHash, id, me.id, role, maxUses, expiresAt, createdAt)

      return {
        token: rawToken,
        tokenHash,
        roomId: id,
        inviterId: me.id,
        role,
        maxUses,
        usesCount: 0,
        expiresAt: chatTimestampIso(expiresAt),
        createdAt: chatTimestampIso(createdAt),
      }
    },
    { body: createInviteSchema },
  )

  // ─────────────────────────────────────────────────────────────
  // GET /rooms/:id/invites — List active invites for room (admin only)
  // ─────────────────────────────────────────────────────────────
  .get('/rooms/:id/invites', async ({ params: { id }, user }) => {
    const me = requireUser(user)
    const sqlite = getDbInstance().sqlite

    const callerMembership = sqlite
      .query('SELECT role FROM room_members WHERE room_id = ? AND user_id = ?')
      .get(id, me.id) as { role: string } | null
    if (!callerMembership || callerMembership.role !== 'admin') {
      throw createForbiddenError('Only group admins can view room invites')
    }

    const now = Math.floor(Date.now() / 1000)
    const rows = sqlite
      .query(
        `SELECT token_hash as tokenHash, room_id as roomId, inviter_id as inviterId,
                role, max_uses as maxUses, uses_count as usesCount,
                expires_at as expiresAt, created_at as createdAt
         FROM room_invites
         WHERE room_id = ? AND expires_at > ? AND uses_count < max_uses
         ORDER BY created_at DESC`,
      )
      .all(id, now) as Array<{
      tokenHash: string
      roomId: string
      inviterId: string
      role: 'admin' | 'member'
      maxUses: number
      usesCount: number
      expiresAt: number
      createdAt: number
    }>

    return rows.map((r) => ({
      ...r,
      expiresAt: chatTimestampIso(r.expiresAt),
      createdAt: chatTimestampIso(r.createdAt),
    }))
  })

  // ─────────────────────────────────────────────────────────────
  // DELETE /rooms/:id/invites/:tokenHash — Revoke invite (admin only)
  // ─────────────────────────────────────────────────────────────
  .delete('/rooms/:id/invites/:tokenHash', async ({ params: { id, tokenHash }, user }) => {
    const me = requireUser(user)
    const sqlite = getDbInstance().sqlite

    const callerMembership = sqlite
      .query('SELECT role FROM room_members WHERE room_id = ? AND user_id = ?')
      .get(id, me.id) as { role: string } | null
    if (!callerMembership || callerMembership.role !== 'admin') {
      throw createForbiddenError('Only group admins can revoke room invites')
    }

    sqlite.query('DELETE FROM room_invites WHERE room_id = ? AND token_hash = ?').run(id, tokenHash)

    return { success: true }
  })

  // ─────────────────────────────────────────────────────────────
  // POST /invites/join — Authenticated join via unhashed invite token
  // ─────────────────────────────────────────────────────────────
  .post(
    '/invites/join',
    async ({ body, user }) => {
      const me = requireUser(user)
      const sqlite = getDbInstance().sqlite
      const tokenHash = createHash('sha256').update(body.token).digest('hex')
      const now = Math.floor(Date.now() / 1000)

      const invite = sqlite
        .query(
          `SELECT token_hash as tokenHash, room_id as roomId, inviter_id as inviterId,
                  role, max_uses as maxUses, uses_count as usesCount, expires_at as expiresAt
           FROM room_invites
           WHERE token_hash = ?`,
        )
        .get(tokenHash) as {
        tokenHash: string
        roomId: string
        inviterId: string
        role: string
        maxUses: number
        usesCount: number
        expiresAt: number
      } | null

      if (!invite) {
        throw createValidationError('Invite token is invalid, expired, or fully used')
      }

      const room = sqlite
        .query('SELECT id, type, name FROM rooms WHERE id = ?')
        .get(invite.roomId) as { id: string; type: string; name: string } | null
      if (!room || room.type === 'dm') {
        throw createValidationError('Invalid invite destination')
      }

      assertMembership(sqlite, invite.roomId, invite.inviterId, true)

      // Idempotency: if already a member, return success directly
      const alreadyMember = sqlite
        .query('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?')
        .get(invite.roomId, me.id)
      if (alreadyMember) {
        return { success: true, roomId: invite.roomId, alreadyJoined: true }
      }
      if (invite.expiresAt <= now || invite.usesCount >= invite.maxUses) {
        throw createValidationError('Invite token is expired or fully used')
      }

      // Block checks against inviter
      const isBlocked = sqlite
        .query(
          `SELECT 1 FROM ignored_users
           WHERE (user_id = ? AND ignored_user_id = ?)
              OR (user_id = ? AND ignored_user_id = ?)`,
        )
        .get(me.id, invite.inviterId, invite.inviterId, me.id)
      if (isBlocked) {
        throw createForbiddenError('Cannot join group due to contact block')
      }

      const countRow = sqlite
        .query('SELECT COUNT(*) as total FROM room_members WHERE room_id = ?')
        .get(invite.roomId) as { total: number }
      if (countRow.total >= MAX_GROUP_MEMBERS) {
        throw createValidationError('Group has reached maximum membership capacity')
      }

      const eventText = `${me.username} joined the group via invite`
      const msgClientId = Bun.randomUUIDv7()

      const result = await insertMessageWithSequence(sqlite, {
        roomId: invite.roomId,
        userId: me.id,
        clientId: msgClientId,
        text: eventText,
        mutation: (db) => {
          assertMembership(db, invite.roomId, invite.inviterId, true)
          assertCapacity(db, invite.roomId)
          assertUnblocked(db, me.id, invite.inviterId)
          // Atomically increment uses_count with constraint check
          const updated = db
            .query(
              `UPDATE room_invites
               SET uses_count = uses_count + 1
               WHERE token_hash = ? AND expires_at > ? AND uses_count < max_uses`,
            )
            .run(tokenHash, now)
          if (updated.changes === 0) {
            throw createValidationError('Invite token is invalid, expired, or fully used')
          }

          db.query(
            'INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)',
          ).run(invite.roomId, me.id, invite.role, now)
        },
      })

      const broadcastMsg = JSON.stringify({
        type: 'message',
        payload: {
          id: result.id,
          clientId: msgClientId,
          roomId: invite.roomId,
          userId: me.id,
          from: me.username,
          sequence: result.sequence,
          text: eventText,
          createdAt: new Date(result.createdAt * 1000).toISOString(),
        },
      })
      await broadcastToRoom(invite.roomId, broadcastMsg)

      return { success: true, roomId: invite.roomId, alreadyJoined: false }
    },
    { body: joinInviteSchema },
  )
