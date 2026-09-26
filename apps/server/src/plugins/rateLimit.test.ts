import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { getRouteRuleAndLimit, rateLimitPlugin } from './rateLimit.ts'

describe('Phase 8 - Rate Limiting & Body Limits', () => {
  it('identifies correct route rules and limits', () => {
    const loginRule = getRouteRuleAndLimit('POST', '/api/login')
    expect(loginRule.max).toBe(5)
    expect(loginRule.perIp).toBe(true)

    const ticketRule = getRouteRuleAndLimit('POST', '/ws/ticket')
    expect(ticketRule.max).toBe(20)

    const getMessagesRule = getRouteRuleAndLimit('GET', '/api/get-messages')
    expect(getMessagesRule.max).toBe(100)

    const postMessagesRule = getRouteRuleAndLimit('POST', '/api/send-message')
    expect(postMessagesRule.max).toBe(30)

    const bundleRule = getRouteRuleAndLimit('POST', '/api/e2e/relay/bundle')
    expect(bundleRule.max).toBe(30)

    const defaultRule = getRouteRuleAndLimit('GET', '/other/endpoint')
    expect(defaultRule.max).toBe(100)
  })

  it('enforces POST /api/login limit (5/min per IP)', async () => {
    const app = new Elysia().use(rateLimitPlugin).post('/api/login', () => ({ success: true }))

    const testIp = `192.168.1.${Math.floor(Math.random() * 200) + 10}`

    for (let i = 0; i < 5; i++) {
      const res = await app.handle(
        new Request('http://localhost/api/login', {
          method: 'POST',
          headers: { 'x-forwarded-for': testIp },
        }),
      )
      expect(res.status).toBe(200)
    }

    // 6th request should hit 429
    const blockedRes = await app.handle(
      new Request('http://localhost/api/login', {
        method: 'POST',
        headers: { 'x-forwarded-for': testIp },
      }),
    )
    expect(blockedRes.status).toBe(429)
    expect(blockedRes.headers.get('Retry-After')).toBeTruthy()
  })

  it('enforces POST /ws/ticket limit (20/min per user)', async () => {
    const app = new Elysia().use(rateLimitPlugin).post('/ws/ticket', () => ({ ticket: 'mock' }))

    const testUser = `user-${Math.random()}`
    for (let i = 0; i < 20; i++) {
      const res = await app.handle(
        new Request('http://localhost/ws/ticket', {
          method: 'POST',
          headers: { 'x-forwarded-for': testUser },
        }),
      )
      expect(res.status).toBe(200)
    }

    const blocked = await app.handle(
      new Request('http://localhost/ws/ticket', {
        method: 'POST',
        headers: { 'x-forwarded-for': testUser },
      }),
    )
    expect(blocked.status).toBe(429)
  })

  it('enforces POST /api/send-message limit (30/min per user)', async () => {
    const app = new Elysia().use(rateLimitPlugin).post('/api/send-message', () => ({ ok: true }))

    const testUser = `user-post-${Math.random()}`
    for (let i = 0; i < 30; i++) {
      const res = await app.handle(
        new Request('http://localhost/api/send-message', {
          method: 'POST',
          headers: { 'x-forwarded-for': testUser },
        }),
      )
      expect(res.status).toBe(200)
    }

    const blocked = await app.handle(
      new Request('http://localhost/api/send-message', {
        method: 'POST',
        headers: { 'x-forwarded-for': testUser },
      }),
    )
    expect(blocked.status).toBe(429)
  })

  it('enforces body size limits: rejects JSON payloads > 100KB', async () => {
    const app = new Elysia()
      .use(rateLimitPlugin)
      .post('/rooms/test/messages', () => ({ success: true }))

    // Payload <= 100KB allowed
    const okRes = await app.handle(
      new Request('http://localhost/rooms/test/messages', {
        method: 'POST',
        headers: {
          'content-length': '1024',
          'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 200) + 1}`,
        },
      }),
    )
    expect(okRes.status).toBe(200)

    // Payload > 100KB rejected with 413
    const largeRes = await app.handle(
      new Request('http://localhost/rooms/test/messages', {
        method: 'POST',
        headers: {
          'content-length': `${101 * 1024}`,
          'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 200) + 1}`,
        },
      }),
    )
    expect(largeRes.status).toBe(413)
    const body = (await largeRes.json()) as { message: string; code: string }
    expect(body.message).toBe('Payload too large')
    expect(body.code).toBe('PAYLOAD_TOO_LARGE')
  })

  it('enforces body size limits: rejects > 100KB on every route (uploads included)', async () => {
    // There is no /uploads route; the global cap is 100KB enforced at the
    // socket level (maxRequestBodySize) plus this header check.
    const app = new Elysia().use(rateLimitPlugin).post('/uploads', () => ({ success: true }))

    // 11MB upload rejected with 413
    const largeRes = await app.handle(
      new Request('http://localhost/uploads', {
        method: 'POST',
        headers: {
          'content-length': `${11 * 1024 * 1024}`,
          'x-forwarded-for': `10.0.1.${Math.floor(Math.random() * 200) + 1}`,
        },
      }),
    )
    expect(largeRes.status).toBe(413)
  })
})
