import { beforeAll, beforeEach, expect, test } from 'bun:test'
import { getDbInstance, insertMessageWithSequence, runMigrations } from '@meapp/db'
import { app } from '../index.ts'
import { resetInMemoryRateLimits } from '../plugins/rateLimit.ts'
import { startPubsub } from '../ws/chat.ts'

const suffix = crypto.randomUUID().slice(0, 8)
const users: Array<{ id: string; username: string; cookie: string }> = []
function account(index: number) {
  const user = users[index]
  if (!user) throw new Error('Test account not initialized')
  return user
}
const db = () => getDbInstance().sqlite
function api(path: string, actor = 0, method = 'GET', body?: unknown) {
  return app.handle(
    new Request(`http://localhost/${path.startsWith('ws/') ? '' : 'api/'}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        cookie: users[actor]?.cookie ?? '',
        'x-forwarded-for': `groups-${suffix}-${actor}`,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  )
}
function room(type: 'group' | 'dm' = 'group') {
  const id = crypto.randomUUID()
  db()
    .query('INSERT INTO rooms (id,name,type,created_by,created_at) VALUES (?,?,?,?,?)')
    .run(id, 'Test group', type, account(0).id, 1)
  for (const index of [0, 1])
    db()
      .query('INSERT INTO room_members (room_id,user_id,role,joined_at) VALUES (?,?,?,?)')
      .run(id, account(index).id, index === 0 ? 'admin' : 'member', 1)
  return id
}
async function invite(id: string, maxUses = 1) {
  const res = await api(`rooms/${id}/invites`, 0, 'POST', { maxUses })
  expect(res.status).toBe(200)
  return (await res.json()) as { token: string; tokenHash: string }
}
beforeAll(async () => {
  runMigrations()
  resetInMemoryRateLimits()
  for (let i = 0; i < 4; i++) {
    const username = `group_${i}_${suffix}`
    expect(
      (
        await api('register', i, 'POST', {
          username,
          password: 'secret123',
          confirmPassword: 'secret123',
        })
      ).status,
    ).toBe(201)
    const res = await api('login', i, 'POST', { username, password: 'secret123' })
    expect(res.status).toBe(200)
    const cookie = res.headers.get('set-cookie')?.split(';')[0] ?? ''
    const user = db().query('SELECT id FROM users WHERE username=?').get(username) as { id: string }
    users.push({ ...user, username, cookie })
  }
})
beforeEach(resetInMemoryRateLimits)

test('group creation rolls back the room when a member insert fails and reports a request ID', async () => {
  const name = `rollback-${crypto.randomUUID()}`
  db().exec(`CREATE TEMP TRIGGER audit_group_member_failure BEFORE INSERT ON room_members
    WHEN NEW.user_id='${account(2).id}' BEGIN SELECT RAISE(ABORT, 'Audit member failure'); END`)
  try {
    const response = await api('conversations', 0, 'POST', {
      type: 'group',
      name,
      participants: [account(1).username, account(2).username],
    })
    expect(response.status).toBe(500)
    expect(response.headers.get('X-Request-Id')).toBeTruthy()
    expect(db().query('SELECT COUNT(*) AS total FROM rooms WHERE name=?').get(name)).toEqual({
      total: 0,
    })
  } finally {
    db().exec('DROP TRIGGER audit_group_member_failure')
  }
})

test('group roles authorize administration and DM membership is immutable', async () => {
  const id = room()
  expect((await api(`rooms/${id}/members`, -1)).status).toBe(401)
  expect((await api(`rooms/${id}/members`, 2)).status).toBe(403)
  expect((await api(`rooms/${id}`, 1, 'PATCH', { name: 'Renamed' })).status).toBe(403)
  expect(
    (await api(`rooms/${id}/members`, 1, 'POST', { username: account(2).username })).status,
  ).toBe(403)
  expect((await api(`rooms/${id}/invites`, 1, 'POST', {})).status).toBe(403)
  expect((await api(`rooms/${id}`, 0, 'PATCH', { name: ' Renamed ' })).status).toBe(200)
  expect(
    (await api(`rooms/${id}/members`, 0, 'POST', { username: account(2).username })).status,
  ).toBe(200)
  expect(
    (await api(`rooms/${id}/members`, 0, 'POST', { username: account(2).username })).status,
  ).toBe(409)
  const events = db()
    .query('SELECT sequence FROM messages WHERE room_id=? ORDER BY sequence')
    .all(id)
  expect(events).toEqual([{ sequence: 1 }, { sequence: 2 }])
  const dm = room('dm')
  expect(
    (await api(`rooms/${dm}/members`, 0, 'POST', { username: account(2).username })).status,
  ).toBe(400)
  expect((await api(`rooms/${dm}`, 0, 'PATCH', { name: 'Wrong' })).status).toBe(400)
  expect((await api(`rooms/${dm}/leave`, 1, 'POST', {})).status).toBe(400)
})

test('last admin leave is atomic, transfers to a real member, and retains group type with two members', async () => {
  const id = room()
  expect((await api(`rooms/${id}/leave`, 0, 'POST', {})).status).toBe(400)
  expect(
    (await api(`rooms/${id}/leave`, 0, 'POST', { transferToUserId: account(2).id })).status,
  ).toBe(400)
  expect(
    (await api(`rooms/${id}/leave`, 0, 'POST', { transferToUserId: account(1).id })).status,
  ).toBe(200)
  expect(
    db()
      .query('SELECT role FROM room_members WHERE room_id=? AND user_id=?')
      .get(id, account(1).id),
  ).toEqual({ role: 'admin' })
  expect((await api(`rooms/${id}/members`, 0)).status).toBe(403)
  const conversations = (await (await api('conversations', 1)).json()) as Array<{
    id: string
    isGroup: boolean
    type: string
  }>
  expect(conversations.find((r) => r.id === id)).toMatchObject({ isGroup: true, type: 'group' })
  expect((await api(`rooms/${id}/leave`, 1, 'POST', {})).status).toBe(200)
})

test('invites are hashed, bounded, idempotent for members and enforce concurrent use counts', async () => {
  const id = room()
  const capability = await invite(id)
  expect(db().query('SELECT token_hash FROM room_invites WHERE room_id=?').get(id)).toEqual({
    token_hash: capability.tokenHash,
  })
  expect(capability.tokenHash).not.toBe(capability.token)
  const outcomes = await Promise.all([
    api('invites/join', 2, 'POST', { token: capability.token }),
    api('invites/join', 3, 'POST', { token: capability.token }),
  ])
  expect(outcomes.map((r) => r.status).sort()).toEqual([200, 400])
  const winner = outcomes[0]?.status === 200 ? 2 : 3
  expect((await api('invites/join', winner, 'POST', { token: capability.token })).status).toBe(200)
  const stale = await invite(id, 10)
  db().query('UPDATE room_invites SET expires_at=0 WHERE token_hash=?').run(stale.tokenHash)
  expect(
    (await api('invites/join', winner === 2 ? 3 : 2, 'POST', { token: stale.token })).status,
  ).toBe(400)
  const revoked = await invite(id, 10)
  expect((await api(`rooms/${id}/invites/${revoked.tokenHash}`, 0, 'DELETE')).status).toBe(200)
  expect(
    (await api('invites/join', winner === 2 ? 3 : 2, 'POST', { token: revoked.token })).status,
  ).toBe(400)
})

test('blocked joins and departed inviters cannot grant access', async () => {
  const id = room()
  const capability = await invite(id, 10)
  db()
    .query('INSERT INTO ignored_users (user_id,ignored_user_id,created_at) VALUES (?,?,?)')
    .run(account(2).id, account(0).id, 1)
  expect((await api('invites/join', 2, 'POST', { token: capability.token })).status).toBe(403)
  db()
    .query('DELETE FROM ignored_users WHERE user_id=? AND ignored_user_id=?')
    .run(account(2).id, account(0).id)
  expect(
    (await api(`rooms/${id}/leave`, 0, 'POST', { transferToUserId: account(1).id })).status,
  ).toBe(200)
  expect((await api('invites/join', 2, 'POST', { token: capability.token })).status).toBe(400)
})

test('membership mutation rolls back with its message when it fails', async () => {
  const id = room()
  await expect(
    insertMessageWithSequence(db(), {
      roomId: id,
      userId: account(0).id,
      clientId: crypto.randomUUID(),
      text: 'Group metadata',
      mutation: (sqlite) => {
        sqlite
          .query('DELETE FROM room_members WHERE room_id=? AND user_id=?')
          .run(id, account(1).id)
        throw new Error('Reject mutation')
      },
    }),
  ).rejects.toThrow('Reject mutation')
  expect(
    db().query('SELECT 1 FROM room_members WHERE room_id=? AND user_id=?').get(id, account(1).id),
  ).not.toBeNull()
  expect(
    (db().query('SELECT COUNT(*) AS n FROM messages WHERE room_id=?').get(id) as { n: number }).n,
  ).toBe(0)
})

test('removing a member closes an authenticated room socket and denies fresh access', async () => {
  const id = room()
  const ticketResponse = await api('ws/ticket', 1, 'POST', { roomId: id })
  expect(ticketResponse.status).toBe(200)
  const { ticket } = (await ticketResponse.json()) as { ticket: string }
  app.listen({ hostname: '127.0.0.1', port: 0 })
  await startPubsub(() => app.server ?? undefined)
  const ws = new WebSocket(`ws://127.0.0.1:${app.server?.port}/ws?roomId=${id}`)
  let authenticated!: () => void
  let closed!: (code: number) => void
  const auth = new Promise<void>((resolve) => {
    authenticated = resolve
  })
  const close = new Promise<number>((resolve) => {
    closed = resolve
  })
  let timer!: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Group socket timed out')), 5000)
  })
  ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', payload: { ticket } }))
  ws.onmessage = (event) => {
    if (JSON.parse(String(event.data)).type === 'authenticated') authenticated()
  }
  ws.onclose = (event) => closed(event.code)
  try {
    await Promise.race([auth, timeout])
    expect((await api(`rooms/${id}/members/${account(1).id}`, 0, 'DELETE')).status).toBe(200)
    expect(await Promise.race([close, timeout])).toBe(4403)
    expect((await api('ws/ticket', 1, 'POST', { roomId: id })).status).toBe(403)
    expect((await api(`rooms/${id}/members`, 1)).status).toBe(403)
    const previousE2E = process.env.E2E_ENABLED
    try {
      process.env.E2E_ENABLED = 'false'
      const history = await api(`get-messages?conversationId=${id}`, 1)
      expect(history.status).toBe(401)
      expect(((await history.json()) as { message: string }).message).toBe(
        'You are not a participant in this conversation',
      )
    } finally {
      process.env.E2E_ENABLED = previousE2E
    }
  } finally {
    clearTimeout(timer)
    ws.close()
    app.stop()
  }
})
