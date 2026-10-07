import { beforeAll, expect, test } from 'bun:test'
import { getDbInstance, runMigrations } from '@meapp/db'
import { ACCOUNT_PROOF_TTL_MS } from '@meapp/shared'
import { Elysia } from 'elysia'
import { app } from '../index'
import { chatWs, revokeAccountSockets } from '../ws/chat'
import { AccountRecoveryService, type RecoveryMailDelivery } from './accountRecovery'
import { makePasswordHash, verifyPassword } from './passwords'

beforeAll(() => runMigrations())
async function fixture() {
  const db = getDbInstance().sqlite
  const id = crypto.randomUUID()
  const username = `recover_${id.slice(0, 8)}`
  const email = `${id}@example.com`
  db.query('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    id,
    username,
    await makePasswordHash('old-secret-123'),
    Math.floor(Date.now() / 1000),
  )
  const sent: { email: string; token: string; purpose: 'enroll' | 'reset' }[] = []
  const revoked: string[] = []
  let time = Date.now()
  const delivery: RecoveryMailDelivery = {
    enabled: true,
    async send(message) {
      sent.push(message)
    },
  }
  const service = new AccountRecoveryService(
    db,
    delivery,
    (userId) => {
      revoked.push(userId)
      revokeAccountSockets(userId)
    },
    () => time,
  )
  return {
    db,
    id,
    username,
    email,
    sent,
    revoked,
    service,
    advance: () => {
      time += ACCOUNT_PROOF_TTL_MS
    },
  }
}

test('verified enrollment, uniform reset requests, single-use reset and login-token revocation', async () => {
  const f = await fixture()
  const login = await app.handle(
    new Request('http://localhost/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: f.username, password: 'old-secret-123', platform: 'web' }),
    }),
  )
  expect(login.status).toBe(200)
  const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? ''
  const me = () => app.handle(new Request('http://localhost/api/me', { headers: { cookie } }))
  expect((await me()).status).toBe(200)
  await expect(f.service.enroll(f.id, f.email, 'incorrect', f.id)).rejects.toThrow('incorrect')
  await f.service.enroll(f.id, f.email, 'old-secret-123', f.id)
  const enroll = f.sent.at(-1)?.token ?? ''
  expect(
    JSON.stringify(f.db.query('SELECT * FROM account_recovery_proofs WHERE user_id = ?').all(f.id)),
  ).not.toContain(enroll)
  expect(f.service.status(f.id).verified).toBe(false)
  f.service.verifyEmail(enroll, f.id)
  expect(f.service.status(f.id)).toEqual({ enabled: true, email: f.email, verified: true })
  expect(() => f.service.verifyEmail(enroll, f.id)).toThrow('invalid or expired')
  const known = f.service.requestReset(f.email, f.id)
  const unknown = f.service.requestReset(`absent-${f.email}`, f.id)
  expect(unknown).toEqual(known)
  const reset = f.sent.at(-1)?.token ?? ''
  expect(() => f.service.verifyEmail(reset, f.id)).toThrow('invalid or expired')
  const results = await Promise.allSettled([
    f.service.resetPassword(reset, 'new-secret-456', f.id),
    f.service.resetPassword(reset, 'new-secret-456', f.id),
  ])
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  expect(f.revoked).toEqual([f.id])
  expect((await me()).status).toBe(401)
  const stored = f.db
    .query('SELECT password_hash, auth_version FROM users WHERE id = ?')
    .get(f.id) as { password_hash: string; auth_version: number }
  expect(stored.auth_version).toBe(1)
  expect(await verifyPassword('new-secret-456', stored.password_hash)).toBe(true)
  await expect(f.service.resetPassword(reset, 'another-secret', f.id)).rejects.toThrow(
    'invalid or expired',
  )
})

