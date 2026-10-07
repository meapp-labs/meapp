import type { Database } from 'bun:sqlite'
import { createCipheriv, createHash, randomBytes, scryptSync } from 'node:crypto'
import { getDbInstance, insertMessageWithSequence, runMigrations } from '@meapp/db'
import { decryptedContentSchema, mediaDescriptorSchema } from '@meapp/shared'
import { Elysia } from 'elysia'
import sharp from 'sharp'
import { LOGIN_CONFIG, env } from './config.ts'

const digest = (value: string) => createHash('sha256').update(`meapp-dev-v1:${value}`).digest()
const fixtureId = (value: string) => {
  const hex = digest(value).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
const colors = ['#635bff', '#ea7455', '#269d91']
const seedOrigin = () => `http://127.0.0.1:${env.PORT}/__dev/media`
let assetsPromise: ReturnType<typeof makeAssets> | undefined

async function makeAssets() {
  const files = new Map<string, Buffer>()
  const images = []
  for (let i = 0; i < 5; i++) {
    const avatar = await sharp(
      Buffer.from(
        `<svg width="160" height="160"><rect width="160" height="160" rx="80" fill="${colors[i % colors.length]}"/><text x="80" y="100" text-anchor="middle" font-size="64" fill="white">E${i + 1}</text></svg>`,
      ),
    )
      .webp()
      .toBuffer()
    files.set(`avatars/${fixtureId(`avatar:${i}`)}.webp`, avatar)
    const plain = await sharp(
      Buffer.from(
        `<svg width="640" height="400"><rect width="640" height="400" fill="${colors[i % colors.length]}"/><circle cx="500" cy="85" r="45" fill="#ffe19a"/><path d="M0 400L190 140L340 300L450 200L640 400" fill="#243b55"/><text x="32" y="60" font-size="30" fill="white">Weekend trip ${i + 1}</text></svg>`,
      ),
    )
      .webp()
      .toBuffer()
    const key = digest(`image-key:${i}`)
    const iv = digest(`image-iv:${i}`).subarray(0, 12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([iv, cipher.update(plain), cipher.final(), cipher.getAuthTag()])
    const base = `cap/${digest(`image-base:${i}`).toString('hex').slice(0, 32)}`
    files.set(`${base}/orig.enc`, encrypted)
    images.push(
      mediaDescriptorSchema.parse({
        v: 1,
        id: fixtureId(`attachment:${i}`),
        kind: 'image',
        base,
        key: key.toString('base64'),
        width: 640,
        height: 400,
        variants: [
          {
            name: 'orig',
            path: 'orig.enc',
            iv: iv.toString('base64'),
            size: encrypted.length,
            digest: createHash('sha512').update(plain).digest('base64'),
            mime: 'image/webp',
          },
        ],
      }),
    )
  }
  return { files, images }
}
const assets = () => {
  assetsPromise ??= makeAssets()
  return assetsPromise
}

// Only fixture messages use this development-only plaintext content envelope.
export function devSeedContent(clientId: string, text: string | null) {
  if (env.NODE_ENV !== 'development' || !clientId.startsWith('meapp-dev-v1:image:')) return null
  try {
    const parsed = decryptedContentSchema.safeParse(JSON.parse(text ?? '{}'))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Keep development fixture envelopes out of conversation summaries. */
export function devSeedPreview(clientId: string, text: string | null): string {
  const content = devSeedContent(clientId, text)
  if (!content) return text ?? ''
  if (content.text) return content.text
  const kind = content.media?.[0]?.kind
  return kind === 'image'
    ? 'Shared photo'
    : kind === 'video'
      ? 'Shared video'
      : kind === 'audio'
        ? 'Shared audio'
        : kind === 'gif'
          ? 'Shared GIF'
          : 'Shared attachment'
}

export const devSeedRoutes =
  env.NODE_ENV === 'development'
    ? new Elysia().get('/__dev/media/*', async ({ params, set }) => {
        const bytes = (await assets()).files.get(params['*'])
        if (!bytes) {
          set.status = 404
          return 'Not found'
        }
        set.headers['Content-Type'] = params['*'].endsWith('.webp')
          ? 'image/webp'
          : 'application/octet-stream'
        set.headers['Content-Length'] = String(bytes.length)
        return new Uint8Array(bytes)
      })
    : new Elysia()

export const devSeedMediaOrigin = (attachmentId: string) =>
  env.NODE_ENV === 'development' &&
  Array.from({ length: 5 }, (_, i) => fixtureId(`attachment:${i}`)).includes(attachmentId)
    ? seedOrigin()
    : undefined

export async function seedDevData(database?: Database) {
  if (env.NODE_ENV !== 'development')
    throw new Error('Test accounts can only be seeded in development')
  const sqlite = database ?? getDbInstance().sqlite
  const now = Math.floor(Date.now() / 1000)
  const { images } = await assets()
  const ids: string[] = []
  sqlite.transaction(() => {
    for (let i = 0; i < 3; i++) {
      const username = `emil${i + 1}`
      const existing = sqlite
        .query('SELECT id,password_hash AS passwordHash FROM users WHERE username=?')
        .get(username) as {
        id: string
        passwordHash: string
      } | null
      const id = existing?.id ?? fixtureId(username)
      ids.push(id)
      if (!existing) {
        const salt = randomBytes(LOGIN_CONFIG.SALT_LENGTH).toString('hex')
        const hash = scryptSync('qwe', salt, LOGIN_CONFIG.SCRYPT_KEY_LENGTH).toString('hex')
        const path = `avatars/${fixtureId(`avatar:${i}`)}.webp`
        sqlite
          .query(
            'INSERT INTO users (id,username,display_name,password_hash,avatar_url,platform,created_at) VALUES (?,?,?,?,?,?,?)',
          )
          .run(id, username, username, `${salt}:${hash}`, `${seedOrigin()}/${path}`, 'web', now)
      } else {
        const [salt, key] = existing.passwordHash.split(':')
        if (
          !salt ||
          scryptSync('qwe', salt, LOGIN_CONFIG.SCRYPT_KEY_LENGTH).toString('hex') !== key
        ) {
          const newSalt = randomBytes(LOGIN_CONFIG.SALT_LENGTH).toString('hex')
          const hash = scryptSync('qwe', newSalt, LOGIN_CONFIG.SCRYPT_KEY_LENGTH).toString('hex')
          sqlite.query('UPDATE users SET password_hash=? WHERE id=?').run(`${newSalt}:${hash}`, id)
        }
      }
    }
    for (const userId of ids)
      for (const friendId of ids) {
        if (userId !== friendId)
          sqlite
            .query(
              'INSERT OR IGNORE INTO contacts (user_id,contact_user_id,created_at) VALUES (?,?,?)',
            )
            .run(userId, friendId, now)
      }
  })()
  const conversations = [
    { name: 'emil1 & emil2', members: [0, 1], type: 'dm' },
    { name: 'emil1 & emil3', members: [0, 2], type: 'dm' },
    { name: 'emil2 & emil3', members: [1, 2], type: 'dm' },
    { name: 'Weekend plans', members: [0, 1, 2], type: 'group' },
    { name: 'MeApp testing', members: [0, 1, 2], type: 'group' },
  ]
  for (const [index, conversation] of conversations.entries()) {
    let roomId = fixtureId(`room:${index}`)
    if (conversation.type === 'dm') {
      const existing = sqlite
        .query(`SELECT r.id FROM rooms r WHERE r.type='dm'
        AND EXISTS (SELECT 1 FROM room_members WHERE room_id=r.id AND user_id=?)
        AND EXISTS (SELECT 1 FROM room_members WHERE room_id=r.id AND user_id=?)
        AND (SELECT COUNT(*) FROM room_members WHERE room_id=r.id)=2`)
        .get(ids[conversation.members[0] ?? 0] ?? '', ids[conversation.members[1] ?? 1] ?? '') as {
        id: string
      } | null
      roomId = existing?.id ?? roomId
    }
    sqlite.transaction(() => {
      sqlite
        .query(
          'INSERT OR IGNORE INTO rooms (id,name,type,created_by,created_at) VALUES (?,?,?,?,?)',
        )
        .run(
          roomId,
          conversation.name,
          conversation.type,
          ids[conversation.members[0] ?? 0] ?? '',
          now,
        )
      for (const [position, member] of conversation.members.entries())
        sqlite
          .query(
            'INSERT OR IGNORE INTO room_members (room_id,user_id,role,joined_at) VALUES (?,?,?,?)',
          )
          .run(
            roomId,
            ids[member] ?? '',
            conversation.type === 'group' && position === 0 ? 'admin' : 'member',
            now,
          )
    })()
    const texts = [
      'Hey! Ready to try MeApp?',
      'Yes! Messages and friends are working.',
      'Let’s plan a weekend trip.',
      'Saturday works for me ☀️',
      'Great, I’ll bring snacks.',
      'See you at 10!',
    ]
    for (const [offset, text] of texts.entries())
      await insertMessageWithSequence(sqlite, {
        roomId,
        userId: ids[conversation.members[offset % conversation.members.length] ?? 0] ?? '',
        clientId: `meapp-dev-v1:${index}:${offset}`,
        text,
      })
    const image = images[index % images.length]
    if (!image) continue
    await insertMessageWithSequence(sqlite, {
      roomId,
      userId: ids[conversation.members[1] ?? 0] ?? '',
      clientId: `meapp-dev-v1:image:${index}`,
      text: JSON.stringify({ text: 'Here’s a picture for our trip!', media: [image] }),
      attachmentIds: [image.id],
      mutation: (db, { messageId }) => {
        db.query(
          `INSERT OR IGNORE INTO attachments (id,client_id,room_id,sender_id,storage_key,state,variants_json,cipher_total,created_at,committed_at,linked_at,linked_to,last_upload_expiry) VALUES (?,?,?,?,?,'linked',?,?,?,?,?,?,?)`,
        ).run(
          image.id,
          fixtureId(`attachment-client:${index}`),
          roomId,
          ids[conversation.members[1] ?? 0] ?? '',
          image.base,
          JSON.stringify(image.variants.map(({ name, size }) => ({ name, size }))),
          image.variants[0]?.size ?? 0,
          now,
          now,
          now,
          messageId,
          now,
        )
      },
    })
  }
  console.log(
    '[Dev seed] emil1, emil2, emil3 / password: qwe — friends, 3 DMs, 2 groups, messages and images ready.',
  )
}

if (import.meta.main) {
  if (env.NODE_ENV !== 'development')
    throw new Error('Dev seed refuses non-development environments')
  runMigrations()
  await seedDevData()
}
