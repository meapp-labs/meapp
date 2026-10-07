import { beforeAll, expect, test } from 'bun:test'
import { getDbInstance, runMigrations } from '@meapp/db'
import { app } from '../index'
import { makePasswordHash } from '../lib/passwords'
import { sendMessage } from '../lib/services/sendMessage'
beforeAll(() => runMigrations())
test('saved messages are singleton, private, accept zero recipients and require linked-device envelopes', async () => {
  process.env.E2E_ENABLED = 'true'
  const db = getDbInstance().sqlite
  const id = crypto.randomUUID()
  const installId = crypto.randomUUID()
  const username = `saved_${id.slice(0, 8)}`
  db.query('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    id,
    username,
    await makePasswordHash('secret123'),
    1,
  )
  const login = await app.handle(
    new Request('http://localhost/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: 'secret123', platform: 'web' }),
    }),
  )
  const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? ''
  const call = (path: string, body: unknown) =>
    app.handle(
      new Request(`http://localhost/api/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(body),
      }),
    )
  const first = await call('saved-messages', {})
  expect(first.status).toBe(200)
  const room = (await first.json()) as { id: string; type: string }
  expect(room.type).toBe('saved')
  expect(((await (await call('saved-messages', {})).json()) as { id: string }).id).toBe(room.id)
  db.query(
    'INSERT INTO devices (device_id, user_id, platform, protocol_device_id, last_active_at) VALUES (?, ?, ?, ?, ?)',
  ).run(installId, id, 'web', 1, Date.now())
  db.query(
    'INSERT INTO relay_identities (user_id, device_id, install_id, x25519_public_key, registration_id, ed25519_public_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, 1, installId, 'opaque-identity', 1, 'web', 1)
  const send = { conversationId: room.id, installId, clientId: crypto.randomUUID(), envelopes: [] }
  const response = await call('send-message', send)
  expect(response.status).toBe(200)
  expect((await call('send-message', send)).status).toBe(200)
  expect(
    (
      db.query('SELECT COUNT(*) AS count FROM messages WHERE room_id = ?').get(room.id) as {
        count: number
      }
    ).count,
  ).toBe(1)
  expect((await call(`rooms/${room.id}/members`, { username })).status).toBe(400)
  expect((await call(`rooms/${room.id}/invites`, {})).status).toBeGreaterThanOrEqual(400)
  const secondInstall = crypto.randomUUID()
  db.query(
    'INSERT INTO devices (device_id, user_id, platform, protocol_device_id, last_active_at) VALUES (?, ?, ?, ?, ?)',
  ).run(secondInstall, id, 'web', 2, Date.now())
  db.query(
    'INSERT INTO relay_identities (user_id, device_id, install_id, x25519_public_key, registration_id, ed25519_public_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, 2, secondInstall, 'opaque-identity', 2, 'web', 1)
  expect((await call('send-message', { ...send, clientId: crypto.randomUUID() })).status).toBe(400)
  expect(
    (
      await call('send-message', {
        ...send,
        clientId: crypto.randomUUID(),
        envelopes: [{ targetUserId: id, targetDeviceId: 2, ciphertext: 'opaque-encrypted-note' }],
      })
    ).status,
  ).toBe(200)
  const unauth = await app.handle(
    new Request(
      `http://localhost/api/get-messages?conversationId=${room.id}&installId=${installId}`,
    ),
  )
  expect(unauth.status).toBe(401)
  db.query('UPDATE users SET auth_version = auth_version + 1 WHERE id = ?').run(id)
  await expect(
    sendMessage(
      {
        ...send,
        clientId: crypto.randomUUID(),
        envelopes: [{ targetUserId: id, targetDeviceId: 2, ciphertext: 'stale-request' }],
      },
      { id, username, authVersion: 0 },
      getDbInstance(),
      async () => {},
    ),
  ).rejects.toThrow('Password changed')
})