test('expired codes, email changes, unknown addresses and abuse limits', async () => {
  const f = await fixture()
  await f.service.enroll(f.id, f.email, 'old-secret-123', f.id)
  const expired = f.sent.at(-1)?.token ?? ''
  f.advance()
  expect(() => f.service.verifyEmail(expired, f.id)).toThrow('invalid or expired')
  await f.service.enroll(f.id, f.email, 'old-secret-123', f.id)
  f.service.verifyEmail(f.sent.at(-1)?.token ?? '', f.id)
  f.service.requestReset(f.email, f.id)
  const oldReset = f.sent.at(-1)?.token ?? ''
  const newEmail = `new-${f.email}`
  await f.service.enroll(f.id, newEmail, 'old-secret-123', f.id)
  expect(f.service.status(f.id).email).toBe(f.email)
  f.service.verifyEmail(f.sent.at(-1)?.token ?? '', f.id)
  await expect(f.service.resetPassword(oldReset, 'new-secret-456', f.id)).rejects.toThrow(
    'invalid or expired',
  )
  const before = f.sent.length
  f.service.requestReset(f.email, f.id)
  expect(f.sent).toHaveLength(before)
  for (let i = 0; i < 5; i++) f.service.requestReset(newEmail, f.id)
  expect(() => f.service.requestReset(newEmail, f.id)).toThrow('Too many')
})

test('disabled provider stays unavailable; failed delivery invalidates the code', async () => {
  const f = await fixture()
  const disabled = new AccountRecoveryService(f.db, { enabled: false, async send() {} })
  expect(() => disabled.requestReset(f.email, f.id)).toThrow('not configured')
  let token = ''
  const broken = new AccountRecoveryService(f.db, {
    enabled: true,
    async send(message) {
      token = message.token
      throw new Error('provider unavailable')
    },
  })
  await broken.enroll(f.id, f.email, 'old-secret-123', f.id)
  await Promise.resolve()
  expect(() => broken.verifyEmail(token, f.id)).toThrow('invalid or expired')
  const response = await app.handle(
    new Request('http://localhost/api/account-recovery/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: f.email }),
    }),
  )
  expect(response.status).toBe(503)
  expect(await response.json()).toMatchObject({
    message: expect.any(String),
    code: 'INTERNAL_SERVER_ERROR',
  })
})

test('password reset evicts a real socket and rejects a previously issued ticket', async () => {
  const f = await fixture()
  const roomId = crypto.randomUUID()
  f.db
    .query('INSERT INTO rooms (id, name, type, created_by, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(roomId, 'Recovery socket', 'group', f.id, 1)
  f.db
    .query('INSERT INTO room_members (room_id, user_id, joined_at) VALUES (?, ?, ?)')
    .run(roomId, f.id, 1)
  const login = await app.handle(
    new Request('http://localhost/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: f.username, password: 'old-secret-123', platform: 'web' }),
    }),
  )
  const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? ''
  const ticket = async () => {
    const response = await app.handle(
      new Request('http://localhost/ws/ticket', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ roomId }),
      }),
    )
    expect(response.status).toBe(200)
    return ((await response.json()) as { ticket: string }).ticket
  }
  const firstTicket = await ticket()
  const staleTicket = await ticket()
  const liveApp = new Elysia().use(chatWs).listen({ hostname: '127.0.0.1', port: 0 })
  const server = liveApp.server
  if (!server) throw new Error('Socket server unavailable')
  const sockets: WebSocket[] = []
  const connect = async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws?roomId=${roomId}`)
    sockets.push(ws)
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true })
      ws.addEventListener('error', () => reject(new Error('Socket connection failed')), {
        once: true,
      })
    })
    return ws
  }
  try {
    const ws = await connect()
    const authenticated = new Promise<void>((resolve, reject) => {
      ws.addEventListener('message', (event) => {
        const value = JSON.parse(String(event.data))
        if (value.type === 'authenticated') resolve()
        else if (value.type === 'error') reject(new Error(value.payload.message))
      })
    })
    ws.send(JSON.stringify({ type: 'auth', payload: { ticket: firstTicket } }))
    await authenticated
    await f.service.enroll(f.id, f.email, 'old-secret-123', f.id)
    f.service.verifyEmail(f.sent.at(-1)?.token ?? '', f.id)
    f.service.requestReset(f.email, f.id)
    const closed = new Promise<number>((resolve) =>
      ws.addEventListener('close', (event) => resolve(event.code), { once: true }),
    )
    await f.service.resetPassword(f.sent.at(-1)?.token ?? '', 'new-secret-456', f.id)
    expect(await closed).toBe(4401)
    const stale = await connect()
    const rejected = new Promise<number>((resolve) =>
      stale.addEventListener('close', (event) => resolve(event.code), { once: true }),
    )
    stale.send(JSON.stringify({ type: 'auth', payload: { ticket: staleTicket } }))
    expect(await rejected).toBe(4401)
  } finally {
    for (const ws of sockets) ws.close()
    server.stop(true)
  }
}, 10000)
