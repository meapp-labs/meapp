import { beforeAll, expect, test } from 'bun:test'
import { getDbInstance, runMigrations } from '@meapp/db'
import { app } from '../index.ts'
import { resetInMemoryRateLimits } from '../plugins/rateLimit.ts'

beforeAll(() => runMigrations())
test('full groups reject direct adds without adding a member or message', async () => {
  resetInMemoryRateLimits()
  const db = getDbInstance().sqlite
  const suffix = crypto.randomUUID().slice(0, 8)
  const username = `capacity_${suffix}`
  const outsider = crypto.randomUUID()
  const roomId = crypto.randomUUID()
  const call = (path: string, body: unknown, cookie = '') =>
    app.handle(
      new Request(`http://localhost/api/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, 'x-forwarded-for': suffix },
        body: JSON.stringify(body),
      }),
    )
  expect(
    (await call('register', { username, password: 'secret123', confirmPassword: 'secret123' }))
      .status,
  ).toBe(201)
  const login = await call('login', { username, password: 'secret123' })
  const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? ''
  const admin = db.query('SELECT id FROM users WHERE username=?').get(username) as { id: string }
  db.query('INSERT INTO rooms (id,name,type,created_by,created_at) VALUES (?,?,?,?,?)').run(
    roomId,
    'Full group',
    'group',
    admin.id,
    1,
  )
  db.query('INSERT INTO room_members (room_id,user_id,role,joined_at) VALUES (?,?,?,?)').run(
    roomId,
    admin.id,
    'admin',
    1,
  )
  for (let i = 0; i < 99; i++) {
    const id = crypto.randomUUID()
    db.query('INSERT INTO users (id,username,password_hash,created_at) VALUES (?,?,?,?)').run(
      id,
      `cap_${suffix}_${i}`,
      'unused',
      1,
    )
    db.query('INSERT INTO room_members (room_id,user_id,role,joined_at) VALUES (?,?,?,?)').run(
      roomId,
      id,
      'member',
      1,
    )
  }
  db.query('INSERT INTO users (id,username,password_hash,created_at) VALUES (?,?,?,?)').run(
    outsider,
    `out_${suffix}`,
    'unused',
    1,
  )
  expect(
    (await call(`rooms/${roomId}/members`, { username: `out_${suffix}` }, cookie)).status,
  ).toBe(400)
  expect(
    (db.query('SELECT COUNT(*) AS n FROM messages WHERE room_id=?').get(roomId) as { n: number }).n,
  ).toBe(0)
  expect(
    (
      db.query('SELECT COUNT(*) AS n FROM room_members WHERE room_id=?').get(roomId) as {
        n: number
      }
    ).n,
  ).toBe(100)
})
