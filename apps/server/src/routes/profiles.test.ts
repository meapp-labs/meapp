import { beforeAll, beforeEach, expect, spyOn, test } from 'bun:test'
import { getDbInstance, runMigrations } from '@meapp/db'
import { AVATAR_MAX_BYTES } from '@meapp/shared'
import sharp from 'sharp'
import { app } from '../index.ts'
import { env } from '../lib/config.ts'
import { normalizeAvatar } from '../lib/profileImages.ts'
import { resetInMemoryRateLimits } from '../plugins/rateLimit.ts'
import { sweepProfileAvatars } from './profiles.ts'

const suffix = crypto.randomUUID().slice(0, 8)
const alice = `profile_a_${suffix}`
const bob = `profile_b_${suffix}`
let aliceCookie = ''
let bobCookie = ''
let aliceId = ''
let bobId = ''
const sqlite = () => getDbInstance().sqlite

function request(path: string, cookie = aliceCookie, body?: unknown) {
  return app.handle(
    new Request(`http://localhost/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
        'x-forwarded-for': `profiles-${suffix}`,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  )
}

beforeAll(async () => {
  runMigrations()
  for (const username of [alice, bob]) {
    const registration = await request('register', '', {
      username,
      password: 'secret123',
      confirmPassword: 'secret123',
    })
    expect(registration.status).toBe(201)
    const login = await request('login', '', { username, password: 'secret123' })
    expect(login.status).toBe(200)
    const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? ''
    const me = (await (await request('profile', cookie)).json()) as {
      id: string
      displayName: string
    }
    expect(me.displayName).toBe(username)
    if (username === alice) {
      aliceCookie = cookie
      aliceId = me.id
    } else {
      bobCookie = cookie
      bobId = me.id
    }
  }
  const add = sqlite().query(
    'INSERT INTO contacts (user_id,contact_user_id,created_at) VALUES (?,?,?)',
  )
  add.run(aliceId, bobId, 1)
  add.run(bobId, aliceId, 1)
})
beforeEach(resetInMemoryRateLimits)

test('profile reads and edits require authentication; editing cannot target another account', async () => {
  expect((await request('profile', '')).status).toBe(401)
  expect((await request(`profiles/${bobId}`, '')).status).toBe(401)
  expect((await request('profile', '', { displayName: 'Intruder' })).status).toBe(401)
  expect(
    (await request('profile', aliceCookie, { id: bobId, displayName: 'Intruder' })).status,
  ).toBe(400)
  expect((await request('profile', aliceCookie, { displayName: '  Alice Public  ' })).status).toBe(
    200,
  )
  const read = (await (await request(`profiles?username=${alice}`, bobCookie)).json()) as {
    id: string
    username: string
    displayName: string
  }
  expect(read).toMatchObject({ id: aliceId, username: alice, displayName: 'Alice Public' })
  expect(
    ((await (await request('profile', bobCookie)).json()) as { displayName: string }).displayName,
  ).toBe(bob)
  expect((await request('profile', aliceCookie, { displayName: '\u0000' })).status).toBe(400)
  expect((await request('profile', aliceCookie, { displayName: 'a'.repeat(81) })).status).toBe(400)
})

test('private alias ciphertext is owner-scoped and revision checked without changing public profiles', async () => {
  const ciphertext = Buffer.alloc(64, 3).toString('base64')
  expect(
    (await request(`contact-aliases/${bobId}`, aliceCookie, { revision: 0, ciphertext })).status,
  ).toBe(200)
  expect(
    (await request(`contact-aliases/${bobId}`, aliceCookie, { revision: 0, ciphertext })).status,
  ).toBe(409)
  expect(
    (await request(`contact-aliases/${bobId}`, bobCookie, { revision: 0, ciphertext })).status,
  ).toBe(403)
  expect((await request(`contact-aliases/${bobId}`, '', { revision: 0, ciphertext })).status).toBe(
    401,
  )
  const aliceAliases = await (await request('contact-aliases')).json()
  expect(aliceAliases).toEqual([{ contactId: bobId, ciphertext, revision: 1 }])
  expect(await (await request('contact-aliases', bobCookie)).json()).toEqual([
    { contactId: aliceId, ciphertext: null, revision: 0 },
  ])
  expect(
    ((await (await request(`profiles/${bobId}`)).json()) as { displayName: string }).displayName,
  ).toBe(bob)
  expect(
    (await request(`contact-aliases/${bobId}`, aliceCookie, { revision: 1, ciphertext: null }))
      .status,
  ).toBe(200)
})

test('avatar decoder rejects oversized, malformed, animated, unsupported, and excessive dimension inputs', async () => {
  await expect(normalizeAvatar(Buffer.alloc(AVATAR_MAX_BYTES + 1))).rejects.toMatchObject({
    statusCode: 413,
  })
  for (const bytes of [
    Buffer.from('not an image'),
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'),
    Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
  ]) {
    await expect(normalizeAvatar(bytes)).rejects.toMatchObject({ statusCode: 400 })
  }
  const huge = await sharp({ create: { width: 4097, height: 1, channels: 3, background: 'red' } })
    .png()
    .toBuffer()
  await expect(normalizeAvatar(huge)).rejects.toMatchObject({ statusCode: 400 })
  const frames = Buffer.alloc(10 * 20 * 3)
  frames.fill(255, 300)
  const animated = await sharp(frames, {
    raw: { width: 10, height: 20, channels: 3, pageHeight: 10 },
  })
    .webp({ loop: 0, delay: [100, 100] })
    .toBuffer()
  expect((await sharp(animated).metadata()).pages).toBe(2)
  await expect(normalizeAvatar(animated)).rejects.toMatchObject({ statusCode: 400 })
  expect((await request('profile/avatar', aliceCookie, { image: '%%%' })).status).toBe(400)
  expect(
    (
      await request('profile/avatar', aliceCookie, {
        image: Buffer.from('invalid').toString('base64'),
      })
    ).status,
  ).toBe(400)
  expect(
    (
      await request('profile/avatar', aliceCookie, {
        image: Buffer.alloc(AVATAR_MAX_BYTES + 1).toString('base64'),
      })
    ).status,
  ).toBe(413)
})

test('avatar lifecycle writes sanitized versioned blobs, retains active ones, and sweeps replaced/removed ones', async () => {
  const previous = { ...env }
  Object.assign(env, {
    R2_ACCOUNT_ID: 'profiles',
    R2_ACCESS_KEY_ID: 'test',
    R2_SECRET_ACCESS_KEY: 'test',
    R2_BUCKET: 'profiles',
    R2_PUBLIC_URL: 'https://avatars.example.test',
  })
  const uploads: Uint8Array[] = []
  const deleted: string[] = []
  let failUpload = false
  let failDelete = false
  const fakeFetch = Object.assign(
    async (_url: string | URL | Request, options?: RequestInit) => {
      if (options?.method === 'PUT') uploads.push(options.body as Uint8Array)
      else if (options?.method === 'DELETE') deleted.push(String(_url))
      else throw new Error('Unexpected storage request')
      if ((options?.method === 'PUT' && failUpload) || (options?.method === 'DELETE' && failDelete))
        return new Response(null, { status: 503 })
      return new Response(null, { status: 200 })
    },
    { preconnect: () => undefined },
  )
  const remote = spyOn(globalThis, 'fetch').mockImplementation(fakeFetch)
  try {
    const input = await sharp({
      create: { width: 300, height: 200, channels: 3, background: 'red' },
    })
      .withMetadata()
      .jpeg()
      .toBuffer()
    const first = await request('profile/avatar', aliceCookie, { image: input.toString('base64') })
    expect(first.status).toBe(200)
    const firstProfile = (await first.json()) as { avatarUrl: string }
    expect(firstProfile.avatarUrl).toMatch(
      /^https:\/\/avatars.example.test\/avatars\/[a-f0-9-]+\.webp$/,
    )
    const info = await sharp(uploads[0]).metadata()
    expect(info).toMatchObject({ format: 'webp', width: 256, height: 256 })
    expect(info.exif).toBeUndefined()
    const second = await request('profile/avatar', aliceCookie, { image: input.toString('base64') })
    const secondProfile = (await second.json()) as { avatarUrl: string }
    expect(secondProfile.avatarUrl).not.toBe(firstProfile.avatarUrl)
    sqlite().query('UPDATE profile_avatars SET created_at=0 WHERE user_id=?').run(aliceId)
    await sweepProfileAvatars()
    expect(deleted.length).toBe(1)
    expect(
      (
        sqlite()
          .query('SELECT COUNT(*) AS n FROM profile_avatars WHERE user_id=?')
          .get(aliceId) as { n: number }
      ).n,
    ).toBe(1)
    expect((await request('profile/avatar/remove', aliceCookie, {})).status).toBe(200)
    await sweepProfileAvatars()
    expect(deleted.length).toBe(2)
    expect(
      ((await (await request('profile')).json()) as { avatarUrl: string | null }).avatarUrl,
    ).toBeNull()
    failUpload = true
    expect(
      (await request('profile/avatar', aliceCookie, { image: input.toString('base64') })).status,
    ).toBe(503)
    expect(
      ((await (await request('profile')).json()) as { avatarUrl: string | null }).avatarUrl,
    ).toBeNull()
    sqlite().query('UPDATE profile_avatars SET created_at=0 WHERE user_id=?').run(aliceId)
    failDelete = true
    await sweepProfileAvatars()
    expect(
      (
        sqlite()
          .query('SELECT COUNT(*) AS n FROM profile_avatars WHERE user_id=?')
          .get(aliceId) as { n: number }
      ).n,
    ).toBe(1)
    failDelete = false
    await sweepProfileAvatars()
    expect(
      (
        sqlite()
          .query('SELECT COUNT(*) AS n FROM profile_avatars WHERE user_id=?')
          .get(aliceId) as { n: number }
      ).n,
    ).toBe(0)
  } finally {
    remote.mockRestore()
    Object.assign(env, previous)
  }
})
