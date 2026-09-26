import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getDbInstance } from '@meapp/db'
import { Elysia, t } from 'elysia'

import { env, isE2EEnabled } from '../lib/config.ts'
import { createAuthError, createNotFoundError, createValidationError } from '../lib/errors.ts'
import { requireUser } from '../lib/session.ts'
import { authPlugin } from '../plugins/auth.ts'
import { clearDeviceLinkSessionsForUser } from './deviceLink.ts'

type SavedBackup = {
  version: 1
  ownerInstallId: string
  proofHash: string
  iv: string
  ciphertext: string
  updatedAt: number
}

const backupPath = (userId: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw createAuthError()
  return join(dirname(env.DATABASE_URL), 'recovery', `${userId}.json`)
}

const stagePath = (userId: string, uploadId: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(uploadId)) throw createValidationError('Invalid upload ID')
  return join(dirname(backupPath(userId)), `${userId}-${uploadId}`)
}

async function readBackup(userId: string): Promise<SavedBackup | null> {
  try {
    return JSON.parse(await readFile(backupPath(userId), 'utf8')) as SavedBackup
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

const hashProof = (proof: string) => createHash('sha256').update(proof).digest('hex')

function requireLinked(userId: string, installId: string): void {
  const linked = getDbInstance()
    .sqlite.query('SELECT 1 FROM relay_identities WHERE user_id = ? AND install_id = ?')
    .get(userId, installId)
  if (!linked) throw createAuthError('This device is not linked')
}

async function requireBackupOwner(userId: string, installId: string): Promise<void> {
  requireLinked(userId, installId)
  const previous = await readBackup(userId)
  if (previous && previous.ownerInstallId !== installId)
    throw createAuthError('Only the device that created the recovery key can update it')
}

async function saveBackup(userId: string, backup: SavedBackup): Promise<void> {
  const path = backupPath(userId)
  const temporary = `${path}.${randomUUID()}.tmp`
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(temporary, JSON.stringify(backup), { mode: 0o600 })
  await chmod(temporary, 0o600).catch(() => undefined)
  await rename(temporary, path)
}

export const recoveryRoutes = new Elysia({ prefix: '/api/e2e/recovery' })
  .use(authPlugin)
  .onBeforeHandle(({ set }) => {
    if (!isE2EEnabled()) {
      set.status = 404
      return { message: 'Not found', code: 'ITEM_NOT_FOUND' }
    }
    return undefined
  })
  .get('/status', async ({ user }) => {
    const me = requireUser(user)
    const backup = await readBackup(me.id)
    return { available: Boolean(backup), updatedAt: backup?.updatedAt ?? null }
  })
  .get('/backup', async ({ user }) => {
    const me = requireUser(user)
    const backup = await readBackup(me.id)
    if (!backup) throw createNotFoundError('Recovery backup')
    return { version: backup.version, iv: backup.iv, ciphertext: backup.ciphertext }
  })
  .post(
    '/backup',
    async ({ user, body }) => {
      const me = requireUser(user)
      await requireBackupOwner(me.id, body.installId)
      const saved: SavedBackup = {
        version: 1,
        ownerInstallId: body.installId,
        proofHash: body.proofHash,
        iv: body.iv,
        ciphertext: body.ciphertext,
        updatedAt: Date.now(),
      }
      await saveBackup(me.id, saved)
      return { updatedAt: saved.updatedAt }
    },
    {
      body: t.Object({
        installId: t.String({ format: 'uuid' }),
        proofHash: t.String({ pattern: '^[a-f0-9]{64}$' }),
        iv: t.String({ minLength: 16, maxLength: 32 }),
        ciphertext: t.String({ minLength: 32, maxLength: 650_000 }),
      }),
    },
  )
  .post(
    '/backup/chunk',
    async ({ user, body }) => {
      const me = requireUser(user)
      await requireBackupOwner(me.id, body.installId)
      if (body.index >= body.total) throw createValidationError('Invalid backup chunk number')
      const directory = stagePath(me.id, body.uploadId)
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const manifest = {
        ownerInstallId: body.installId,
        proofHash: body.proofHash,
        iv: body.iv,
        total: body.total,
      }
      if (body.index === 0) {
        await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 })
      } else {
        const existing = await readFile(join(directory, 'manifest.json'), 'utf8').catch(() => null)
        if (existing !== JSON.stringify(manifest))
          throw createValidationError('Backup upload changed')
      }
      await writeFile(join(directory, String(body.index)), body.chunk, { mode: 0o600 })
      return { uploaded: body.index }
    },
    {
      body: t.Object({
        installId: t.String({ format: 'uuid' }),
        uploadId: t.String({ format: 'uuid' }),
        proofHash: t.String({ pattern: '^[a-f0-9]{64}$' }),
        iv: t.String({ minLength: 16, maxLength: 32 }),
        index: t.Integer({ minimum: 0, maximum: 99 }),
        total: t.Integer({ minimum: 1, maximum: 100 }),
        chunk: t.String({ minLength: 1, maxLength: 500_000 }),
      }),
    },
  )
  .post(
    '/backup/commit',
    async ({ user, body }) => {
      const me = requireUser(user)
      const directory = stagePath(me.id, body.uploadId)
      const rawManifest = await readFile(join(directory, 'manifest.json'), 'utf8').catch(() => null)
      if (!rawManifest) throw createNotFoundError('Recovery upload')
      const manifest = JSON.parse(rawManifest) as {
        ownerInstallId: string
        proofHash: string
        iv: string
        total: number
      }
      await requireBackupOwner(me.id, manifest.ownerInstallId)
      const chunks: string[] = []
      for (let index = 0; index < manifest.total; index++) {
        const chunk = await readFile(join(directory, String(index)), 'utf8').catch(() => null)
        if (!chunk) throw createValidationError('Recovery upload is incomplete')
        chunks.push(chunk)
      }
      const ciphertext = chunks.join('')
      if (ciphertext.length > 50_000_000)
        throw createValidationError('Recovery backup is too large')
      const saved: SavedBackup = {
        version: 1,
        ownerInstallId: manifest.ownerInstallId,
        proofHash: manifest.proofHash,
        iv: manifest.iv,
        ciphertext,
        updatedAt: Date.now(),
      }
      await saveBackup(me.id, saved)
      await rm(directory, { recursive: true, force: true })
      return { updatedAt: saved.updatedAt }
    },
    { body: t.Object({ uploadId: t.String({ format: 'uuid' }) }) },
  )
  .post(
    '/claim',
    async ({ user, body }) => {
      const me = requireUser(user)
      const backup = await readBackup(me.id)
      if (!backup) throw createNotFoundError('Recovery backup')
      const expected = Buffer.from(backup.proofHash, 'hex')
      const actual = Buffer.from(hashProof(body.proof), 'hex')
      if (!timingSafeEqual(expected, actual)) throw createAuthError('Invalid recovery key')
      if (body.oldInstallId === body.newInstallId)
        throw createValidationError('Choose a new browser installation')
      if (backup.ownerInstallId === body.newInstallId) return { recovered: true }
      if (backup.ownerInstallId !== body.oldInstallId)
        throw createValidationError('Recovery backup does not match this device')
      const sqlite = getDbInstance().sqlite
      sqlite.transaction(() => {
        const current = sqlite
          .query('SELECT protocol_device_id FROM devices WHERE user_id = ? AND device_id = ?')
          .get(me.id, body.oldInstallId) as { protocol_device_id: number } | null
        const occupied = sqlite
          .query('SELECT 1 FROM devices WHERE user_id = ? AND device_id = ?')
          .get(me.id, body.newInstallId)
        if (current) {
          if (occupied) throw createValidationError('This browser is already linked')
          sqlite
            .query('UPDATE devices SET device_id = ? WHERE user_id = ? AND device_id = ?')
            .run(body.newInstallId, me.id, body.oldInstallId)
          sqlite
            .query(
              'UPDATE relay_identities SET install_id = ? WHERE user_id = ? AND install_id = ?',
            )
            .run(body.newInstallId, me.id, body.oldInstallId)
        } else if (!occupied) {
          throw createNotFoundError('Original linked device')
        }
      })()
      clearDeviceLinkSessionsForUser(me.id)
      backup.ownerInstallId = body.newInstallId
      const path = backupPath(me.id)
      const temporary = `${path}.${randomUUID()}.tmp`
      await writeFile(temporary, JSON.stringify(backup), { mode: 0o600 })
      await rename(temporary, path)
      return { recovered: true }
    },
    {
      body: t.Object({
        oldInstallId: t.String({ format: 'uuid' }),
        newInstallId: t.String({ format: 'uuid' }),
        proof: t.String({ pattern: '^[A-Za-z0-9_-]{43}$' }),
      }),
    },
  )
