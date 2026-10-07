import { createHash, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getDbInstance } from '@meapp/db'
import {
  RECOVERY_MAX_BYTES,
  RECOVERY_MAX_UPLOADS,
  RECOVERY_STAGE_TTL_MS,
  recoveryBackupSchema,
  recoveryChunkSchema,
  recoveryClaimSchema,
  recoveryCommitSchema,
  recoveryStatusSchema,
  recoveryUploadSchema,
} from '@meapp/shared'
import { Elysia } from 'elysia'
import { env, isE2EEnabled } from '../lib/config.ts'
import { writeDurableJson } from '../lib/durableFile.ts'
import { createAuthError, createNotFoundError, createValidationError } from '../lib/errors.ts'
import { requireUser } from '../lib/session.ts'
import { authPlugin } from '../plugins/auth.ts'
import { clearDeviceLinkSessionsForUser } from './deviceLink.ts'

type Transfer = {
  oldInstallId: string
  newInstallId: string
  protocolDeviceId: number
  identityHash: string
}
type SavedBackup = {
  version: 1
  ownerInstallId: string
  proofHash: string
  iv: string
  ciphertext: string
  updatedAt: number
  pendingTransfer?: Transfer
  ownerIdentityHash?: string
}
type Manifest = {
  ownerInstallId: string
  proofHash: string
  iv: string
  total: number
  createdAt?: number
}
const locks = new Map<string, Promise<unknown>>()
async function locked<T>(userId: string, work: () => Promise<T>): Promise<T> {
  const previous = locks.get(userId) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(work)
  locks.set(userId, current)
  try {
    return await current
  } finally {
    if (locks.get(userId) === current) locks.delete(userId)
  }
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
function linkedDevice(userId: string, installId: string): number | null {
  const linked = getDbInstance()
    .sqlite.query(`SELECT d.protocol_device_id AS id FROM devices d
    JOIN relay_identities r ON r.user_id=d.user_id AND r.device_id=d.protocol_device_id AND r.install_id=d.device_id
    WHERE d.user_id=? AND d.device_id=?`)
    .get(userId, installId) as { id: number } | null
  return linked?.id ?? null
}
function identityHash(userId: string, installId: string): string | null {
  const identity = getDbInstance()
    .sqlite.query(
      'SELECT registration_id, x25519_public_key, ed25519_public_key, created_at FROM relay_identities WHERE user_id=? AND install_id=?',
    )
    .get(userId, installId)
  return identity ? createHash('sha256').update(JSON.stringify(identity)).digest('hex') : null
}
function requireLinked(userId: string, installId: string): void {
  if (linkedDevice(userId, installId) === null) throw createAuthError('This device is not linked')
}
async function requireBackupOwner(userId: string, installId: string): Promise<void> {
  requireLinked(userId, installId)
  const previous = await readBackup(userId)
  if (previous?.pendingTransfer) throw createValidationError('Complete the pending recovery first')
  if (previous && previous.ownerInstallId !== installId)
    throw createAuthError('Only the device that created the recovery key can update it')
  if (previous?.ownerIdentityHash && identityHash(userId, installId) !== previous.ownerIdentityHash)
    throw createAuthError('Backup owner was replaced')
}
async function saveBackup(userId: string, backup: SavedBackup): Promise<void> {
  await writeDurableJson(backupPath(userId), backup)
}
async function stages(userId: string): Promise<string[]> {
  const directory = dirname(backupPath(userId))
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    },
  )
  const active: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(`${userId}-`)) continue
    const path = join(directory, entry.name)
    const raw = await readFile(join(path, 'manifest.json'), 'utf8').catch(() => null)
    let createdAt = (await stat(path)).birthtimeMs
    try {
      const manifest = JSON.parse(raw ?? '{}') as Manifest
      if (Number.isFinite(manifest.createdAt)) createdAt = manifest.createdAt as number
    } catch {}
    if (createdAt + RECOVERY_STAGE_TTL_MS <= Date.now())
      await rm(path, { recursive: true, force: true })
    else active.push(path)
  }
  return active
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
  .get('/status', ({ user }) => {
    const me = requireUser(user)
    return locked(me.id, async () => {
      await stages(me.id)
      const backup = await readBackup(me.id)
      return recoveryStatusSchema.parse({
        available: Boolean(backup),
        restorable: Boolean(
          backup &&
            ((linkedDevice(me.id, backup.ownerInstallId) !== null &&
              (!backup.ownerIdentityHash ||
                identityHash(me.id, backup.ownerInstallId) === backup.ownerIdentityHash)) ||
              (backup.pendingTransfer &&
                linkedDevice(me.id, backup.pendingTransfer.newInstallId) ===
                  backup.pendingTransfer.protocolDeviceId &&
                identityHash(me.id, backup.pendingTransfer.newInstallId) ===
                  backup.pendingTransfer.identityHash)),
        ),
        updatedAt: backup?.updatedAt ?? null,
        ownerInstallId: backup?.ownerInstallId ?? null,
        size: backup?.ciphertext.length ?? 0,
        maxBytes: RECOVERY_MAX_BYTES,
        uploadExpiresAfterMs: RECOVERY_STAGE_TTL_MS,
      })
    })
  })
  .get('/backup', ({ user }) => {
    const me = requireUser(user)
    return locked(me.id, async () => {
      const backup = await readBackup(me.id)
      if (!backup) throw createNotFoundError('Recovery backup')
      return { version: backup.version, iv: backup.iv, ciphertext: backup.ciphertext }
    })
  })
  .post(
    '/backup',
    ({ user, body }) => {
      const me = requireUser(user)
      return locked(me.id, async () => {
        await requireBackupOwner(me.id, body.installId)
        const saved: SavedBackup = {
          version: 1,
          ownerInstallId: body.installId,
          ownerIdentityHash: identityHash(me.id, body.installId) as string,
          proofHash: body.proofHash,
          iv: body.iv,
          ciphertext: body.ciphertext,
          updatedAt: Date.now(),
        }
        requireLinked(me.id, body.installId)
        await saveBackup(me.id, saved)
        return { updatedAt: saved.updatedAt }
      })
    },
    {
      body: recoveryUploadSchema,
    },
  )
  .post(
    '/backup/chunk',
    ({ user, body }) => {
      const me = requireUser(user)
      return locked(me.id, async () => {
        await requireBackupOwner(me.id, body.installId)
        if (body.index >= body.total) throw createValidationError('Invalid backup chunk number')
        const directory = stagePath(me.id, body.uploadId)
        const active = await stages(me.id)
        if (!active.includes(directory) && active.length >= RECOVERY_MAX_UPLOADS)
          throw createValidationError('Too many unfinished recovery uploads; retry after one hour')
        const manifest: Manifest = {
          ownerInstallId: body.installId,
          proofHash: body.proofHash,
          iv: body.iv,
          total: body.total,
        }
        const existing = await readFile(join(directory, 'manifest.json'), 'utf8').catch(() => null)
        if (existing) {
          const prior = JSON.parse(existing) as Manifest
          if (
            prior.ownerInstallId !== manifest.ownerInstallId ||
            prior.proofHash !== manifest.proofHash ||
            prior.iv !== manifest.iv ||
            prior.total !== manifest.total
          )
            throw createValidationError('Backup upload changed')
        }
        if (!existing && body.index !== 0)
          throw createValidationError('Start with the first backup chunk')
        await mkdir(directory, { recursive: true, mode: 0o700 })
        if (!existing)
          await writeFile(
            join(directory, 'manifest.json'),
            JSON.stringify({ ...manifest, createdAt: Date.now() }),
            {
              mode: 0o600,
            },
          )
        const path = join(directory, String(body.index))
        const priorChunk = await readFile(path, 'utf8').catch(() => null)
        if (priorChunk !== null && priorChunk !== body.chunk)
          throw createValidationError('Backup chunk changed on retry')
        const temporary = `${path}.tmp`
        await writeFile(temporary, body.chunk, { mode: 0o600 })
        await rename(temporary, path)
        return { uploaded: body.index }
      })
    },
    {
      body: recoveryChunkSchema,
    },
  )
  .post(
    '/backup/commit',
    ({ user, body }) => {
      const me = requireUser(user)
      return locked(me.id, async () => {
        await stages(me.id)
        const directory = stagePath(me.id, body.uploadId)
        const raw = await readFile(join(directory, 'manifest.json'), 'utf8').catch(() => null)
        if (!raw) throw createNotFoundError('Recovery upload')
        const manifest = JSON.parse(raw) as Manifest
        await requireBackupOwner(me.id, manifest.ownerInstallId)
        const chunks: string[] = []
        for (let index = 0; index < manifest.total; index++) {
          const chunk = await readFile(join(directory, String(index)), 'utf8').catch(() => null)
          if (!chunk) throw createValidationError('Recovery upload is incomplete')
          chunks.push(chunk)
        }
        const ciphertext = chunks.join('')
        if (ciphertext.length > RECOVERY_MAX_BYTES)
          throw createValidationError('Recovery backup is too large')
        if (!recoveryBackupSchema.safeParse({ version: 1, iv: manifest.iv, ciphertext }).success)
          throw createValidationError('Invalid encrypted recovery backup')
        const saved: SavedBackup = {
          version: 1,
          ownerInstallId: manifest.ownerInstallId,
          ownerIdentityHash: identityHash(me.id, manifest.ownerInstallId) as string,
          proofHash: manifest.proofHash,
          iv: manifest.iv,
          ciphertext,
          updatedAt: Date.now(),
        }
        requireLinked(me.id, manifest.ownerInstallId)
        await saveBackup(me.id, saved)
        await rm(directory, { recursive: true, force: true })
        return { updatedAt: saved.updatedAt }
      })
    },
    { body: recoveryCommitSchema },
  )
  .post(
    '/claim',
    ({ user, body }) => {
      const me = requireUser(user)
      return locked(me.id, async () => {
        const backup = await readBackup(me.id)
        if (!backup) throw createNotFoundError('Recovery backup')
        const expected = Buffer.from(backup.proofHash, 'hex')
        const actual = Buffer.from(hashProof(body.proof), 'hex')
        if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
          throw createAuthError('Invalid recovery key')
        if (body.oldInstallId === body.newInstallId)
          throw createValidationError('Choose a new browser installation')
        if (backup.ownerInstallId === body.newInstallId && !backup.pendingTransfer) {
          requireLinked(me.id, body.newInstallId)
          if (
            backup.ownerIdentityHash &&
            identityHash(me.id, body.newInstallId) !== backup.ownerIdentityHash
          )
            throw createAuthError('Recovered device was replaced')
          return { recovered: true }
        }
        if (backup.ownerInstallId !== body.oldInstallId)
          throw createValidationError('Recovery backup does not match this device')
        if (
          backup.pendingTransfer &&
          (backup.pendingTransfer.oldInstallId !== body.oldInstallId ||
            backup.pendingTransfer.newInstallId !== body.newInstallId)
        )
          throw createValidationError('Another recovery is already pending')
        const sqlite = getDbInstance().sqlite
        if (!backup.pendingTransfer) {
          const id = linkedDevice(me.id, body.oldInstallId)
          if (id === null) throw createNotFoundError('Original linked device')
          if (
            backup.ownerIdentityHash &&
            identityHash(me.id, body.oldInstallId) !== backup.ownerIdentityHash
          )
            throw createAuthError('Backup owner was replaced')
          if (
            sqlite
              .query('SELECT 1 FROM devices WHERE user_id=? AND device_id=?')
              .get(me.id, body.newInstallId)
          )
            throw createValidationError('This browser is already linked')
          backup.pendingTransfer = {
            oldInstallId: body.oldInstallId,
            newInstallId: body.newInstallId,
            protocolDeviceId: id,
            identityHash: identityHash(me.id, body.oldInstallId) as string,
          }
          // Durable journal makes a crash between SQLite and file replacement retryable.
          await saveBackup(me.id, backup)
        }
        const transfer = backup.pendingTransfer
        // NORMAL WAL commits may disappear on power loss. The transfer must
        // reach disk before publishing the completed ownership journal.
        const synchronous = (sqlite.query('PRAGMA synchronous').get() as { synchronous: number })
          .synchronous
        sqlite.exec('PRAGMA synchronous = FULL')
        try {
          sqlite
            .transaction(() => {
              const current = linkedDevice(me.id, body.oldInstallId)
              if (current === transfer.protocolDeviceId) {
                if (identityHash(me.id, body.oldInstallId) !== transfer.identityHash)
                  throw createAuthError('Original device was replaced')
                if (
                  sqlite
                    .query('SELECT 1 FROM devices WHERE user_id=? AND device_id=?')
                    .get(me.id, body.newInstallId)
                )
                  throw createValidationError('This browser is already linked')
                sqlite
                  .query('UPDATE devices SET device_id=? WHERE user_id=? AND device_id=?')
                  .run(body.newInstallId, me.id, body.oldInstallId)
                sqlite
                  .query(
                    'UPDATE relay_identities SET install_id=? WHERE user_id=? AND install_id=?',
                  )
                  .run(body.newInstallId, me.id, body.oldInstallId)
                sqlite
                  .query('DELETE FROM relay_prekeys WHERE user_id=? AND device_id=?')
                  .run(me.id, transfer.protocolDeviceId)
              } else if (
                current !== null ||
                linkedDevice(me.id, body.newInstallId) !== transfer.protocolDeviceId ||
                identityHash(me.id, body.newInstallId) !== transfer.identityHash
              ) {
                throw createNotFoundError('Original linked device')
              }
            })
            .immediate()
        } finally {
          sqlite.exec(`PRAGMA synchronous = ${synchronous}`)
        }
        clearDeviceLinkSessionsForUser(me.id)
        backup.ownerInstallId = body.newInstallId
        backup.ownerIdentityHash = transfer.identityHash
        const { pendingTransfer: _pendingTransfer, ...completed } = backup
        await saveBackup(me.id, completed)
        return { recovered: true }
      })
    },
    {
      body: recoveryClaimSchema,
    },
  )
