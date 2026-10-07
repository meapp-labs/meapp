import { afterAll, beforeAll, expect, it } from 'bun:test'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFile, rm, stat, writeFile } from 'node:fs/promises'
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
  expect(await (await call('status')).json()).toMatchObject({
    available: true,
    updatedAt: expect.any(Number),
    ownerInstallId: installId,
    maxBytes: 50_000_000,
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

async function resetOriginal() {
  const sqlite = getDbInstance().sqlite
  sqlite.query('DELETE FROM relay_identities WHERE user_id=?').run(userId)
  sqlite.query('DELETE FROM devices WHERE user_id=?').run(userId)
  sqlite
    .query('INSERT INTO devices (user_id,device_id,protocol_device_id,platform) VALUES (?,?,1,?)')
    .run(userId, installId, 'web')
  sqlite
    .query(
      'INSERT INTO relay_identities (user_id,device_id,install_id,registration_id,x25519_public_key,ed25519_public_key,created_at) VALUES (?,1,?,1,?,?,?)',
    )
    .run(userId, installId, 'public', 'public', Date.now())
  await rm(
    join(dirname(process.env.DATABASE_URL ?? './data/data.db'), 'recovery', `${userId}.json`),
    { force: true },
  )
  expect(
    (
      await call('backup', {
        installId,
        proofHash: createHash('sha256').update(proof).digest('hex'),
        iv: randomBytes(12).toString('base64'),
        ciphertext: 'A'.repeat(100),
      })
    ).status,
  ).toBe(200)
}

it('an incomplete or changed upload leaves the committed backup intact', async () => {
  await resetOriginal()
  const original = await (await call('backup')).json()
  const uploadId = randomUUID()
  const chunk = {
    installId,
    uploadId,
    proofHash: createHash('sha256').update(proof).digest('hex'),
    iv: randomBytes(12).toString('base64'),
    index: 0,
    total: 2,
    chunk: 'B'.repeat(32),
  }
  expect((await call('backup/chunk', chunk)).status).toBe(200)
  expect((await call('backup/chunk', { ...chunk, chunk: 'C'.repeat(32) })).status).toBe(400)
  expect((await call('backup/chunk', { ...chunk, total: 1 })).status).toBe(400)
  expect((await call('backup/commit', { uploadId })).status).toBe(400)
  expect(await (await call('backup')).json()).toEqual(original)
  expect((await call('backup/chunk', { ...chunk, index: 1 })).status).toBe(200)
  expect((await call('backup/commit', { uploadId })).status).toBe(200)
})

it('bounds unfinished uploads and expires them without losing the committed backup', async () => {
  await resetOriginal()
  const uploads = Array.from({ length: 4 }, () => randomUUID())
  const chunk = {
    installId,
    proofHash: createHash('sha256').update(proof).digest('hex'),
    iv: randomBytes(12).toString('base64'),
    index: 0,
    total: 1,
    chunk: 'A'.repeat(32),
  }
  for (const uploadId of uploads.slice(0, 3))
    expect((await call('backup/chunk', { ...chunk, uploadId })).status).toBe(200)
  expect((await call('backup/chunk', { ...chunk, uploadId: uploads[3] })).status).toBe(400)
  const directory = join(
    dirname(process.env.DATABASE_URL ?? './data/data.db'),
    'recovery',
    `${userId}-${uploads[0]}`,
  )
  const path = join(directory, 'manifest.json')
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  await writeFile(path, JSON.stringify({ ...manifest, createdAt: Date.now() - 3_600_001 }))
  expect((await call('status')).status).toBe(200)
  await expect(stat(directory)).rejects.toMatchObject({ code: 'ENOENT' })
  expect((await call('backup/commit', { uploadId: uploads[0] })).status).toBe(404)
  expect((await call('backup/chunk', { ...chunk, uploadId: uploads[3] })).status).toBe(200)
  for (const uploadId of uploads.slice(1))
    expect((await call('backup/commit', { uploadId })).status).toBe(200)
})

it('rejects an unrelated occupied destination when the original device was revoked', async () => {
  await resetOriginal()
  const sqlite = getDbInstance().sqlite
  sqlite.query('DELETE FROM relay_identities WHERE user_id=?').run(userId)
  sqlite.query('DELETE FROM devices WHERE user_id=?').run(userId)
  sqlite
    .query('INSERT INTO devices (user_id,device_id,protocol_device_id,platform) VALUES (?,?,2,?)')
    .run(userId, replacementId, 'web')
  expect(
    (await call('claim', { oldInstallId: installId, newInstallId: replacementId, proof })).status,
  ).toBe(404)
})

it('serializes competing claims and rejects a retry after revocation', async () => {
  await resetOriginal()
  const alternative = randomUUID()
  const claims = await Promise.all(
    [replacementId, alternative].map((newInstallId) =>
      call('claim', { oldInstallId: installId, newInstallId, proof }),
    ),
  )
  expect(claims.map((result) => result.status).sort()).toEqual([200, 400])
  const winner = claims[0]?.status === 200 ? replacementId : alternative
  expect(
    (
      await call('backup', {
        installId,
        proofHash: createHash('sha256').update(proof).digest('hex'),
        iv: randomBytes(12).toString('base64'),
        ciphertext: 'A'.repeat(100),
      })
    ).status,
  ).toBe(401)
  getDbInstance()
    .sqlite.query('DELETE FROM devices WHERE user_id=? AND device_id=?')
    .run(userId, winner)
  expect(
    (await call('claim', { oldInstallId: installId, newInstallId: winner, proof })).status,
  ).toBe(401)
})

it('resumes the exact persisted transfer after a crash following the SQLite commit', async () => {
  await resetOriginal()
  const sqlite = getDbInstance().sqlite
  const path = join(
    dirname(process.env.DATABASE_URL ?? './data/data.db'),
    'recovery',
    `${userId}.json`,
  )
  const backup = JSON.parse(await readFile(path, 'utf8'))
  const identity = sqlite
    .query(
      'SELECT registration_id, x25519_public_key, ed25519_public_key, created_at FROM relay_identities WHERE user_id=? AND install_id=?',
    )
    .get(userId, installId)
  backup.pendingTransfer = {
    oldInstallId: installId,
    newInstallId: replacementId,
    protocolDeviceId: 1,
    identityHash: createHash('sha256').update(JSON.stringify(identity)).digest('hex'),
  }
  await writeFile(path, JSON.stringify(backup))
  sqlite
    .query('UPDATE devices SET device_id=? WHERE user_id=? AND device_id=?')
    .run(replacementId, userId, installId)
  sqlite
    .query('UPDATE relay_identities SET install_id=? WHERE user_id=? AND install_id=?')
    .run(replacementId, userId, installId)
  expect(
    (await call('claim', { oldInstallId: installId, newInstallId: replacementId, proof })).status,
  ).toBe(200)
  expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ ownerInstallId: replacementId })
  expect(JSON.parse(await readFile(path, 'utf8')).pendingTransfer).toBeUndefined()
})

it('uses durable SQLite commits for ownership transfer and restores the connection policy', async () => {
  await resetOriginal()
  const sqlite = getDbInstance().sqlite
  const before = sqlite.query('PRAGMA synchronous').get()
  sqlite.exec(`CREATE TEMP TRIGGER require_durable_recovery BEFORE UPDATE OF device_id ON devices
    WHEN (SELECT synchronous FROM pragma_synchronous) != 2
    BEGIN SELECT RAISE(ABORT, 'Recovery commit must be durable'); END`)
  try {
    expect(
      (await call('claim', { oldInstallId: installId, newInstallId: replacementId, proof })).status,
    ).toBe(200)
    expect(sqlite.query('PRAGMA synchronous').get()).toEqual(before)
  } finally {
    sqlite.exec('DROP TRIGGER require_durable_recovery')
  }
})
