import { afterAll, describe, expect, it } from 'bun:test'
import Redis from 'ioredis'

import { app } from '../index.ts'
import { RedisKeys } from '../services/redis.service.ts'

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379'

// These tests exercise Redis-backed routes, so they are skipped where Redis is absent
// (the CI server job has no Redis service).
const probe = new Redis(REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  connectTimeout: 1000,
})

let redisAvailable = false
try {
  await probe.connect()
  redisAvailable = (await probe.ping()) === 'PONG'
} catch {
  redisAvailable = false
}

if (!redisAvailable) {
  console.warn('[api.test] Redis is not reachable — skipping REST endpoint tests')
}

const runId = Date.now().toString(36)
const alice = `alice_${runId}`
const bob = `bob_${runId}`
const password = 'secret123'

let sessionCookie = ''

const api = async (
  path: string,
  init: { method?: string; body?: unknown; cookie?: string } = {},
): Promise<Response> => {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (init.cookie) headers.set('cookie', init.cookie)

  return app.handle(
    new Request(`http://localhost/api${path}`, {
      method: init.method ?? 'GET',
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    }),
  )
}

const cookieHeaderFrom = (response: Response): string => {
  const setCookie = response.headers.get('set-cookie')
  return setCookie ? (setCookie.split(';')[0] ?? '') : ''
}

const readJson = async <T>(response: Response): Promise<T> => (await response.json()) as T

afterAll(async () => {
  if (redisAvailable) {
    await probe.del(RedisKeys.user(alice), RedisKeys.user(bob))
    await probe.del(RedisKeys.contacts(alice), RedisKeys.contacts(bob))
    await probe.del(RedisKeys.pushToken(alice), RedisKeys.loginAttempts(alice))
    const ids = await probe.smembers(RedisKeys.userConversations(alice))
    for (const id of ids) {
      await probe.del(RedisKeys.conversation(id), RedisKeys.conversationMessages(id))
    }
    await probe.del(RedisKeys.userConversations(alice))
    await probe.del(RedisKeys.dmLookup(alice, bob))
  }
  await probe.quit()
})

