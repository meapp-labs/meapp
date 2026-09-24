import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { eq, getDbInstance, insertMessageWithSequence, runMigrations, schema } from '@meapp/db'

import { app } from '../index.ts'
import { startPubsub } from '../ws/chat.ts'

beforeAll(() => {
  runMigrations()
})

const runId = Date.now().toString(36)
const alice = `alice_${runId}`
const bob = `bob_${runId}`
const charlie = `charlie_${runId}`
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
  try {
    await getDbInstance().db.delete(schema.users).where(eq(schema.users.username, alice))
    await getDbInstance().db.delete(schema.users).where(eq(schema.users.username, bob))
    await getDbInstance().db.delete(schema.users).where(eq(schema.users.username, charlie))
  } catch {}
})

describe('REST API (Drizzle SQLite backend)', () => {
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

    const message = (await sent.json()) as { sequence: number; from: string; text: string }
    expect(message.sequence).toBe(1)
    expect(message.from).toBe(alice)
    expect(message.text).toBe('hello bob')

    const second = await api('/send-message', {
      method: 'POST',
      body: { conversationId, text: 'second' },
      cookie: sessionCookie,
    })
    expect(((await second.json()) as { sequence: number }).sequence).toBe(2)

    const page = await api(`/get-messages?conversationId=${conversationId}&limit=16`, {
      cookie: sessionCookie,
    })
    expect(page.status).toBe(200)

    const body = (await page.json()) as {
      messages: { sequence: number; text: string }[]
      hasMore: boolean
      totalCount: number
    }
    expect(body.totalCount).toBe(2)
    expect(body.messages.map((m) => m.sequence)).toEqual([1, 2])
    expect(body.hasMore).toBe(false)

    const after = await api(`/get-messages?conversationId=${conversationId}&after=1`, {
      cookie: sessionCookie,
    })
    expect(((await after.json()) as { messages: { sequence: number }[] }).messages).toEqual([
      expect.objectContaining({ sequence: 2 }),
    ])
  })

  it('delivers a group HTTP send to a ticket-authenticated WebSocket', async () => {
    const registered = await api('/register', {
      method: 'POST',
      body: { username: charlie, password, confirmPassword: password, platform: 'web' },
    })
    expect(registered.status).toBe(201)
    const roomResponse = await api('/conversations', {
      method: 'POST',
      body: { type: 'group', participants: [bob, charlie], name: 'Socket test group' },
      cookie: sessionCookie,
    })
    expect(roomResponse.status).toBe(201)
    const { id: roomId } = (await roomResponse.json()) as { id: string }
    const bobLogin = await api('/login', {
      method: 'POST',
      body: { username: bob, password, platform: 'web' },
    })
    const bobCookie = cookieHeaderFrom(bobLogin)
    expect(bobCookie).toBeTruthy()

    const ticketResponse = await app.handle(
      new Request('http://localhost/ws/ticket', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: bobCookie },
        body: JSON.stringify({ roomId }),
      }),
    )
    expect(ticketResponse.status).toBe(200)
    const { ticket } = (await ticketResponse.json()) as { ticket: string }

    app.listen({ port: 0, hostname: '127.0.0.1' })
    await startPubsub(() => app.server ?? undefined)
    const ws = new WebSocket(`ws://127.0.0.1:${app.server?.port}/ws?roomId=${roomId}`)
    let authenticated!: () => void
    let received!: (payload: { text: string; roomId: string }) => void
    let failed!: (error: Error) => void
    const authPromise = new Promise<void>((resolve, reject) => {
      authenticated = resolve
      failed = reject
    })
    const messagePromise = new Promise<{ text: string; roomId: string }>((resolve) => {
      received = resolve
    })
    let timeout!: ReturnType<typeof setTimeout>
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('WebSocket delivery timed out')), 5000)
    })

    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', payload: { ticket } }))
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data as string) as {
        type: string
        payload: { text: string; roomId: string }
      }
      if (message.type === 'authenticated') authenticated()
      if (message.type === 'message') received(message.payload)
      if (message.type === 'error') failed(new Error(JSON.stringify(message.payload)))
    }
    ws.onerror = () => failed(new Error('WebSocket failed'))
    ws.onclose = (event) => failed(new Error(`WebSocket closed: ${event.code}`))

    try {
      await Promise.race([authPromise, timeoutPromise])
      const text = `live-${Bun.randomUUIDv7()}`
      const sent = await api('/send-message', {
        method: 'POST',
        body: { conversationId: roomId, text, clientId: Bun.randomUUIDv7() },
        cookie: sessionCookie,
      })
      expect(sent.status).toBe(200)
      await expect(Promise.race([messagePromise, timeoutPromise])).resolves.toEqual(
        expect.objectContaining({ roomId, text }),
      )
    } finally {
      clearTimeout(timeout)
      ws.close()
      app.stop()
    }
  })

  it('returns the latest messages first and paginates into older history', async () => {
    const roomResponse = await api('/conversations', {
      method: 'POST',
      body: { type: 'dm', participants: [bob] },
      cookie: sessionCookie,
    })
    const { id: roomId } = (await roomResponse.json()) as { id: string }
    const user = await getDbInstance()
      .db.select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.username, alice))
      .get()
    if (!user) throw new Error('Test user was not created')
    for (let i = 0; i < 18; i++) {
      await insertMessageWithSequence(getDbInstance().sqlite, {
        roomId,
        userId: user.id,
        clientId: Bun.randomUUIDv7(),
        text: `history ${i}`,
      })
    }

    const latest = await api(`/get-messages?conversationId=${roomId}&limit=16`, {
      cookie: sessionCookie,
    })
    expect(latest.status).toBe(200)
    const page = (await latest.json()) as {
      messages: { sequence: number; timestamp: string }[]
      totalCount: number
      hasMore: boolean
    }
    expect(page.totalCount).toBe(20)
    expect(page.messages.map((message) => message.sequence)).toEqual(
      Array.from({ length: 16 }, (_, index) => index + 5),
    )
    expect(page.hasMore).toBe(true)
    const newest = page.messages.at(-1)
    if (!newest) throw new Error('Latest page was empty')
    expect(Math.abs(Date.parse(newest.timestamp) - Date.now())).toBeLessThan(60_000)

    const older = await api(`/get-messages?conversationId=${roomId}&before=5&limit=16`, {
      cookie: sessionCookie,
    })
    expect(
      ((await older.json()) as { messages: { sequence: number }[] }).messages.map(
        (m) => m.sequence,
      ),
    ).toEqual([1, 2, 3, 4])
  })

  it('blocks messaging for non participants', async () => {
    const outsider = `outsider_${runId}`

    const outsiderRes = await api('/register', {
      method: 'POST',
      body: {
        username: outsider,
        password: 'password123',
        confirmPassword: 'password123',
        platform: 'web',
      },
    })
    expect(outsiderRes.status).toBe(201)

    const outsiderLogin = await api('/login', {
      method: 'POST',
      body: { username: outsider, password: 'password123', platform: 'web' },
    })
    const outsiderCookie = cookieHeaderFrom(outsiderLogin)

    const list = await api('/conversations', { cookie: sessionCookie })
    const [conversation] = (await list.json()) as { id: string }[]

    const res = await api(`/get-messages?conversationId=${conversation?.id}`, {
      cookie: outsiderCookie,
    })
    expect(res.status).toBe(401)
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
