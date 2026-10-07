import { afterAll, beforeAll, expect, test } from 'bun:test'
import { getDbInstance, insertMessageWithSequence, runMigrations } from '@meapp/db'
import type { Conversation, MessagesResponse } from '@meapp/shared'
import { app } from '../index.ts'
import { resetInMemoryRateLimits } from '../plugins/rateLimit.ts'

const roomId = crypto.randomUUID()
const prefix = `thread_${crypto.randomUUID().slice(-8)}`
const previous = process.env.E2E_ENABLED
const users: { id: string; cookie: string; installId: string }[] = []
let rootId = ''
let otherRoot = ''
const sqlite = () => getDbInstance().sqlite
function member(index: number) {
  const user = users[index]
  if (!user) throw new Error('Missing thread fixture')
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
const payload = (index: number, root = rootId, quote?: string) => ({
  conversationId: roomId,
  threadRootId: root,
  ...(quote ? { replyTo: quote } : {}),
  installId: member(index).installId,
  clientId: crypto.randomUUID(),
  envelopes: users
    .slice(0, 2)
    .filter((_, i) => i !== index)
    .map((user) => ({
      targetUserId: user.id,
      targetDeviceId: 1,
      ciphertext: `opaque-${crypto.randomUUID()}`,
    })),
})
const history = (index: number, suffix = '') =>
  request(
    index,
    `get-messages?conversationId=${roomId}&installId=${member(index).installId}${suffix}`,
  )
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
    users.push({
      id: '',
      cookie: login.headers.get('set-cookie')?.split(';')[0] ?? '',
      installId: crypto.randomUUID(),
    })
    member(index).id = ((await (await request(index, 'me')).json()) as { id: string }).id
    sqlite()
      .query(
        "INSERT INTO devices (user_id,device_id,protocol_device_id,platform,last_active_at) VALUES (?,?,1,'web',?) ON CONFLICT(user_id,protocol_device_id) DO UPDATE SET device_id=excluded.device_id",
      )
      .run(member(index).id, member(index).installId, Date.now())
    sqlite()
      .query(
        `INSERT INTO relay_identities (user_id,device_id,install_id,registration_id,x25519_public_key,ed25519_public_key,created_at) VALUES (?,1,?,1,'opaque','opaque',?)`,
      )
      .run(member(index).id, member(index).installId, Date.now())
  }
  sqlite()
    .query('INSERT INTO rooms (id,name,created_by,created_at) VALUES (?,?,?,?)')
    .run(roomId, prefix, member(0).id, 1)
  for (const user of users)
    sqlite()
      .query('INSERT INTO room_members (room_id,user_id,joined_at) VALUES (?,?,?)')
      .run(roomId, user.id, 1)
  for (let index = 0; index < 2; index++) {
    const root = await insertMessageWithSequence(
      sqlite(),
      { roomId, userId: member(0).id, clientId: crypto.randomUUID(), ciphertext: 'opaque-root' },
      (id) => {
        sqlite()
          .query(
            'INSERT INTO message_envelopes (message_id,target_user_id,target_device_id,ciphertext) VALUES (?,?,1,?)',
          )
          .run(id, member(1).id, 'opaque-root')
      },
    )
    if (index === 0) rootId = root.id
    else otherRoot = root.id
  }
})
afterAll(() => {
  if (previous === undefined) Reflect.deleteProperty(process.env, 'E2E_ENABLED')
  else process.env.E2E_ENABLED = previous
  sqlite().query('DELETE FROM rooms WHERE id=?').run(roomId)
  for (const user of users) sqlite().query('DELETE FROM users WHERE id=?').run(user.id)
})

