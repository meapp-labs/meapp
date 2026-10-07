import { afterAll, beforeAll, expect, test } from 'bun:test'
import { getDbInstance, insertMessageWithSequence, runMigrations } from '@meapp/db'
import type { ReactionOperation, ReactionSync } from '@meapp/shared'
import { app } from '../index.ts'
import { resetInMemoryRateLimits } from '../plugins/rateLimit.ts'

const roomId = crypto.randomUUID()
const foreignRoom = crypto.randomUUID()
const prefix = `react_${crypto.randomUUID().slice(-8)}`
const users: { id: string; cookie: string; installId: string }[] = []
const previous = process.env.E2E_ENABLED
let messageId = ''
const sqlite = () => getDbInstance().sqlite
function member(index: number) {
  const user = users[index]
  if (!user) throw new Error('Missing fixture')
  return user
}
function request(index: number, path: string, body?: unknown) {
  return app.handle(
    new Request(`http://localhost/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: users[index]?.cookie ?? '',
        'x-forwarded-for': `${prefix}-${index}`,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  )
}
function operation(emoji: ReactionOperation['emoji'], predecessor = 0): ReactionOperation {
  return {
    conversationId: roomId,
    messageId,
    installId: member(1).installId,
    operationId: crypto.randomUUID(),
    predecessor,
    emoji,
  }
}
async function sync(index: number, after = 0) {
  return request(
    index,
    `reactions?conversationId=${roomId}&installId=${member(index).installId}&after=${after}`,
  )
}
beforeAll(async () => {
  process.env.E2E_ENABLED = 'true'
  runMigrations()
  resetInMemoryRateLimits()
  for (let index = 0; index < 3; index++) {
    const username = `${prefix}_${index}`
    expect(
      (
        await request(index, 'register', {
          username,
          password: 'secret123',
          confirmPassword: 'secret123',
          platform: 'web',
        })
      ).status,
    ).toBe(201)
    const response = await request(index, 'login', {
      username,
      password: 'secret123',
      platform: 'web',
    })
    users.push({
      id: '',
      cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '',
      installId: crypto.randomUUID(),
    })
    member(index).id = ((await (await request(index, 'me')).json()) as { id: string }).id
    sqlite()
      .query(
        `INSERT INTO relay_identities (user_id,device_id,install_id,registration_id,x25519_public_key,ed25519_public_key,created_at) VALUES (?,1,?,1,'opaque','opaque',?)`,
      )
      .run(member(index).id, member(index).installId, Date.now())
  }
  for (const id of [roomId, foreignRoom])
    sqlite()
      .query('INSERT INTO rooms (id,name,created_by,created_at) VALUES (?,?,?,?)')
      .run(id, prefix, member(0).id, 1)
  for (const user of users)
    sqlite()
      .query('INSERT INTO room_members (room_id,user_id,joined_at) VALUES (?,?,?)')
      .run(roomId, user.id, 1)
  const result = await insertMessageWithSequence(
    sqlite(),
    { roomId, userId: member(0).id, clientId: crypto.randomUUID(), ciphertext: 'opaque' },
    (id) => {
      sqlite()
        .query(
          'INSERT INTO message_envelopes (message_id,target_user_id,target_device_id,ciphertext) VALUES (?,?,1,?)',
        )
        .run(id, member(1).id, 'opaque')
    },
  )
  messageId = result.id
})
afterAll(() => {
  if (previous === undefined) Reflect.deleteProperty(process.env, 'E2E_ENABLED')
  else process.env.E2E_ENABLED = previous
  sqlite().query('DELETE FROM rooms WHERE id IN (?,?)').run(roomId, foreignRoom)
  for (const user of users) sqlite().query('DELETE FROM users WHERE id=?').run(user.id)
})

test('durable catch-up includes replacement and removal; retries and stale edits converge', async () => {
  const first = operation('❤️')
  const response = await request(1, 'reactions', first)
  expect(response.status).toBe(200)
  const a = (await response.json()) as { revision: number }
  const retry = await request(1, 'reactions', first)
  expect(await retry.json()).toEqual(a)
  expect((await request(1, 'reactions', { ...first, emoji: '🔥' })).status).toBe(409)
  const second = await request(1, 'reactions', operation('🔥', a.revision))
  expect(second.status).toBe(200)
  const b = (await second.json()) as { revision: number }
  expect((await request(1, 'reactions', operation('👍', a.revision))).status).toBe(409)
  const removal = await request(1, 'reactions', operation(null, b.revision))
  expect(removal.status).toBe(200)
  const c = (await removal.json()) as { revision: number }
  const offline = (await (await sync(1)).json()) as ReactionSync
  expect(offline.entries.map((entry) => entry.emoji)).toEqual(['❤️', '🔥', null])
  expect(offline.cursor).toBe(c.revision)
  const incremental = (await (await sync(1, a.revision)).json()) as ReactionSync
  expect(incremental.entries.map((entry) => entry.emoji)).toEqual(['🔥', null])
  expect(((await (await sync(1, c.revision)).json()) as ReactionSync).entries).toEqual([])
  // Replaying an old successful operation cannot undo the removal.
  expect((await request(1, 'reactions', first)).status).toBe(200)
  expect(((await (await sync(1, c.revision)).json()) as ReactionSync).entries).toEqual([])
})

test('new members cannot inspect or react to original recipients’ messages', async () => {
  expect(
    (await request(2, 'reactions', { ...operation('👍'), installId: member(2).installId })).status,
  ).toBe(403)
  expect(((await (await sync(2)).json()) as ReactionSync).entries).toEqual([])
  expect(
    (await request(1, 'reactions', { ...operation('👍'), conversationId: foreignRoom })).status,
  ).toBe(403)
  expect(
    (await request(1, 'reactions', { ...operation('👍'), installId: crypto.randomUUID() })).status,
  ).toBe(401)
})

test('encrypted replies validate target room and addressed-device access', async () => {
  const send = (index: number, target = messageId) =>
    request(index, 'send-message', {
      conversationId: roomId,
      replyTo: target,
      threadRootId: target,
      installId: member(index).installId,
      clientId: crypto.randomUUID(),
      envelopes: users
        .slice(0, 2)
        .filter((_, i) => i !== index)
        .map((user) => ({ targetUserId: user.id, targetDeviceId: 1, ciphertext: 'opaque-reply' })),
    })
  expect((await send(2)).status).toBe(403)
  expect((await send(1, crypto.randomUUID())).status).toBe(403)
  const reply = await send(1)
  expect(reply.status).toBe(200)
  expect(((await reply.json()) as { replyTo: string }).replyTo).toBe(messageId)
})

test('linked-device history grants reset a cursor past older reaction operations', async () => {
  const newer = await insertMessageWithSequence(
    sqlite(),
    { roomId, userId: member(1).id, clientId: crypto.randomUUID(), ciphertext: 'newer' },
    (id) => {
      sqlite()
        .query(
          'INSERT INTO message_envelopes (message_id,target_user_id,target_device_id,ciphertext) VALUES (?,?,1,?)',
        )
        .run(id, member(2).id, 'newer')
    },
  )
  expect((await request(1, 'reactions', { ...operation('👍'), messageId: newer.id })).status).toBe(
    200,
  )
  const before = (await (await sync(2)).json()) as ReactionSync
  expect(before.entries.every((entry) => entry.messageId === newer.id)).toBe(true)
  sqlite()
    .query(
      'INSERT INTO message_envelopes (message_id,target_user_id,target_device_id,ciphertext) VALUES (?,?,1,?)',
    )
    .run(messageId, member(2).id, 'transferred-history')
  const after = await request(
    2,
    `reactions?conversationId=${roomId}&installId=${member(2).installId}&after=${before.cursor}&audience=${before.audienceVersion}`,
  )
  const restored = (await after.json()) as ReactionSync
  expect(restored.audienceVersion).not.toBe(before.audienceVersion)
  expect(
    restored.entries.filter((entry) => entry.messageId === messageId).map((entry) => entry.emoji),
  ).toEqual(['❤️', '🔥', null])
})
