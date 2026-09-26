import { afterAll, beforeAll, expect, it } from 'bun:test'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getDbInstance, runMigrations } from '@meapp/db'

import { app } from '../index.ts'

const username = `recovery_${randomUUID().slice(0, 8)}`
const password = 'secret123'
const installId = randomUUID()
const replacementId = randomUUID()
const proof = randomBytes(32).toString('base64url')
let userId = ''
let cookie = ''

async function call(path: string, body?: unknown, auth = true): Promise<Response> {
  return app.handle(
    new Request(`http://localhost/api/e2e/recovery/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': `recovery-test-${username}`,
        ...(auth ? { cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  )
}

beforeAll(async () => {
  process.env.E2E_ENABLED = 'true'
  runMigrations()
  const register = await app.handle(
    new Request('http://localhost/api/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': username },
      body: JSON.stringify({ username, password, confirmPassword: password, platform: 'web' }),
    }),
  )
  expect(register.status).toBe(201)
  const login = await app.handle(
    new Request('http://localhost/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': username },
      body: JSON.stringify({ username, password, platform: 'web' }),
    }),
  )
  cookie = login.headers.get('set-cookie')?.split(';')[0] ?? ''
  userId = (
    getDbInstance().sqlite.query('SELECT id FROM users WHERE username = ?').get(username) as {
      id: string
    }
  ).id
  const sqlite = getDbInstance().sqlite
  sqlite
    .query(
      'INSERT INTO devices (user_id, device_id, protocol_device_id, platform) VALUES (?, ?, 1, ?)',
    )
    .run(userId, installId, 'web')
  sqlite
    .query(
      'INSERT INTO relay_identities (user_id, device_id, install_id, registration_id, x25519_public_key, ed25519_public_key, created_at) VALUES (?, 1, ?, 1, ?, ?, ?)',
    )
    .run(userId, installId, 'public', 'public', Date.now())
})

afterAll(async () => {
  const databasePath = process.env.DATABASE_URL ?? './data/data.db'
  await rm(join(dirname(databasePath), 'recovery', `${userId}.json`), { force: true })
  getDbInstance().sqlite.query('DELETE FROM users WHERE id = ?').run(userId)
})

it('protects and transfers an encrypted recovery backup to a replacement browser', async () => {
  const payload = {
    installId,
    proofHash: createHash('sha256').update(proof).digest('hex'),
    iv: randomBytes(12).toString('base64'),
    ciphertext: randomBytes(96).toString('base64'),
  }
  expect((await call('status', undefined, false)).status).toBe(401)
  expect((await call('backup', payload, false)).status).toBe(401)
  expect((await call('backup', { ...payload, installId: randomUUID() })).status).toBe(401)
  const uploadId = randomUUID()
  const longCiphertext = randomBytes(200_000).toString('base64')
  const chunks = [longCiphertext.slice(0, 150_000), longCiphertext.slice(150_000)]
  for (let index = 0; index < chunks.length; index++) {
    const response = await call('backup/chunk', {
      installId,
      uploadId,
      proofHash: payload.proofHash,
      iv: payload.iv,
      index,
      total: chunks.length,
      chunk: chunks[index],
    })
    expect(response.status).toBe(200)
  }
  expect((await call('backup/commit', { uploadId })).status).toBe(200)
  expect(await (await call('status')).json()).toEqual({
    available: true,
    updatedAt: expect.any(Number),
  })
  expect(await (await call('backup')).json()).toEqual({
    version: 1,
    iv: payload.iv,
    ciphertext: longCiphertext,
  })
  expect(
    (
      await call('claim', {
        oldInstallId: installId,
        newInstallId: replacementId,
        proof: randomBytes(32).toString('base64url'),
      })
    ).status,
  ).toBe(401)
  expect(
    (await call('claim', { oldInstallId: installId, newInstallId: replacementId, proof })).status,
  ).toBe(200)
  const sqlite = getDbInstance().sqlite
  expect(
    sqlite
      .query('SELECT 1 FROM devices WHERE user_id = ? AND device_id = ?')
      .get(userId, replacementId),
  ).toBeTruthy()
  expect(
    sqlite
      .query('SELECT 1 FROM relay_identities WHERE user_id = ? AND install_id = ?')
      .get(userId, replacementId),
  ).toBeTruthy()
  expect(
    (await call('claim', { oldInstallId: installId, newInstallId: replacementId, proof })).status,
  ).toBe(200)
})
