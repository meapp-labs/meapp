import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test'
import { getDbInstance, insertMessageWithSequence, runMigrations } from '@meapp/db'
import type { Conversation, MessagesResponse } from '@meapp/shared'
import { app } from '../index.ts'
import { resetInMemoryRateLimits } from '../plugins/rateLimit.ts'

const prefix = `receipt_${Bun.randomUUIDv7().slice(-8)}`
const room = Bun.randomUUIDv7()
const foreignRoom = Bun.randomUUIDv7()
const previousFlag = process.env.E2E_ENABLED
const users: { id: string; cookie: string; installId: string; username: string }[] = []
let first = ''
let second = ''
let own = ''
let outside = ''
const sqlite = () => getDbInstance().sqlite
function getUser(index: number) {
  const user = users[index]
  if (!user) throw new Error(`Missing test user ${index}`)
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
async function ack(
  index: number,
  kind: 'read' | 'delivered',
  ids: string[],
  installId = users[index]?.installId,
) {
  return request(index, kind, { conversationId: room, messageIds: ids, installId })
}
async function summary(index: number) {
  return ((await (await request(index, 'conversations')).json()) as Conversation[]).find(
    (value) => value.id === room,
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
    const login = await request(index, 'login', {
      username,
      password: 'secret123',
      platform: 'web',
    })
    expect(login.status).toBe(200)
    const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? ''
    users[index] = { id: '', cookie, installId: Bun.randomUUIDv7(), username }
    getUser(index).id = ((await (await request(index, 'me')).json()) as { id: string }).id
    sqlite()
      .query(`INSERT INTO relay_identities
      (user_id,device_id,install_id,registration_id,x25519_public_key,ed25519_public_key,created_at)
      VALUES (?,1,?,1,'opaque','opaque',?)`)
      .run(getUser(index).id, getUser(index).installId, Date.now())
  }
  for (const id of [room, foreignRoom]) {
    sqlite()
      .query('INSERT INTO rooms (id,name,created_by,created_at) VALUES (?,?,?,?)')
      .run(id, 'Receipt test', getUser(0).id, 1)
    for (const member of users.slice(0, 2))
      sqlite()
        .query('INSERT INTO room_members (room_id,user_id,joined_at) VALUES (?,?,?)')
        .run(id, member.id, 1)
  }
  async function message(roomId: string, sender: number) {
    const result = await insertMessageWithSequence(
      sqlite(),
      {
        roomId,
        userId: getUser(sender).id,
        clientId: Bun.randomUUIDv7(),
        ciphertext: 'opaque',
        deviceId: getUser(sender).installId,
      },
      (messageId) =>
        sqlite()
          .query(
            'INSERT INTO message_envelopes (message_id,target_user_id,target_device_id,ciphertext) VALUES (?,?,1,?)',
          )
          .run(messageId, getUser(sender === 0 ? 1 : 0).id, 'opaque'),
    )
    return result.id
  }
  first = await message(room, 0)
  own = await message(room, 1)
  // Simulate a sequence gap without deleting messages or changing the allocator.
  sqlite().query('UPDATE messages SET sequence=7 WHERE id=?').run(own)
  second = await message(room, 0)
  outside = await message(foreignRoom, 0)
})

beforeEach(() => {
  resetInMemoryRateLimits()
  sqlite()
    .query(
      'DELETE FROM message_receipts WHERE message_id IN (SELECT id FROM messages WHERE room_id=?)',
    )
    .run(room)
  sqlite().query('DELETE FROM receipt_preferences WHERE room_id=?').run(room)
})
afterAll(() => {
  process.env.E2E_ENABLED = previousFlag
  for (const id of [room, foreignRoom]) sqlite().query('DELETE FROM rooms WHERE id=?').run(id)
  for (const user of users) sqlite().query('DELETE FROM users WHERE id=?').run(user.id)
})