test('quotes within threads remain flat; nested and cross-thread targets are rejected', async () => {
  const firstResponse = await request(1, 'send-message', payload(1))
  expect(firstResponse.status).toBe(200)
  const first = (await firstResponse.json()) as { id: string; sequence: number }
  const secondResponse = await request(1, 'send-message', payload(1, rootId, first.id))
  expect(secondResponse.status).toBe(200)
  const second = (await secondResponse.json()) as {
    id: string
    sequence: number
    threadRootId: string
    replyTo: string
  }
  expect(second.threadRootId).toBe(rootId)
  expect(second.replyTo).toBe(first.id)
  expect(second.sequence).toBeGreaterThan(first.sequence)
  expect((await request(1, 'send-message', payload(1, first.id))).status).toBe(400)
  expect((await request(1, 'send-message', payload(1, rootId, otherRoot))).status).toBe(400)
  const thread = (await (await history(0, `&threadRootId=${rootId}`)).json()) as MessagesResponse
  expect(thread.threadRoot?.id).toBe(rootId)
  expect(thread.messages.map((message) => message.id)).toEqual([first.id, second.id])
  expect(thread.threadSummaries?.[rootId]?.replyCount).toBe(2)
  expect(thread.threadSummaries?.[rootId]?.unreadCount).toBe(2)
  const incremental = (await (
    await history(0, `&after=${first.sequence}`)
  ).json()) as MessagesResponse
  expect(incremental.messages.find((message) => message.id === second.id)?.threadRootId).toBe(
    rootId,
  )
})

test('thread access and envelope audiences exclude new members', async () => {
  expect((await history(2, `&threadRootId=${rootId}`)).status).toBe(403)
  expect((await request(2, 'send-message', payload(2))).status).toBe(403)
  const extra = payload(1)
  extra.envelopes.push({ targetUserId: member(2).id, targetDeviceId: 1, ciphertext: 'disclosure' })
  expect((await request(1, 'send-message', extra)).status).toBe(400)
  const recipients = await request(
    1,
    `e2e/relay/recipients?conversationId=${roomId}&installId=${member(1).installId}&threadRootId=${rootId}`,
  )
  expect(recipients.status).toBe(200)
  expect(((await recipients.json()) as { userId: string }[]).map((row) => row.userId)).toEqual([
    member(0).id,
  ])
  const newcomer = (await (await history(2)).json()) as MessagesResponse
  expect(newcomer.threadSummaries).toEqual({})
})

test('thread pagination retains the whole original and only viewing replies marks them read', async () => {
  for (let index = 0; index < 18; index++)
    expect((await request(1, 'send-message', payload(1))).status).toBe(200)
  const latest = (await (
    await history(0, `&threadRootId=${rootId}&limit=16`)
  ).json()) as MessagesResponse
  expect(latest.messages.length).toBe(16)
  expect(latest.threadRoot?.id).toBe(rootId)
  expect(latest.hasMore).toBe(true)
  const older = (await (
    await history(0, `&threadRootId=${rootId}&before=${latest.messages[0]?.sequence}&limit=16`)
  ).json()) as MessagesResponse
  expect(older.messages.length).toBe(4)
  expect(older.threadRoot?.id).toBe(rootId)
  expect(new Set([...latest.messages, ...older.messages].map((message) => message.id)).size).toBe(
    20,
  )
  const summary = latest.threadSummaries?.[rootId]
  expect(summary?.unreadCount).toBe(20)
  const conversations = (await (await request(0, 'conversations')).json()) as Conversation[]
  expect(conversations.find((conversation) => conversation.id === roomId)?.unreadCount).toBe(20)
  const read = await request(0, 'read', {
    conversationId: roomId,
    installId: member(0).installId,
    messageIds: [...latest.messages, ...older.messages].map((message) => message.id),
  })
  expect(read.status).toBe(200)
  const refreshed = (await (await history(0, `&threadRootId=${rootId}`)).json()) as MessagesResponse
  expect(refreshed.threadSummaries?.[rootId]?.unreadCount).toBe(0)
})

test('lost-response retries remain idempotent after another linked device appears', async () => {
  const send = payload(1)
  const response = await request(1, 'send-message', send)
  expect(response.status).toBe(200)
  const original = (await response.json()) as { id: string; sequence: number }
  sqlite()
    .query(
      `INSERT INTO relay_identities (user_id,device_id,install_id,registration_id,x25519_public_key,ed25519_public_key,created_at) VALUES (?,2,?,1,'opaque','opaque',?)`,
    )
    .run(member(0).id, crypto.randomUUID(), Date.now())
  const retry = await request(1, 'send-message', send)
  expect(retry.status).toBe(200)
  expect(((await retry.json()) as { id: string }).id).toBe(original.id)
  expect((await request(1, 'send-message', { ...send, threadRootId: otherRoot })).status).toBe(409)
})
