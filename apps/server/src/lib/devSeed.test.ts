import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createDecipheriv, createHash, scryptSync } from 'node:crypto'
import { getDbInstance, insertMessageWithSequence, runMigrations } from '@meapp/db'
import { app } from '../index.ts'
import { LOGIN_CONFIG, env } from './config.ts'
import { devSeedContent, seedDevData } from './devSeed.ts'

const originalEnv = { ...env }
beforeAll(async () => {
  env.MEDIA_STORAGE = 'r2'
  env.R2_ACCOUNT_ID = undefined
  runMigrations()
  await seedDevData()
})
afterAll(() => Object.assign(env, originalEnv))

describe('development fixtures', () => {
  it('creates usable accounts, mutual friends and populated chats without duplicates', async () => {
    const sqlite = getDbInstance().sqlite
    const users = sqlite
      .query(
        "SELECT id,username,password_hash AS passwordHash,avatar_url AS avatarUrl FROM users WHERE username IN ('emil1','emil2','emil3') ORDER BY username",
      )
      .all() as { id: string; username: string; passwordHash: string; avatarUrl: string }[]
    expect(users).toHaveLength(3)
    for (const user of users) {
      const [salt, hash] = user.passwordHash.split(':')
      expect(scryptSync('qwe', salt ?? '', LOGIN_CONFIG.SCRYPT_KEY_LENGTH).toString('hex')).toBe(
        hash ?? '',
      )
      const avatar = await app.handle(new Request(user.avatarUrl))
      expect(avatar.status).toBe(200)
      expect(avatar.headers.get('content-type')).toBe('image/webp')
      expect((await avatar.arrayBuffer()).byteLength).toBeGreaterThan(100)
      expect(
        sqlite.query('SELECT COUNT(*) AS n FROM contacts WHERE user_id=?').get(user.id),
      ).toEqual({ n: 2 })
    }
    expect(
      sqlite
        .query(
          "SELECT type,COUNT(*) AS n FROM rooms WHERE id IN (SELECT room_id FROM messages WHERE client_id LIKE 'meapp-dev-v1:%') GROUP BY type ORDER BY type",
        )
        .all(),
    ).toEqual([
      { type: 'dm', n: 3 },
      { type: 'group', n: 2 },
    ])
    const messagesBefore = sqlite
      .query("SELECT * FROM messages WHERE client_id LIKE 'meapp-dev-v1:%' ORDER BY id")
      .all()
    expect(messagesBefore).toHaveLength(35)
    const room = sqlite
      .query("SELECT room_id AS id FROM messages WHERE client_id LIKE 'meapp-dev-v1:%' LIMIT 1")
      .get() as { id: string }
    await insertMessageWithSequence(sqlite, {
      roomId: room.id,
      userId: users[0]?.id ?? '',
      clientId: crypto.randomUUID(),
      text: 'Keep my own message',
    })
    await seedDevData()
    expect(
      sqlite
        .query("SELECT COUNT(*) AS n FROM messages WHERE client_id LIKE 'meapp-dev-v1:%'")
        .get(),
    ).toEqual({ n: 35 })
    expect(
      sqlite.query("SELECT COUNT(*) AS n FROM messages WHERE text='Keep my own message'").get(),
    ).toEqual({ n: 1 })
    expect(
      sqlite
        .query("SELECT COUNT(*) AS n FROM users WHERE username IN ('emil1','emil2','emil3')")
        .get(),
    ).toEqual({ n: 3 })
    expect(sqlite.query('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('serves image attachments that decrypt and match their manifests', async () => {
    const sqlite = getDbInstance().sqlite
    const rows = sqlite
      .query(
        "SELECT client_id AS clientId,text,attachment_ids AS attachmentIds,id FROM messages WHERE client_id LIKE 'meapp-dev-v1:image:%'",
      )
      .all() as { clientId: string; text: string; attachmentIds: string; id: string }[]
    expect(rows).toHaveLength(5)
    for (const row of rows) {
      const content = devSeedContent(row.clientId, row.text)
      const image = content?.media?.[0]
      expect(image).toBeDefined()
      if (!image) throw new Error('Image fixture missing')
      expect(JSON.parse(row.attachmentIds)).toEqual([image.id])
      expect(
        sqlite
          .query('SELECT state,linked_to AS linkedTo FROM attachments WHERE id=?')
          .get(image.id),
      ).toEqual({ state: 'linked', linkedTo: row.id })
      const variant = image.variants[0]
      if (!variant) throw new Error('Image variant missing')
      const response = await app.handle(
        new Request(`http://127.0.0.1:3000/__dev/media/${image.base}/${variant.path}`),
      )
      expect(response.status).toBe(200)
      const sealed = Buffer.from(await response.arrayBuffer())
      expect(sealed.length).toBe(variant.size)
      const cipher = createDecipheriv(
        'aes-256-gcm',
        Buffer.from(image.key, 'base64'),
        sealed.subarray(0, 12),
      )
      cipher.setAuthTag(sealed.subarray(-16))
      const plain = Buffer.concat([cipher.update(sealed.subarray(12, -16)), cipher.final()])
      expect(createHash('sha512').update(plain).digest('base64')).toBe(variant.digest)
      expect(plain.subarray(8, 12).toString()).toBe('WEBP')
    }
    expect(devSeedContent('ordinary-client', '{"text":"hello"}')).toBeNull()
    expect(devSeedContent('meapp-dev-v1:image:invalid', 'not JSON')).toBeNull()
  })

  it('logs in with qwe and returns image content through the normal message API', async () => {
    const login = await app.handle(
      new Request('http://localhost/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'emil1', password: 'qwe', platform: 'android' }),
      }),
    )
    expect(login.status).toBe(200)
    const { token } = (await login.json()) as { token: string }
    const headers = { authorization: `Bearer ${token}` }
    const conversations = await app.handle(
      new Request('http://localhost/api/conversations', { headers }),
    )
    expect(conversations.status).toBe(200)
    const rooms = (await conversations.json()) as { id: string }[]
    expect(rooms).toHaveLength(4)
    const user = getDbInstance()
      .sqlite.query("SELECT id FROM users WHERE username='emil1'")
      .get() as { id: string }
    const installId = crypto.randomUUID()
    getDbInstance()
      .sqlite.query(
        'INSERT INTO relay_identities (user_id,device_id,install_id,registration_id,x25519_public_key,ed25519_public_key,created_at) VALUES (?,1,?,1,?,?,?)',
      )
      .run(user.id, installId, 'test-public-key', 'test-public-key', Math.floor(Date.now() / 1000))
    for (const room of rooms) {
      const response = await app.handle(
        new Request(
          `http://localhost/api/get-messages?conversationId=${room.id}&installId=${installId}`,
          { headers },
        ),
      )
      expect(response.status).toBe(200)
      const page = (await response.json()) as {
        messages: { media?: unknown[]; unavailableAttachmentIds?: string[] }[]
      }
      expect(
        page.messages.some(
          (message) => message.media?.length === 1 && !message.unavailableAttachmentIds?.length,
        ),
      ).toBe(true)
    }
    const attachment = getDbInstance()
      .sqlite.query(
        "SELECT a.id FROM attachments a JOIN room_members m ON m.room_id=a.room_id WHERE m.user_id=? AND a.client_id IN (SELECT client_id FROM attachments WHERE linked_to IN (SELECT id FROM messages WHERE client_id LIKE 'meapp-dev-v1:image:%')) LIMIT 1",
      )
      .get(user.id) as {
      id: string
    }
    const status = await app.handle(
      new Request(`http://localhost/api/media/${attachment.id}/status`, { headers }),
    )
    expect(status.status).toBe(200)
    expect(await status.json()).toEqual({
      available: true,
      state: 'linked',
      publicUrl: 'http://127.0.0.1:3000/__dev/media',
    })
    const missing = await app.handle(new Request('http://localhost/__dev/media/not-a-fixture'))
    expect(missing.status).toBe(404)
  })

  it('refuses seeding outside development', async () => {
    const previous = env.NODE_ENV
    env.NODE_ENV = 'production'
    try {
      await expect(seedDevData()).rejects.toThrow('only be seeded in development')
      expect(devSeedContent('meapp-dev-v1:image:0', '{}')).toBeNull()
    } finally {
      env.NODE_ENV = previous
    }
  })
})