test('counts incoming messages exactly and keeps an earliest unread landmark across gaps and retries', async () => {
  expect((await summary(1))?.unreadCount).toBe(2)
  expect((await summary(1))?.firstUnreadSequence).toBe(1)
  expect((await summary(0))?.firstUnreadSequence).toBe(7)
  expect((await ack(1, 'read', [second])).status).toBe(200)
  expect((await summary(1))?.unreadCount).toBe(1)
  expect((await summary(1))?.firstUnreadSequence).toBe(1)
  expect((await summary(1))?.readState).toEqual({ [getUser(1).id]: 8 })
  expect((await ack(1, 'read', [first])).status).toBe(200)
  expect((await ack(1, 'read', [second, first])).status).toBe(200)
  expect((await summary(1))?.unreadCount).toBe(0)
  expect((await summary(1))?.firstUnreadSequence).toBeNull()
  expect(
    sqlite()
      .query('SELECT COUNT(*) AS count FROM message_receipts WHERE user_id=?')
      .get(getUser(1).id),
  ).toEqual({ count: 2 })
})

test('reading does not change anything exposed to the sender, including legacy shared rows', async () => {
  const path = `get-messages?conversationId=${room}&installId=${getUser(0).installId}&limit=2`
  const beforeMessages = await (await request(0, path)).json()
  const beforeSummary = await summary(0)
  expect((await ack(1, 'read', [first, second])).status).toBe(200)
  sqlite()
    .query('UPDATE message_receipts SET shared_read_at=? WHERE user_id=?')
    .run(Date.now(), getUser(1).id)
  expect(await (await request(0, path)).json()).toEqual(beforeMessages)
  expect(await summary(0)).toEqual(beforeSummary)
  expect((await summary(0))?.readState).toEqual({})
  expect(await summary(1)).not.toHaveProperty('shareReadReceipts')
  const page = beforeMessages as MessagesResponse
  expect(page.messages.map((message) => message.sequence)).toEqual([7, 8])
  expect(page.hasMore).toBe(true)
  for (const message of page.messages) expect(message).not.toHaveProperty('receipts')
  const recipientPage = (await (
    await request(1, `get-messages?conversationId=${room}&installId=${getUser(1).installId}`)
  ).json()) as MessagesResponse
  expect(recipientPage.messages.find((message) => message.id === first)?.acknowledgedRead).toBe(
    true,
  )
  expect(recipientPage.firstUnreadSequence).toBeNull()
})

test('removed delivery and public receipt APIs are unavailable and sharing parameters are rejected', async () => {
  expect((await request(0, `receipts?conversationId=${room}&messageIds=${first}`)).status).toBe(404)
  expect((await ack(1, 'delivered', [first])).status).toBe(404)
  expect(
    (await request(1, 'receipt-preferences', { conversationId: room, shareReadReceipts: true }))
      .status,
  ).toBe(404)
  expect(
    (
      await request(1, 'read', {
        conversationId: room,
        messageIds: [first],
        installId: getUser(1).installId,
        shareRead: true,
      })
    ).status,
  ).toBe(400)
})

test('rejects invalid batches atomically and requires addressed registered devices', async () => {
  expect((await ack(99, 'read', [first])).status).toBe(401)
  expect((await ack(2, 'read', [first])).status).toBe(403)
  expect((await ack(1, 'read', [first, outside])).status).toBe(400)
  expect((await ack(1, 'read', [own])).status).toBe(400)
  expect((await ack(1, 'read', [first, first])).status).toBe(400)
  expect((await ack(1, 'read', [first], Bun.randomUUIDv7())).status).toBe(401)
  expect((await summary(1))?.unreadCount).toBe(2)
  const newInstall = Bun.randomUUIDv7()
  sqlite()
    .query(`INSERT INTO relay_identities
    (user_id,device_id,install_id,registration_id,x25519_public_key,ed25519_public_key,created_at)
    VALUES (?,2,?,1,'opaque','opaque',?)`)
    .run(getUser(1).id, newInstall, Date.now())
  expect((await ack(1, 'read', [first], newInstall)).status).toBe(400)
  sqlite()
    .query(
      'INSERT INTO message_envelopes (message_id,target_user_id,target_device_id,ciphertext) VALUES (?,?,2,?)',
    )
    .run(first, getUser(1).id, 'opaque')
  expect((await ack(1, 'read', [first], newInstall)).status).toBe(200)
  expect((await ack(1, 'read', [first])).status).toBe(200)
  expect((await summary(1))?.unreadCount).toBe(1)
})
