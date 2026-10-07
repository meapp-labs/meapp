import { afterAll, beforeAll, expect, test } from 'bun:test'
import { getDbInstance, runMigrations } from '@meapp/db'
import {
  E2E_CIPHERTEXT_MAX,
  E2E_SEND_MAX_BYTES,
  MAX_GROUP_MEMBERS,
  encryptedSendSchema,
} from '@meapp/shared'
import { app } from '../index.ts'
import { env } from '../lib/config.ts'
import { startPubsub } from '../ws/chat.ts'

const accounts: { id: string; username: string; cookie: string; installId: string }[] = []
const db = () => getDbInstance().sqlite
const previous = process.env.E2E_ENABLED
beforeAll(async () => {
  runMigrations()
  process.env.E2E_ENABLED = 'true'
  for (let actor = 0; actor < 2; actor++) {
    const username = `block_${crypto.randomUUID().slice(-8)}`
    const credentials = {
      username,
      password: 'secret123',
      confirmPassword: 'secret123',
      platform: 'web',
    }
    expect((await api('register', actor, credentials)).status).toBe(201)
    const login = await api('login', actor, credentials)
    const id = (db().query('SELECT id FROM users WHERE username=?').get(username) as { id: string })
      .id
    accounts.push({
      id,
      username,
      cookie: login.headers.get('set-cookie')?.split(';')[0] ?? '',
      installId: crypto.randomUUID(),
    })
    link(id, accounts[actor]?.installId ?? '', 1)
  }
})
afterAll(() => {
  process.env.E2E_ENABLED = previous
})
function account(actor: number) {
  const user = accounts[actor]
  if (!user) throw new Error('Missing test account')
  return user
}
function api(path: string, actor: number, body?: unknown, headers: Record<string, string> = {}) {
  return app.handle(
    new Request(`http://localhost/${path.startsWith('ws/') ? '' : 'api/'}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': `part1-${actor}`,
        cookie: accounts[actor]?.cookie ?? '',
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  )
}
function link(id: string, installId: string, device: number) {
  db()
    .query('INSERT INTO devices (user_id,device_id,protocol_device_id,platform) VALUES (?,?,?,?)')
    .run(id, installId, device, 'web')
  db()
    .query(
      'INSERT INTO relay_identities (user_id,device_id,install_id,registration_id,x25519_public_key,ed25519_public_key,created_at) VALUES (?,?,?,1,?,?,?)',
    )
    .run(id, device, installId, 'public', 'public', Date.now())
}
function room(type: 'dm' | 'group') {
  const id = crypto.randomUUID()
  db()
    .query('INSERT INTO rooms (id,name,type,created_by,created_at) VALUES (?,?,?,?,?)')
    .run(id, 'Regression', type, account(0).id, 1)
  for (const user of accounts)
    db()
      .query('INSERT INTO room_members (room_id,user_id,role,joined_at) VALUES (?,?,?,1)')
      .run(id, user.id, user === accounts[0] ? 'admin' : 'member')
  return id
}
function message(roomId: string, actor: number) {
  return {
    conversationId: roomId,
    clientId: crypto.randomUUID(),
    installId: account(actor).installId,
    envelopes: [
      {
        targetUserId: account(1 - actor).id,
        targetDeviceId: 1,
        ciphertext: 'opaque-encrypted-content',
      },
    ],
  }
}

test('blocking evicts a live DM sender, denies further contact, preserves history and common groups', async () => {
  const dm = room('dm')
  const group = room('group')
  const sent = await api('send-message', 0, message(dm, 0))
  expect(sent.status).toBe(200)
  const original = (await sent.json()) as { id: string }
  const ticket = (await (await api('ws/ticket', 0, { roomId: dm })).json()) as { ticket: string }
  const staleTicket = (await (await api('ws/ticket', 0, { roomId: dm })).json()) as {
    ticket: string
  }
  app.listen({ hostname: '127.0.0.1', port: 0 })
  await startPubsub(() => app.server ?? undefined)
  const url = `ws://127.0.0.1:${app.server?.port}/ws?roomId=${dm}`
  const ws = new WebSocket(url)
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
    timer = setTimeout(() => reject(new Error('Blocking socket timed out')), 5000)
  })
  ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', payload: ticket }))
  ws.onmessage = (event) => {
    if (JSON.parse(String(event.data)).type === 'authenticated') authenticated()
  }
  ws.onclose = (event) => closed(event.code)
  try {
    await Promise.race([auth, timeout])
    expect((await api('friend-requests/ignore', 1, { other: account(0).username })).status).toBe(
      200,
    )
    expect(await Promise.race([close, timeout])).toBe(4403)
    for (const actor of [0, 1]) {
      expect((await api('send-message', actor, message(dm, actor))).status).toBe(403)
      expect((await api('ws/ticket', actor, { roomId: dm })).status).toBe(403)
      expect(
        (
          await api(
            `e2e/relay/recipients?conversationId=${dm}&installId=${account(actor).installId}`,
            actor,
          )
        ).status,
      ).toBe(403)
      expect(
        (
          await api(
            `get-messages?conversationId=${dm}&installId=${account(actor).installId}`,
            actor,
          )
        ).status,
      ).toBe(200)
      expect((await api('send-message', actor, message(group, actor))).status).toBe(200)
    }
    const blockedSocket = new WebSocket(url)
    const denied = new Promise<number>((resolve) => {
      blockedSocket.onclose = (event) => resolve(event.code)
    })
    blockedSocket.onopen = () =>
      blockedSocket.send(JSON.stringify({ type: 'auth', payload: staleTicket }))
    expect(await Promise.race([denied, timeout])).toBe(4403)
    expect(
      (
        await api('reactions', 0, {
          conversationId: dm,
          messageId: original.id,
          installId: account(0).installId,
          operationId: crypto.randomUUID(),
          predecessor: 0,
          emoji: '👍',
        })
      ).status,
    ).toBe(403)
    const mediaConfig = { ...env }
    try {
      Object.assign(env, {
        R2_ACCOUNT_ID: 'a'.repeat(32),
        R2_ACCESS_KEY_ID: 'test',
        R2_SECRET_ACCESS_KEY: 'test',
        R2_BUCKET: 'test',
        R2_PUBLIC_URL: 'https://media.example.com',
      })
      expect(
        (
          await api('media/intent', 0, {
            roomId: dm,
            clientId: crypto.randomUUID(),
            variants: [{ name: 'orig', size: 100 }],
          })
        ).status,
      ).toBe(403)
      const attachmentId = crypto.randomUUID()
      const clientId = crypto.randomUUID()
      db()
        .query(`INSERT INTO attachments (id,client_id,room_id,sender_id,storage_key,state,variants_json,cipher_total,created_at,last_upload_expiry)
        VALUES (?,?,?,?,?,'pending',?,100,?,?)`)
        .run(
          attachmentId,
          clientId,
          dm,
          account(0).id,
          `cap/${crypto.randomUUID()}`,
          JSON.stringify([{ name: 'orig', size: 100 }]),
          Math.floor(Date.now() / 1000),
          Math.floor(Date.now() / 1000) + 300,
        )
      expect((await api(`media/${attachmentId}/commit`, 0, { clientId })).status).toBe(403)
    } finally {
      Object.assign(env, mediaConfig)
    }
    process.env.E2E_ENABLED = 'false'
    expect(
      (
        await api('send-message', 0, {
          conversationId: dm,
          clientId: crypto.randomUUID(),
          text: 'blocked',
        })
      ).status,
    ).toBe(403)
    process.env.E2E_ENABLED = 'true'
    expect(
      (
        db().query('SELECT COUNT(*) AS total FROM messages WHERE room_id=?').get(dm) as {
          total: number
        }
      ).total,
    ).toBe(1)
    expect((await api('friend-requests/ignore', 0, { other: account(1).username })).status).toBe(
      200,
    )
    expect((await api('ignored-users/remove', 1, { other: account(0).username })).status).toBe(200)
    expect((await api('send-message', 0, message(dm, 0))).status).toBe(403)
    expect((await api('ignored-users/remove', 0, { other: account(1).username })).status).toBe(200)
    expect((await api('send-message', 0, message(dm, 0))).status).toBe(200)
  } finally {
    clearTimeout(timer)
    ws.close()
    app.stop()
  }
}, 15000)

