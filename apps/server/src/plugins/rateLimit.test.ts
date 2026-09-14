import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { getRouteRuleAndLimit, rateLimitPlugin } from './rateLimit.ts'

describe('Phase 8 - Rate Limiting & Body Limits', () => {
  it('identifies correct route rules and limits', () => {
    const loginRule = getRouteRuleAndLimit('POST', '/auth/login')
    expect(loginRule.max).toBe(5)
    expect(loginRule.perIp).toBe(true)

    const ticketRule = getRouteRuleAndLimit('POST', '/ws/ticket')
    expect(ticketRule.max).toBe(20)

    const getMessagesRule = getRouteRuleAndLimit(
      'GET',
      '/rooms/123e4567-e89b-12d3-a456-426614174000/messages',
    )
    expect(getMessagesRule.max).toBe(100)

    const postMessagesRule = getRouteRuleAndLimit(
      'POST',
      '/rooms/123e4567-e89b-12d3-a456-426614174000/messages',
    )
    expect(postMessagesRule.max).toBe(30)

    const defaultRule = getRouteRuleAndLimit('GET', '/other/endpoint')
    expect(defaultRule.max).toBe(100)
  })

  it('enforces POST /auth/login limit (5/min per IP)', async () => {
    const app = new Elysia().use(rateLimitPlugin).post('/auth/login', () => ({ success: true }))

    const testIp = `192.168.1.${Math.floor(Math.random() * 200) + 10}`

    for (let i = 0; i < 5; i++) {
      const res = await app.handle(
        new Request('http://localhost/auth/login', {
          method: 'POST',
          headers: { 'x-forwarded-for': testIp },
        }),
      )
      expect(res.status).toBe(200)
    }

    // 6th request should hit 429
    const blockedRes = await app.handle(
      new Request('http://localhost/auth/login', {
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

  it('enforces POST /rooms/:roomId/messages limit (30/min per user)', async () => {
    const app = new Elysia()
      .use(rateLimitPlugin)
      .post('/rooms/123e4567-e89b-12d3-a456-426614174000/messages', () => ({ ok: true }))

    const testUser = `user-post-${Math.random()}`
    for (let i = 0; i < 30; i++) {
      const res = await app.handle(
        new Request('http://localhost/rooms/123e4567-e89b-12d3-a456-426614174000/messages', {
          method: 'POST',
          headers: { 'x-forwarded-for': testUser },
        }),
      )
      expect(res.status).toBe(200)
    }

    const blocked = await app.handle(
      new Request('http://localhost/rooms/123e4567-e89b-12d3-a456-426614174000/messages', {
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
    const body = (await largeRes.json()) as { error: string }
    expect(body.error).toBe('Payload too large')
  })

  it('enforces body size limits: allows uploads up to 10MB but rejects > 10MB', async () => {
    const app = new Elysia().use(rateLimitPlugin).post('/uploads', () => ({ success: true }))

    // 5MB upload allowed
    const okRes = await app.handle(
      new Request('http://localhost/uploads', {
        method: 'POST',
        headers: {
          'content-length': `${5 * 1024 * 1024}`,
          'x-forwarded-for': `10.0.1.${Math.floor(Math.random() * 200) + 1}`,
        },
      }),
    )
    expect(okRes.status).toBe(200)

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
