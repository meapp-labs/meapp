import { afterAll, beforeAll, beforeEach, expect, spyOn, test } from 'bun:test'
import { getDbInstance, runMigrations } from '@meapp/db'
import { app } from '../index.ts'
import { env } from '../lib/config.ts'
import { signedObjectUrl } from '../lib/mediaStorage.ts'
import { resetInMemoryRateLimits } from '../plugins/rateLimit.ts'
import { sweepMedia } from './media.ts'

const previous = { ...env }
const previousFlag = process.env.E2E_ENABLED
const room = Bun.randomUUIDv7()
const otherRoom = Bun.randomUUIDv7()
const recipient = Bun.randomUUIDv7()
const installId = Bun.randomUUIDv7()
const username = `media_${Bun.randomUUIDv7().slice(-8)}`
let sender = ''
let cookie = ''
const objects = new Map<string, number>()
let deletionFails = false
let onDelete: (() => void) | null = null
const remote = spyOn(globalThis, 'fetch')
const db = () => getDbInstance().sqlite
const now = () => Math.floor(Date.now() / 1000)

async function request(path: string, body?: unknown, authenticated = true) {
  return app.handle(
    new Request(`http://localhost/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: authenticated ? cookie : '',
        'x-forwarded-for': username,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  )
}
async function intent(roomId = room, clientId = Bun.randomUUIDv7()) {
  const response = await request('media/intent', {
    roomId,
    clientId,
    variants: [{ name: 'orig', size: 100 }],
  })
  expect(response.status).toBe(200)
  const data = (await response.json()) as {
    attachmentId: string
    base: string
    uploads: { url: string; headers: Record<string, string> }[]
  }
  return { ...data, clientId }
}
async function committed() {
  const item = await intent()
  objects.set(`/${env.R2_BUCKET}/${item.base}/orig.enc`, 100)
  expect(
    (await request(`media/${item.attachmentId}/commit`, { clientId: item.clientId })).status,
  ).toBe(200)
  return item
}
function send(ids: string[], clientId = Bun.randomUUIDv7()) {
  return {
    conversationId: room,
    clientId,
    installId,
    attachmentIds: ids,
    envelopes: [
      { targetUserId: recipient, targetDeviceId: 1, ciphertext: 'opaque-encrypted-media' },
    ],
  }
}
function state(id: string) {
  return db().query('SELECT state FROM attachments WHERE id=?').get(id) as { state: string }
}

beforeAll(async () => {
  process.env.E2E_ENABLED = 'true'
  Object.assign(env, {
    R2_ACCOUNT_ID: 'a'.repeat(32),
    R2_ACCESS_KEY_ID: 'test-access',
    R2_SECRET_ACCESS_KEY: 'test-secret',
    R2_BUCKET: 'media-test',
    R2_PUBLIC_URL: 'https://media.example.test',
  })
  runMigrations()
  resetInMemoryRateLimits()
  expect(
    (
      await request('register', {
        username,
        password: 'secret123',
        confirmPassword: 'secret123',
        platform: 'web',
      })
    ).status,
  ).toBe(201)
  const login = await request('login', { username, password: 'secret123', platform: 'web' })
  cookie = login.headers.get('set-cookie')?.split(';')[0] ?? ''
  sender = ((await (await request('me')).json()) as { id: string }).id
  db()
    .query('INSERT INTO users (id,username,password_hash,created_at) VALUES (?,?,?,?)')
    .run(recipient, `${username}_recipient`, 'unused', now())
  for (const id of [room, otherRoom]) {
    db()
      .query('INSERT INTO rooms (id,name,created_by,created_at) VALUES (?,?,?,?)')
      .run(id, 'Media test', sender, now())
    for (const user of [sender, recipient])
      db()
        .query('INSERT INTO room_members (room_id,user_id,joined_at) VALUES (?,?,?)')
        .run(id, user, now())
  }
  for (const user of [sender, recipient]) {
    db()
      .query(
        'INSERT INTO relay_identities (user_id,device_id,install_id,registration_id,x25519_public_key,ed25519_public_key,created_at) VALUES (?,1,?,1,?,?,?)',
      )
      .run(user, user === sender ? installId : Bun.randomUUIDv7(), 'opaque', 'opaque', now())
  }
  remote.mockImplementation(
    Object.assign(
      async (input: string | URL | Request, options?: RequestInit) => {
        const url = new URL(String(input))
        if (options?.method === 'HEAD')
          return objects.has(url.pathname)
            ? new Response(null, {
                headers: { 'content-length': String(objects.get(url.pathname)) },
              })
            : new Response(null, { status: 404 })
        if (options?.method === 'DELETE') {
          onDelete?.()
          if (deletionFails) return new Response(null, { status: 503 })
          objects.delete(url.pathname)
          return new Response(null, { status: 204 })
        }
        throw new Error(`Unexpected storage request: ${options?.method}`)
      },
      { preconnect: fetch.preconnect },
    ),
  )
})
beforeEach(() => {
  resetInMemoryRateLimits()
  deletionFails = false
  onDelete = null
})
afterAll(() => {
  remote.mockRestore()
  Object.assign(env, previous)
  process.env.E2E_ENABLED = previousFlag
  db().query('DELETE FROM attachments WHERE sender_id=?').run(sender)
  for (const id of [room, otherRoom]) db().query('DELETE FROM rooms WHERE id=?').run(id)
  for (const id of [sender, recipient]) db().query('DELETE FROM users WHERE id=?').run(id)
})

test('intent is authenticated, private, immutable, and idempotent', async () => {
  expect((await request('media/config', undefined, false)).status).toBe(401)
  const item = await intent()
  const again = await intent(room, item.clientId)
  expect(again.attachmentId).toBe(item.attachmentId)
  expect(item.base).toMatch(/^cap\/[a-f0-9]{32}$/)
  expect(item.uploads[0]?.headers['If-None-Match']).toBe('*')
  expect(new URL(item.uploads[0]?.url ?? '').searchParams.get('X-Amz-SignedHeaders')).toContain(
    'if-none-match',
  )
  expect(
    (
      await request('media/intent', {
        roomId: room,
        clientId: item.clientId,
        variants: [{ name: 'orig', size: 101 }],
      })
    ).status,
  ).toBe(409)
  expect(
    (
      await request('media/intent', {
        roomId: room,
        clientId: Bun.randomUUIDv7(),
        mime: 'image/gif',
        variants: [{ name: 'orig', size: 100 }],
      })
    ).status,
  ).toBe(400)
})

test('commit requires the attachment client ID, membership, and exact object size', async () => {
  const item = await intent()
  expect(
    (await request(`media/${item.attachmentId}/commit`, { clientId: Bun.randomUUIDv7() })).status,
  ).toBe(400)
  expect(
    (await request(`media/${item.attachmentId}/commit`, { clientId: item.clientId })).status,
  ).toBe(409)
  objects.set(`/${env.R2_BUCKET}/${item.base}/orig.enc`, 99)
  expect(
    (await request(`media/${item.attachmentId}/commit`, { clientId: item.clientId })).status,
  ).toBe(409)
  objects.set(`/${env.R2_BUCKET}/${item.base}/orig.enc`, 100)
  expect(
    (await request(`media/${item.attachmentId}/commit`, { clientId: item.clientId })).status,
  ).toBe(200)
  expect(
    (await request(`media/${item.attachmentId}/commit`, { clientId: item.clientId })).status,
  ).toBe(200)
})

test('media sends link atomically, persist bookkeeping, and retry exactly once', async () => {
  const item = await committed()
  const payload = send([item.attachmentId])
  const response = await request('send-message', payload)
  expect(response.status).toBe(200)
  const message = (await response.json()) as { id: string }
  expect(state(item.attachmentId).state).toBe('linked')
  expect(db().query('SELECT linked_to FROM attachments WHERE id=?').get(item.attachmentId)).toEqual(
    { linked_to: payload.clientId },
  )
  const retry = await request('send-message', payload)
  expect(retry.status).toBe(200)
  expect(((await retry.json()) as { id: string }).id).toBe(message.id)
  expect((await request('send-message', send([item.attachmentId]))).status).toBe(409)
  const history = (await (
    await request(`get-messages?conversationId=${room}&installId=${installId}`)
  ).json()) as { messages: { id: string; attachmentIds?: string[] }[] }
  expect(history.messages.find((entry) => entry.id === message.id)?.attachmentIds).toEqual([
    item.attachmentId,
  ])
})

test('invalid second attachment rolls back the first linkage and message insert', async () => {
  const first = await committed()
  const second = await intent()
  const payload = send([first.attachmentId, second.attachmentId])
  expect((await request('send-message', payload)).status).toBe(409)
  expect(state(first.attachmentId).state).toBe('committed')
  expect(db().query('SELECT id FROM messages WHERE client_id=?').get(payload.clientId)).toBeNull()
  const elsewhere = await intent(otherRoom)
  db()
    .query("UPDATE attachments SET state='committed',committed_at=? WHERE id=?")
    .run(now(), elsewhere.attachmentId)
  expect((await request('send-message', send([elsewhere.attachmentId]))).status).toBe(409)
})

test('GC claims before remote deletion, retries failures, and never touches linked media', async () => {
  const item = await committed()
  db()
    .query('UPDATE attachments SET committed_at=? WHERE id=?')
    .run(now() - 8 * 86400, item.attachmentId)
  deletionFails = true
  await sweepMedia()
  expect(state(item.attachmentId).state).toBe('deleting')
  expect((await request('send-message', send([item.attachmentId]))).status).toBe(410)
  deletionFails = false
  await sweepMedia()
  expect(state(item.attachmentId).state).toBe('expired')
  expect(objects.has(`/${env.R2_BUCKET}/${item.base}/orig.enc`)).toBe(false)
  expect(
    (await request(`media/${item.attachmentId}/commit`, { clientId: item.clientId })).status,
  ).toBe(410)
  expect(
    (
      await request('media/intent', {
        roomId: room,
        clientId: item.clientId,
        variants: [{ name: 'orig', size: 100 }],
      })
    ).status,
  ).toBe(410)
  expect(
    db()
      .query("SELECT COUNT(*) AS total FROM attachments WHERE state='linked' AND sender_id=?")
      .get(sender),
  ).toEqual({ total: 1 })
})

test('quota excludes tombstones but includes pending reservations', async () => {
  const before = env.MEDIA_USER_QUOTA_BYTES
  env.MEDIA_USER_QUOTA_BYTES = 1
  try {
    expect(
      (
        await request('media/intent', {
          roomId: room,
          clientId: Bun.randomUUIDv7(),
          variants: [{ name: 'orig', size: 100 }],
        })
      ).status,
    ).toBe(413)
  } finally {
    env.MEDIA_USER_QUOTA_BYTES = before
  }
})

test('GC rechecks eligibility when an intent is refreshed during another deletion', async () => {
  const deleting = await intent()
  const pending = await intent()
  db().query("UPDATE attachments SET state='deleting' WHERE id=?").run(deleting.attachmentId)
  db()
    .query('UPDATE attachments SET created_at=?,last_upload_expiry=? WHERE id=?')
    .run(now() - 2 * 86400, now() - 86400, pending.attachmentId)
  onDelete = () => {
    db()
      .query('UPDATE attachments SET last_upload_expiry=? WHERE id=?')
      .run(now() + 600, pending.attachmentId)
  }
  await sweepMedia()
  expect(state(pending.attachmentId).state).toBe('pending')
})

test('presigner binds method, object path, expiry, and fixed headers', () => {
  const url = new URL(
    signedObjectUrl('PUT', 'cap/test space/orig.enc', 600, {
      'Content-Type': 'application/octet-stream',
      'If-None-Match': '*',
    }),
  )
  expect(url.pathname).toBe('/media-test/cap/test%20space/orig.enc')
  expect(url.searchParams.get('X-Amz-Expires')).toBe('600')
  expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-type;host;if-none-match')
  expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/)
})