test('a 100-member group with five devices per member can send every addressed envelope', async () => {
  const group = room('group')
  for (const user of accounts)
    for (let device = 2; device <= 5; device++) link(user.id, crypto.randomUUID(), device)
  for (let member = 2; member < MAX_GROUP_MEMBERS; member++) {
    const id = crypto.randomUUID()
    db()
      .query('INSERT INTO users (id,username,password_hash,created_at) VALUES (?,?,?,1)')
      .run(id, `fanout_${id}`, 'unused')
    db()
      .query('INSERT INTO room_members (room_id,user_id,role,joined_at) VALUES (?,?,?,1)')
      .run(group, id, 'member')
    for (let device = 1; device <= 5; device++) link(id, crypto.randomUUID(), device)
  }
  const recipients = db()
    .query(
      'SELECT r.user_id AS targetUserId, r.device_id AS targetDeviceId FROM relay_identities r JOIN room_members m ON m.user_id=r.user_id WHERE m.room_id=? AND NOT (r.user_id=? AND r.device_id=1)',
    )
    .all(group, account(0).id) as { targetUserId: string; targetDeviceId: number }[]
  expect(recipients).toHaveLength(499)
  const payload = {
    conversationId: group,
    clientId: crypto.randomUUID(),
    installId: account(0).installId,
    envelopes: recipients.map((recipient) => ({
      ...recipient,
      ciphertext: 'A'.repeat(E2E_CIPHERTEXT_MAX),
    })),
  }
  const size = new TextEncoder().encode(JSON.stringify(payload)).length
  expect(size).toBeGreaterThan(700_000)
  expect(size).toBeLessThan(E2E_SEND_MAX_BYTES)
  const started = performance.now()
  const rssBefore = process.memoryUsage().rss
  expect((await api('send-message', 0, payload, { 'content-length': String(size) })).status).toBe(
    200,
  )
  if (process.env.MEAPP_MEASURE_GROUP === '1')
    console.log(
      JSON.stringify({
        validation: 'maximum-group-request',
        members: MAX_GROUP_MEMBERS,
        envelopes: recipients.length,
        requestBytes: size,
        handlerMs: Math.round((performance.now() - started) * 100) / 100,
        rssBefore,
        rssAfter: process.memoryUsage().rss,
        scope: 'isolated Bun handler; opaque envelopes, not device encryption or peak memory',
      }),
    )
  expect(
    encryptedSendSchema.safeParse({
      ...payload,
      envelopes: [...payload.envelopes, ...payload.envelopes.slice(0, 2)],
    }).success,
  ).toBe(false)
}, 15000)
