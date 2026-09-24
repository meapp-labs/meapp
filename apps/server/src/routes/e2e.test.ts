import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { eq, getDbInstance, runMigrations, schema } from '@meapp/db'
import {
  type BundleResponse,
  CIPHERTEXT_TYPE_PRE_KEY,
  CIPHERTEXT_TYPE_WHISPER,
} from '@meapp/shared'

import { app } from '../index.ts'
import { resetInMemoryRateLimits } from '../plugins/rateLimit.ts'

// Live-read flag (isE2EEnabled) → settable per-test without restart.
process.env.E2E_ENABLED = 'true'

beforeAll(() => {
  runMigrations()
  // Suite shares one IP with other test files; without this the register/login
  // limits (5/min) bleed across files and fail runs.
  resetInMemoryRateLimits()
})

const runId = Date.now().toString(36)
const alice = `e2e_alice_${runId}`
const bob = `e2e_bob_${runId}`
const password = 'secret123'

const b64 = (bytes: number) =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('base64')

const deviceId = Bun.randomUUIDv7()
const identityKeyPublic = b64(32)

const futureIso = () => new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString()

let aliceCookie = ''
let bobCookie = ''
let dmConversationId = ''

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
  } catch {}
})

describe('E2E Phase 10', () => {
  it('registers and logs in two users', async () => {
    const a = await api('/register', {
      method: 'POST',
      body: { username: alice, password, confirmPassword: password, platform: 'web' },
    })
    expect(a.status).toBe(201)

    const b = await api('/register', {
      method: 'POST',
      body: { username: bob, password, confirmPassword: password, platform: 'web' },
    })
    expect(b.status).toBe(201)

    // Registration doesn't auto-login — grab session cookies explicitly.
    const aliceLogin = await api('/login', {
      method: 'POST',
      body: { username: alice, password, platform: 'web' },
    })
    expect(aliceLogin.status).toBe(200)
    aliceCookie = cookieHeaderFrom(aliceLogin)
    expect(aliceCookie).toBeTruthy()

    const bobLogin = await api('/login', {
      method: 'POST',
      body: { username: bob, password, platform: 'web' },
    })
    expect(bobLogin.status).toBe(200)
    bobCookie = cookieHeaderFrom(bobLogin)
    expect(bobCookie).toBeTruthy()
  })

  it('exposes no e2e surface when the flag is off', async () => {
    process.env.E2E_ENABLED = 'false'
    const res = await api('/e2e/device', {
      method: 'POST',
      body: { deviceId, platform: 'web', identityKeyPublic },
      cookie: aliceCookie,
    })
    expect(res.status).toBe(404)
    process.env.E2E_ENABLED = 'true'
  })

  it('registers a device and uploads a bundle when the flag is on', async () => {
    const reg = await api('/e2e/device', {
      method: 'POST',
      body: { deviceId, platform: 'web', identityKeyPublic },
      cookie: aliceCookie,
    })
    expect(reg.status).toBe(200)
    expect((await readJson<{ registered: boolean }>(reg)).registered).toBe(true)

    const upload = await api('/e2e/bundle', {
      method: 'POST',
      body: {
        deviceId,
        identityKeyPublic,
        prekeys: [
          {
            prekeyId: 1,
            prekeyPublic: b64(32),
            signedPrekeyId: 101,
            signedPrekeyPublic: b64(32),
            signedPrekeySignature: b64(64),
            signedPrekeyExpiresAt: futureIso(),
            kyberPrekeyId: 201,
            kyberPrekeyPublic: b64(1184),
            kyberPrekeySignature: b64(64),
            isLastResort: false,
          },
          {
            prekeyId: 2,
            prekeyPublic: b64(32),
            signedPrekeyId: 102,
            signedPrekeyPublic: b64(32),
            signedPrekeySignature: b64(64),
            signedPrekeyExpiresAt: futureIso(),
            kyberPrekeyId: 202,
            kyberPrekeyPublic: b64(1184),
            kyberPrekeySignature: b64(64),
            isLastResort: true,
          },
        ],
      },
      cookie: aliceCookie,
    })
    expect(upload.status).toBe(201)
    expect((await readJson<{ uploaded: number }>(upload)).uploaded).toBe(2)
  })

  it('rejects bundle upload for an unregistered device', async () => {
    const upload = await api('/e2e/bundle', {
      method: 'POST',
      body: {
        deviceId: Bun.randomUUIDv7(),
        identityKeyPublic,
        prekeys: [
          {
            prekeyId: 1,
            prekeyPublic: b64(32),
            signedPrekeyId: 101,
            signedPrekeyPublic: b64(32),
            signedPrekeySignature: b64(64),
            signedPrekeyExpiresAt: futureIso(),
            kyberPrekeyId: 201,
            kyberPrekeyPublic: b64(1184),
            kyberPrekeySignature: b64(64),
            isLastResort: false,
          },
        ],
      },
      cookie: aliceCookie,
    })
    expect(upload.status).toBe(400)
  })

  it('claims one-time prekeys atomically, then falls back to last-resort', async () => {
    const aliceRow = getDbInstance()
      .sqlite.query('SELECT id FROM users WHERE username = ?')
      .get(alice) as { id: string }
    const aliceId = aliceRow.id

    const first = await api(`/e2e/bundle?userId=${aliceId}`, { cookie: bobCookie })
    expect(first.status).toBe(200)

    const firstBody = await readJson<BundleResponse[]>(first)
    expect(firstBody[0]?.prekeyBundle?.isLastResort).toBe(false)

    // Second claim: OTP exhausted → last-resort bundle
    const second = await api(`/e2e/bundle?userId=${aliceId}`, { cookie: bobCookie })
    expect(second.status).toBe(200)
    const secondBody = await readJson<BundleResponse[]>(second)
    expect(secondBody[0]?.prekeyBundle?.isLastResort).toBe(true)

    // Last-resort is reusable
    const third = await api(`/e2e/bundle?userId=${aliceId}`, { cookie: bobCookie })
    expect(third.status).toBe(200)
  })

  it('sends an E2E ciphertext message with idempotency', async () => {
    const dmRes = await api('/conversations', {
      method: 'POST',
      body: { type: 'dm', participants: [bob] },
      cookie: aliceCookie,
    })
    expect([200, 201]).toContain(dmRes.status)
    const dm = await readJson<{ id: string }>(dmRes)
    const conversationId = dm.id
    expect(conversationId).toBeTruthy()
    dmConversationId = conversationId

    const clientId = Bun.randomUUIDv7()
    const ciphertext = b64(64)

    const send = await api('/send-message', {
      method: 'POST',
      body: {
        conversationId,
        ciphertext,
        ciphertextType: CIPHERTEXT_TYPE_PRE_KEY,
        deviceId,
        clientId,
      },
      cookie: aliceCookie,
    })
    expect(send.status).toBe(200)
    const sent = await readJson<{ ciphertext: string; sequence: number }>(send)
    expect(sent.ciphertext).toBe(ciphertext)

    // Idempotent retry returns the same sequence
    const retry = await api('/send-message', {
      method: 'POST',
      body: {
        conversationId,
        ciphertext,
        ciphertextType: CIPHERTEXT_TYPE_PRE_KEY,
        deviceId,
        clientId,
      },
      cookie: aliceCookie,
    })
    expect((await readJson<{ sequence: number }>(retry)).sequence).toBe(sent.sequence)

    // Recipient fetches ciphertext, not plaintext
    const fetched = await api(`/get-messages?conversationId=${conversationId}`, {
      cookie: bobCookie,
    })
    const page = await readJson<{
      messages: Array<{ ciphertext?: string; text?: string; ciphertextType?: number }>
    }>(fetched)
    const e2eMsg = page.messages.find((m) => m.ciphertext === ciphertext)
    expect(e2eMsg).toBeTruthy()
    expect(e2eMsg?.ciphertextType).toBe(CIPHERTEXT_TYPE_PRE_KEY)
    expect(e2eMsg?.text).toBeUndefined()
  })

  it("rejects a send claiming another user's device", async () => {
    const res = await api('/send-message', {
      method: 'POST',
      body: {
        conversationId: dmConversationId,
        ciphertext: b64(64),
        ciphertextType: CIPHERTEXT_TYPE_WHISPER,
        deviceId, // registered to alice, sent by bob
        clientId: Bun.randomUUIDv7(),
      },
      cookie: bobCookie,
    })
    expect(res.status).toBe(400)
  })

  it('rejects E2E sends when the flag is off again', async () => {
    process.env.E2E_ENABLED = 'false'
    const res = await api('/send-message', {
      method: 'POST',
      body: {
        conversationId: dmConversationId,
        ciphertext: b64(64),
        ciphertextType: CIPHERTEXT_TYPE_WHISPER,
        deviceId,
      },
      cookie: aliceCookie,
    })
    expect([400, 403]).toContain(res.status)
  })
})
