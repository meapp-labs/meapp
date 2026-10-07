import { expect, it } from 'bun:test'
import { resolve } from 'node:path'
import { IdempotencyConflictError, createDb, insertMessageWithSequence } from '@meapp/db'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { sendMessage } from './services/sendMessage.ts'

it('reordered attachments retry legacy unsorted rows and atomic mutations roll back on failure', async () => {
  const instance = createDb(':memory:')
  const { sqlite } = instance
  try {
    migrate(instance.db, {
      migrationsFolder: resolve(import.meta.dir, '../../../../packages/db/drizzle-current'),
    })
    const userId = crypto.randomUUID()
    const roomId = crypto.randomUUID()
    sqlite
      .query('INSERT INTO users (id,username,password_hash,created_at) VALUES (?,?,?,?)')
      .run(userId, 'test', 'unused', 1)
    sqlite
      .query('INSERT INTO rooms (id,name,type,created_by,created_at) VALUES (?,?,?,?,?)')
      .run(roomId, 'test', 'group', userId, 1)
    const opts = {
      roomId,
      userId,
      clientId: crypto.randomUUID(),
      text: 'Hello',
      attachmentIds: ['z', 'a'],
    }
    const original = await insertMessageWithSequence(sqlite, opts)
    sqlite.query('UPDATE messages SET attachment_ids=? WHERE id=?').run('["z","a"]', original.id)
    const retry = await insertMessageWithSequence(sqlite, { ...opts, attachmentIds: ['a', 'z'] })
    expect(retry).toEqual({ ...original, created: false })
    await expect(
      insertMessageWithSequence(sqlite, { ...opts, attachmentIds: ['other'] }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError)
    await expect(
      insertMessageWithSequence(sqlite, {
        ...opts,
        clientId: crypto.randomUUID(),
        mutation: () => {
          sqlite.query('UPDATE rooms SET name=? WHERE id=?').run('changed', roomId)
          throw new Error('fail')
        },
      }),
    ).rejects.toThrow('fail')
    expect(sqlite.query('SELECT name FROM rooms WHERE id=?').get(roomId)).toEqual({ name: 'test' })
    expect(sqlite.query('SELECT COUNT(*) AS total FROM messages').get()).toEqual({ total: 1 })
    const next = await insertMessageWithSequence(sqlite, { ...opts, clientId: crypto.randomUUID() })
    expect(next.sequence).toBe(2)
  } finally {
    sqlite.close()
  }
})

it('the send service uses its injected database and broadcasts only once across retries', async () => {
  const instance = createDb(':memory:')
  const previous = process.env.E2E_ENABLED
  process.env.E2E_ENABLED = 'false'
  try {
    migrate(instance.db, {
      migrationsFolder: resolve(import.meta.dir, '../../../../packages/db/drizzle-current'),
    })
    const userId = crypto.randomUUID()
    const roomId = crypto.randomUUID()
    instance.sqlite
      .query('INSERT INTO users (id,username,password_hash,created_at) VALUES (?,?,?,?)')
      .run(userId, 'isolated', 'unused', 1)
    instance.sqlite
      .query('INSERT INTO rooms (id,name,type,created_by,created_at) VALUES (?,?,?,?,?)')
      .run(roomId, 'test', 'group', userId, 1)
    instance.sqlite
      .query('INSERT INTO room_members (room_id,user_id,role,joined_at) VALUES (?,?,?,?)')
      .run(roomId, userId, 'admin', 1)
    const events: string[] = []
    const broadcast = async (_roomId: string, event: string) => {
      events.push(event)
    }
    const input = { conversationId: roomId, text: 'Hello', clientId: crypto.randomUUID() }
    const sender = { id: userId, username: 'isolated' }
    const first = await sendMessage(input, sender, instance, broadcast)
    expect(await sendMessage(input, sender, instance, broadcast)).toEqual(first)
    expect(events).toHaveLength(1)
    expect(JSON.parse(events[0] ?? '').payload).toEqual(first)
  } finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, 'E2E_ENABLED')
    else process.env.E2E_ENABLED = previous
    instance.sqlite.close()
  }
})