describe.skipIf(!redisAvailable)('ported REST API', () => {
  it('rejects unauthenticated access to /api/me', async () => {
    const res = await api('/me', { method: 'POST', body: { platform: 'web' } })

    expect(res.status).toBe(401)
    expect((await readJson<{ code: string }>(res)).code).toBe('AUTHENTICATION_REQUIRED')
  })

  it('registers a user and rejects duplicates', async () => {
    const created = await api('/register', {
      method: 'POST',
      body: { username: alice, password, confirmPassword: password, platform: 'web' },
    })
    expect(created.status).toBe(201)
    expect(await created.text()).toBe(alice)

    const duplicate = await api('/register', {
      method: 'POST',
      body: { username: alice, password, confirmPassword: password, platform: 'web' },
    })
    expect(duplicate.status).toBe(409)
    expect((await readJson<{ code: string }>(duplicate)).code).toBe('USER_ALREADY_EXISTS')
  })

  it('rejects a bad password body before reaching the handler', async () => {
    const res = await api('/register', {
      method: 'POST',
      body: { username: 'ab', password: 'x', confirmPassword: 'y', platform: 'web' },
    })

    expect(res.status).toBe(400)
    expect((await readJson<{ code: string }>(res)).code).toBe('VALIDATION_ERROR')
  })

  it('rejects login with the wrong password', async () => {
    const res = await api('/login', {
      method: 'POST',
      body: { username: alice, password: 'wrong-password', platform: 'web' },
    })

    expect(res.status).toBe(401)
    expect((await readJson<{ code: string }>(res)).code).toBe('UNAUTHORIZED')
  })

  it('logs in, issues an HttpOnly session cookie and authorises /api/me', async () => {
    const login = await api('/login', {
      method: 'POST',
      body: { username: alice, password, platform: 'web' },
    })

    expect(login.status).toBe(200)
    expect(await login.text()).toBe(alice)

    const setCookie = login.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('access_token=')
    expect(setCookie.toLowerCase()).toContain('httponly')

    sessionCookie = cookieHeaderFrom(login)
    expect(sessionCookie).not.toBe('')

    const me = await api('/me', {
      method: 'POST',
      body: { platform: 'web' },
      cookie: sessionCookie,
    })
    expect(me.status).toBe(200)
    expect(await me.json()).toEqual({ username: alice })
  })

  it('creates a second account for friend/messaging flows', async () => {
    const res = await api('/register', {
      method: 'POST',
      body: { username: bob, password, confirmPassword: password, platform: 'web' },
    })

    expect(res.status).toBe(201)
  })

  it('manages contacts', async () => {
    const self = await api('/add-other', {
      method: 'POST',
      body: { other: alice },
      cookie: sessionCookie,
    })
    expect(self.status).toBe(400)

    const missing = await api('/add-other', {
      method: 'POST',
      body: { other: `ghost_${runId}` },
      cookie: sessionCookie,
    })
    expect(missing.status).toBe(404)
    expect((await readJson<{ code: string }>(missing)).code).toBe('USER_NOT_FOUND')

    const added = await api('/add-other', {
      method: 'POST',
      body: { other: bob },
      cookie: sessionCookie,
    })
    expect(added.status).toBe(200)
    expect(await added.text()).toBe(bob)

    const duplicate = await api('/add-other', {
      method: 'POST',
      body: { other: bob },
      cookie: sessionCookie,
    })
    expect(duplicate.status).toBe(409)

    const others = await api('/get-others', { cookie: sessionCookie })
    expect(others.status).toBe(200)
    expect(await others.json()).toEqual([bob])

    const removed = await api('/remove-other', {
      method: 'POST',
      body: { other: bob },
      cookie: sessionCookie,
    })
    expect(removed.status).toBe(200)
    expect(await removed.json()).toEqual({ other: bob, count: 1 })

    const removedAgain = await api('/remove-other', {
      method: 'POST',
      body: { other: bob },
      cookie: sessionCookie,
    })
    expect(removedAgain.status).toBe(404)
  })

  it('creates a DM once and returns the same conversation on repeat', async () => {
    const created = await api('/conversations', {
      method: 'POST',
      body: { type: 'dm', participants: [bob] },
      cookie: sessionCookie,
    })
    expect(created.status).toBe(201)

    const conversation = (await created.json()) as {
      id: string
      participants: string[]
      isGroup: boolean
    }
    expect(conversation.isGroup).toBe(false)
    expect(conversation.participants.sort()).toEqual([alice, bob].sort())

    const again = await api('/conversations', {
      method: 'POST',
      body: { type: 'dm', participants: [bob] },
      cookie: sessionCookie,
    })
    expect(again.status).toBe(200)
    expect(((await again.json()) as { id: string }).id).toBe(conversation.id)

    const list = await api('/conversations', { cookie: sessionCookie })
    expect(list.status).toBe(200)
    expect(((await list.json()) as { id: string }[]).map((c) => c.id)).toContain(conversation.id)
  })

  it('sends a message and paginates it back', async () => {
    const created = await api('/conversations', {
      method: 'POST',
      body: { type: 'dm', participants: [bob] },
      cookie: sessionCookie,
    })
    const { id: conversationId } = (await created.json()) as { id: string }

    const sent = await api('/send-message', {
      method: 'POST',
      body: { conversationId, text: 'hello bob' },
      cookie: sessionCookie,
    })
    expect(sent.status).toBe(200)

    const message = (await sent.json()) as { index: number; from: string; text: string }
    expect(message.index).toBe(0)
    expect(message.from).toBe(alice)
    expect(message.text).toBe('hello bob')

    const second = await api('/send-message', {
      method: 'POST',
      body: { conversationId, text: 'second' },
      cookie: sessionCookie,
    })
    expect(((await second.json()) as { index: number }).index).toBe(1)

    const page = await api(`/get-messages?conversationId=${conversationId}&limit=16`, {
      cookie: sessionCookie,
    })
    expect(page.status).toBe(200)

    const body = (await page.json()) as {
      messages: { index: number; text: string }[]
      hasMore: boolean
      totalCount: number
    }
    expect(body.totalCount).toBe(2)
    expect(body.messages.map((m) => m.index)).toEqual([0, 1])
    expect(body.hasMore).toBe(false)

    const after = await api(`/get-messages?conversationId=${conversationId}&after=0`, {
      cookie: sessionCookie,
    })
    expect(((await after.json()) as { messages: { index: number }[] }).messages).toEqual([
      expect.objectContaining({ index: 1 }),
    ])
  })

  it('blocks messaging for non participants', async () => {
    const outsider = `outsider_${runId}`
    await probe.set(RedisKeys.user(outsider), 'salt:key')

    const login = await api('/login', {
      method: 'POST',
      body: { username: outsider, password: 'irrelevant', platform: 'web' },
    })
    // Password does not match the placeholder hash, so this must fail closed.
    expect(login.status).toBe(401)

    const list = await api('/conversations', { cookie: sessionCookie })
    const [conversation] = (await list.json()) as { id: string }[]

    const res = await api(`/get-messages?conversationId=${conversation?.id}`, {
      cookie: sessionCookie,
    })
    expect(res.status).toBe(200)

    await probe.del(RedisKeys.user(outsider), RedisKeys.loginAttempts(outsider))
  })

  it('validates query parameters', async () => {
    const res = await api('/get-messages?conversationId=not-a-uuid&after=abc', {
      cookie: sessionCookie,
    })

    expect(res.status).toBe(400)
    expect((await readJson<{ code: string }>(res)).code).toBe('VALIDATION_ERROR')
  })

  it('logs out and clears the session cookie', async () => {
    const res = await api('/logout', { method: 'POST', cookie: sessionCookie })

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('logged_out')

    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('access_token=')

    const anonymous = await api('/me', { method: 'POST', body: { platform: 'web' } })
    expect(anonymous.status).toBe(401)
  })
})
