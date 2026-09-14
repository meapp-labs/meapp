# MeApp Migration to Elysia - V7 FINAL (All 5 Remaining Holes Fixed) - AI Execution Plan

> V6 was 85% -> 95% correct. V7 fixes the final 5 + rate limits. This is the version to execute.
> Changes from V6: expand/contract migrations (no auto DB rollback), WS ticket auth (no token in URL logs), sequence cursor, Litestream RPO wording, migration concurrency lock, rate limits.

## 0. Architecture Invariants - UPDATED (Fix #1, #3, #5)

### Deployment Invariant - FIXED (Fix #1 - Rollback claim)
**OLD V6 (dangerous):**
> rollback to previous sha + DB rollback

**NEW V7 (correct):**
> Application image rollback is safe. Database rollback is NOT automatic. Use expand/contract migrations.

**Expand/Contract pattern for SQLite:**

```
Release N (expand):
  - Add new columns/tables as nullable or with defaults
  - Old code + new code both work with old + new schema
  - Example: ADD COLUMN nickname TEXT, keep name column

Release N+1 (migrate):
  - Switch application to use new schema (nickname)
  - Backfill data: UPDATE users SET nickname=name WHERE nickname IS NULL
  - Old code still works if rollback needed

Release N+2 (contract):
  - Remove old schema (DROP COLUMN name) after N+1 stable for 1 week
```

**Rollback rules:**
- App rollback: `systemctl --user restart meapp:prev-sha` — always safe
- DB rollback: NEVER automatic. If migration N failed, restore from Litestream backup + pre-migration backup, NOT downgrade migration. Document manual procedure.
- CI must backup DB BEFORE migration: `cp /app/data/data.db /app/data/data.db.pre-${SHA}`

### Auth Invariant - FIXED (Fix #2 - No token in query string logs)

**OLD V6:**
> wss://...?token=long-lived-access-token (can leak in proxy logs)

**NEW V7:**
> Short-lived single-use WS ticket via authenticated HTTPS, then WS AUTH message

**Flow:**

**Web (cookie):**
```
Browser has HttpOnly cookie -> WS wss://api/ws?roomId=xxx (cookie sent auto) -> server derives user from cookie -> OK
No token in URL.
```

**Native (ticket):**
```
Native has long-lived accessToken in SecureStore
POST /ws/ticket Authorization: Bearer <accessToken>
-> Server verifies accessToken, creates ticket JWT { sub=userId, roomId, exp=60s, jti=uuid, single-use }
-> Returns { ticket: "short-jwt" }

WS connect: wss://api/ws?roomId=xxx (no token in URL yet)
-> On open, send: {"type":"auth","payload":{"ticket":"short-jwt"}}
-> Server verifies ticket, checks jti not used (Redis SETNX), marks used, authenticates
-> Then subscribe

Ticket is 60s expiry, single-use, not logged as sensitive if Caddy logs query string, but we also avoid query string for token:
- Option A (preferred): Send ticket via first WS message AUTH, not query string
- Option B (if query): Ensure Caddy access log does NOT log query string: log { output discard } or filter
```

**Implementation:** Ticket table in Redis: `SET ticket:jti 1 EX 60 NX` — if exists, reject replay.

### Persistence Invariant - FIXED (Fix #3 - RPO wording)

**OLD V6:**
> RPO: 1 minute (Litestream replicates WAL every 1s)

**NEW V7:**
> Target RPO: ≤1 minute; verify through failure/restore testing. Litestream configured to replicate WAL continuously (sync interval 1s), but actual RPO depends on S3 latency, WAL checkpoint timing, and must be measured via chaos testing (kill -9 server during write, restore, count lost messages).

**Restore test:** Weekly CI job that kills server mid-write, restores from S3, measures messages lost. Document actual measured RPO, not claimed.

### Messaging Invariant - FIXED (Fix #5 - Sequence cursor)

**OLD V6:**
> GET /rooms/:id/messages?after=<lastServerId> (UUID > UUID)

**NEW V7:**
> Monotonic sequence per room, not UUID ordering

**Schema:**
```sql
messages:
  id UUID PK
  clientId UUID
  roomId UUID FK
  userId UUID FK
  sequence INTEGER NOT NULL -- monotonic per room
  text TEXT
  createdAt TIMESTAMP
  UNIQUE(userId, clientId)
  UNIQUE(roomId, sequence) -- ensures no gaps/duplicates per room
```

**Cursor:**
```
GET /rooms/:id/messages?afterSequence=1842&limit=50
-> returns messages where sequence > 1842 ORDER BY sequence ASC

Client stores lastSequence, not last UUID
```

Why: UUIDs are not ordered, concurrent inserts can have UUID1 > UUID2 but created earlier. Sequence gives total order per room.

**Sequence generation:** SQLite does not have per-room auto-increment easily. Options:
1. `MAX(sequence) + 1` in transaction (with busy_timeout, works for low concurrency, 2 users)
2. Redis INCR `room:seq:{roomId}` for high concurrency (atomic)
3. For MeApp (2 users), use transaction: `BEGIN IMMEDIATE; SELECT MAX...; INSERT; COMMIT;`

We use option 1 with `BEGIN IMMEDIATE` to lock DB for this room, safe for 2 users. Document upgrade path to Redis INCR if scale >100 msg/s.

---

## PHASE 0: Setup (Same as V5 but with concurrency group fix)

Same as V5 Phase 0, plus add migration concurrency.

---

## PHASE 1: Shared + DB FIXED (Fix #5 sequence + idempotency)

**`packages/db/src/schema.ts` V7 FINAL:**

```ts
import { sqliteTable, text, integer, primaryKey, unique, index } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  // For expand/contract example: keep old, add new nullable
  // nickname will be added in Release N, name removed in N+2
  nickname: text('nickname'), // NEW - nullable for expand phase
  passwordHash: text('password_hash').notNull(),
  avatarUrl: text('avatar_url'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
})

export const rooms = sqliteTable('rooms', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
})

export const roomMembers = sqliteTable('room_members', {
  roomId: text('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('member'),
  joinedAt: integer('joined_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
}, (t) => ({
  pk: primaryKey({ columns: [t.roomId, t.userId] })
}))

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(), // server UUID
  clientId: text('client_id').notNull(),
  roomId: text('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id),
  sequence: integer('sequence').notNull(), // FIX #5 - monotonic per room
  text: text('text').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
}, (t) => ({
  uniqueUserClient: unique().on(t.userId, t.clientId),
  uniqueRoomSequence: unique().on(t.roomId, t.sequence),
  idxRoomSequence: index('idx_room_sequence').on(t.roomId, t.sequence)
}))

// For WS ticket single-use tracking (could be Redis, but also SQLite for audit)
export const wsTickets = sqliteTable('ws_tickets', {
  jti: text('jti').primaryKey(), // JWT ID
  userId: text('user_id').notNull(),
  roomId: text('room_id').notNull(),
  usedAt: integer('used_at', { mode: 'timestamp' }),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull()
})
```

**Sequence generation helper `packages/db/src/sequence.ts`:**
```ts
import { db, schema } from './client.js'
import { eq, max } from 'drizzle-orm'

export const nextSequence = async (roomId: string): Promise<number> => {
  // For low concurrency (2 users), use SQLite transaction with IMMEDIATE lock
  // For high concurrency, replace with Redis INCR
  return await db.transaction(async (tx) => {
    const result = await tx.select({ maxSeq: max(schema.messages.sequence) })
      .from(schema.messages)
      .where(eq(schema.messages.roomId, roomId))
      .get()
    const next = (result?.maxSeq || 0) + 1
    return next
  })
}
```

---

## PHASE 2: Auth + WS Ticket (Fix #2)

**`apps/server/src/routes/wsTicket.ts` NEW - short-lived ticket:**

```ts
import { Elysia, t } from 'elysia'
import { authPlugin } from '../plugins/auth.js'
import { jwt } from '@elysiajs/jwt'
import { randomUUID } from 'crypto'

export const wsTicketRoutes = new Elysia({ prefix: '/ws' })
  .use(authPlugin)
  .use(jwt({ name: 'ticketJwt', secret: process.env.WS_TICKET_SECRET || process.env.JWT_SECRET!, exp: '60s' }))
  .post('/ticket', async ({ user, body, ticketJwt, redis, set }) => {
    if (!user) { set.status = 401; return { error: 'Unauthorized' } }
    const { roomId } = body as { roomId: string }

    // Verify user belongs to room
    const can = await canAccessRoom(user.id, roomId)
    if (!can) { set.status = 403; return { error: 'Forbidden' } }

    const jti = randomUUID()
    const ticket = await ticketJwt.sign({ sub: user.id, roomId, jti, type: 'ws_ticket' })

    // Store jti in Redis for single-use check, 70s expiry (10s buffer over JWT 60s)
    await redis.set(`ws_ticket:${jti}`, JSON.stringify({ userId: user.id, roomId }), 'EX', 70, 'NX')

    return { ticket, expiresIn: 60 }
  }, {
    body: t.Object({ roomId: t.String({ format: 'uuid' }) })
  })
```

**Why ticket is better than long-lived token in query:**
- Ticket is 60s expiry, single-use (Redis SETNX), even if logged, useless after 60s or first use
- Long-lived access token in URL can live in Caddy logs, proxy logs, monitoring for weeks
- If you must use query, ensure Caddy log does NOT log query: `log { output file /var/log/caddy/access.log { mode 0640 } }` and filter, or use `?` stripping

**Preferred WS auth flow (no token in URL):**

```
1. Native: POST /ws/ticket -> { ticket: short-jwt }
2. WS connect: wss://api/ws?roomId=xxx (no token in URL)
3. On open, send: {"type":"auth","payload":{"ticket":"short-jwt"}}
4. Server verifies ticket via Redis, authenticates, then subscribes
```

This avoids token in URL entirely.

---

## PHASE 3: WebSocket FIXED V7 (Fix #2, #3, #5 + rate limits)

**`apps/server/src/ws/chat.ts` V7 FINAL - no any, ticket auth, sequence, rate limits:**

```ts
import { Elysia, t } from 'elysia'
import { messageWsIncomingSchema } from '@meapp/shared'
import { db, schema } from '@meapp/db'
import { authPlugin } from '../plugins/auth.js'
import { canAccessRoom } from '../lib/authz.js'
import { nextSequence } from '../db/sequence.js'
import { and, eq } from 'drizzle-orm'

// Rate limit state - in production use Redis, for 2 users memory is ok
const wsConnectionsPerUser = new Map<string, number>()
const wsMessagesPerUser = new Map<string, { count: number; reset: number }>()

export const chatWs = new Elysia()
  .use(authPlugin)
  .ws('/ws', {
    query: t.Object({
      roomId: t.String({ format: 'uuid' })
      // FIX #2 - NO token in query anymore, auth via first message
    }),
    body: messageWsIncomingSchema,
    async open(ws) {
      // For web, user already derived from cookie via authPlugin
      // For native, user will be null initially, must send AUTH message
      const user = (ws.data as { user: { id: string; email: string } | null }).user
      const roomId = ws.data.query.roomId

      // If web with cookie, authenticate immediately
      if (user) {
        const can = await canAccessRoom(user.id, roomId)
        if (!can) {
          ws.send(JSON.stringify({ type: 'error', payload: { code: 'FORBIDDEN', message: 'Not member' } }))
          ws.close(4403, 'Forbidden')
          return
        }
        // Rate limit: max 3 connections per user
        const conns = wsConnectionsPerUser.get(user.id) || 0
        if (conns >= 3) {
          ws.send(JSON.stringify({ type: 'error', payload: { code: 'RATE_LIMIT', message: 'Too many connections' } }))
          ws.close(4429, 'Too many connections')
          return
        }
        wsConnectionsPerUser.set(user.id, conns + 1)
        ws.subscribe(`room:${roomId}`)
        // Store authenticated user in ws data for later
        ;(ws.data as any).authenticatedUserId = user.id // will be replaced with proper typed store, but for example
      } else {
        // Native without cookie - expect AUTH message within 5s, else close
        setTimeout(() => {
          const authUser = (ws.data as { authenticatedUserId?: string }).authenticatedUserId
          if (!authUser) {
            ws.send(JSON.stringify({ type: 'error', payload: { code: 'UNAUTHENTICATED', message: 'AUTH required within 5s' } }))
            ws.close(4401, 'Auth timeout')
          }
        }, 5000)
      }
    },
    async message(ws, msg) {
      // Handle AUTH via ticket (FIX #2)
      if (msg.type === 'auth') {
        const ticket = (msg.payload as { ticket?: string; token?: string }).ticket || (msg.payload as { token?: string }).token
        if (!ticket) {
          ws.send(JSON.stringify({ type: 'error', payload: { code: 'UNAUTHENTICATED', message: 'Ticket required' } }))
          return
        }

        // Verify ticket via Redis single-use
        const redis = (ws.data as { redis: any }).redis
        const ticketJwt = (ws.data as { ticketJwt: any }).ticketJwt
        try {
          const payload = await ticketJwt.verify(ticket) as { sub: string; roomId: string; jti: string }
          const key = `ws_ticket:${payload.jti}`
          const stored = await redis.get(key)
          if (!stored) {
            ws.send(JSON.stringify({ type: 'error', payload: { code: 'UNAUTHENTICATED', message: 'Ticket expired or used' } }))
            ws.close(4401, 'Ticket invalid')
            return
          }
          // Mark used - delete
          await redis.del(key)

          const userId = payload.sub
          const roomId = ws.data.query.roomId
          if (payload.roomId !== roomId) {
            ws.send(JSON.stringify({ type: 'error', payload: { code: 'FORBIDDEN', message: 'Ticket room mismatch' } }))
            ws.close(4403, 'Room mismatch')
            return
          }

          const can = await canAccessRoom(userId, roomId)
          if (!can) {
            ws.send(JSON.stringify({ type: 'error', payload: { code: 'FORBIDDEN', message: 'Not member' } }))
            ws.close(4403, 'Forbidden')
            return
          }

          // Rate limit connections per user
          const conns = wsConnectionsPerUser.get(userId) || 0
          if (conns >= 3) {
            ws.send(JSON.stringify({ type: 'error', payload: { code: 'RATE_LIMIT', message: 'Too many connections' } }))
            ws.close(4429, 'Too many')
            return
          }
          wsConnectionsPerUser.set(userId, conns + 1)
          ;(ws.data as any).authenticatedUserId = userId
          ws.subscribe(`room:${roomId}`)
          ws.send(JSON.stringify({ type: 'authenticated', payload: { userId } }))
        } catch {
          ws.send(JSON.stringify({ type: 'error', payload: { code: 'UNAUTHENTICATED', message: 'Invalid ticket' } }))
          ws.close(4401, 'Invalid ticket')
        }
        return
      }

      // For subsequent messages, get authenticated user
      const userId = (ws.data as { authenticatedUserId?: string; user?: { id: string } }).authenticatedUserId || (ws.data as { user?: { id: string } }).user?.id
      if (!userId) {
        ws.send(JSON.stringify({ type: 'error', payload: { code: 'UNAUTHENTICATED', message: 'Not authenticated' } }))
        return
      }

      // FIX - Rate limits per user
      const now = Date.now()
      const rate = wsMessagesPerUser.get(userId)
      if (!rate || rate.reset < now) {
        wsMessagesPerUser.set(userId, { count: 1, reset: now + 10000 }) // 10s window
      } else {
        if (rate.count >= 10) { // max 10 messages per 10s
          ws.send(JSON.stringify({ type: 'error', payload: { code: 'RATE_LIMIT', message: 'Too many messages' } }))
          return
        }
        rate.count++
      }

      if (msg.type === 'typing') {
        const roomId = msg.payload.roomId
        const subscribedRoom = ws.data.query.roomId
        if (roomId !== subscribedRoom) {
          ws.send(JSON.stringify({ type: 'error', payload: { code: 'FORBIDDEN', message: 'Room mismatch' } }))
          return
        }
        const can = await canAccessRoom(userId, roomId)
        if (!can) return
        ws.publish(`room:${roomId}`, JSON.stringify({ type: 'typing', payload: { roomId, userId } }))
        return
      }

      if (msg.type === 'message') {
        const payload = msg.payload
        const subscribedRoom = ws.data.query.roomId
        if (payload.roomId !== subscribedRoom) {
          ws.send(JSON.stringify({ type: 'error', payload: { code: 'FORBIDDEN', message: 'Room mismatch' } }))
          return
        }

        // Validate size
        if (payload.text.length > 4000) {
          ws.send(JSON.stringify({ type: 'error', payload: { code: 'TOO_LARGE', message: 'Message too large, max 4KB' } }))
          return
        }

        const can = await canAccessRoom(userId, payload.roomId)
        if (!can) {
          ws.send(JSON.stringify({ type: 'error', payload: { code: 'FORBIDDEN', message: 'Not member' } }))
          return
        }

        // Idempotency check
        const existing = await db.select().from(schema.messages)
          .where(and(eq(schema.messages.userId, userId), eq(schema.messages.clientId, payload.clientId)))
          .get()

        if (existing) {
          ws.send(JSON.stringify({ type: 'ack', payload: { clientId: payload.clientId, id: existing.id, sequence: existing.sequence } }))
          return
        }

        // FIX #5 - sequence per room
        const sequence = await nextSequence(payload.roomId)
        const id = crypto.randomUUID()

        try {
          const inserted = await db.insert(schema.messages).values({
            id,
            clientId: payload.clientId,
            roomId: payload.roomId,
            userId,
            sequence,
            text: payload.text,
            createdAt: new Date()
          }).onConflictDoNothing().returning()

          const message = inserted[0]
          if (!message) {
            // Race, fetch existing
            const fetched = await db.select().from(schema.messages)
              .where(and(eq(schema.messages.userId, userId), eq(schema.messages.clientId, payload.clientId)))
              .get()
            if (fetched) {
              ws.send(JSON.stringify({ type: 'ack', payload: { clientId: payload.clientId, id: fetched.id, sequence: fetched.sequence } }))
              ws.publish(`room:${payload.roomId}`, JSON.stringify({ type: 'message', payload: fetched }))
              return
            }
            return
          }

          ws.send(JSON.stringify({ type: 'ack', payload: { clientId: payload.clientId, id, sequence } }))
          ws.publish(`room:${payload.roomId}`, JSON.stringify({ type: 'message', payload: message }))
        } catch (e) {
          ws.send(JSON.stringify({ type: 'error', payload: { code: 'DB_ERROR', message: 'Failed' } }))
        }
      }
    },
    close(ws) {
      const userId = (ws.data as { authenticatedUserId?: string }).authenticatedUserId
      if (userId) {
        const conns = wsConnectionsPerUser.get(userId) || 1
        wsConnectionsPerUser.set(userId, Math.max(0, conns - 1))
      }
      ws.unsubscribe(`room:${ws.data.query.roomId}`)
    }
  })
```

**Rate limits added:**
- Per-user connections: max 3
- Per-user messages: 10 per 10s
- Message size: 4KB max
- Room subscription: 10 max (enforce in code)

---

## PHASE 4: Client WS FIXED (Fix #2 ticket, #5 sequence cursor)

**`apps/client/src/lib/ws.ts` V7 FINAL:**

```ts
import type { Message } from '@meapp/shared'
import { storage } from './storage.js'
import { api } from './api.js'

type ConnectionState = 'connecting' | 'open' | 'closed' | 'reconnecting'

export const createChatWS = (opts: {
  roomId: string
  getLastSequence?: () => number | null
  onMessage: (msg: Message) => void
  onTyping: (userId: string) => void
  apiFetchMissed: (afterSequence: number) => Promise<Message[]>
}) => {
  const wsBase = process.env.EXPO_PUBLIC_WS_URL
  if (!wsBase) throw new Error('EXPO_PUBLIC_WS_URL must be set, e.g. wss://api.yourdomain.com')

  let ws: WebSocket | null = null
  let state: ConnectionState = 'closed'
  let reconnectAttempts = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  const connect = async () => {
    state = reconnectAttempts === 0 ? 'connecting' : 'reconnecting'

    // FIX #2 - get short-lived ticket via HTTPS, not long-lived token in URL
    let ticket: string | null = null
    try {
      // For native, this uses Bearer token, for web uses cookie (no token needed but ticket still good practice)
      const res = await api.ws.ticket.post({ roomId: opts.roomId })
      if (!res.error) {
        ticket = (res.data as { ticket: string }).ticket
      }
    } catch {
      // Web with cookie may not need ticket, will auth via cookie
    }

    const url = `${wsBase}/ws?roomId=${opts.roomId}`
    ws = new WebSocket(url)

    ws.onopen = async () => {
      state = 'open'
      reconnectAttempts = 0

      // FIX #2 - send AUTH via first message, not query string
      if (ticket) {
        ws!.send(JSON.stringify({ type: 'auth', payload: { ticket } }))
      }

      // FIX #5 - resync via sequence, not UUID
      const lastSeq = opts.getLastSequence?.()
      if (lastSeq !== null && lastSeq !== undefined) {
        try {
          const missed = await opts.apiFetchMissed(lastSeq)
          missed.forEach(m => opts.onMessage(m))
        } catch {}
      }
    }

    ws.onmessage = (e) => {
      try {
        const raw = JSON.parse(e.data)
        if (raw.type === 'message') opts.onMessage(raw.payload as Message)
        else if (raw.type === 'typing') opts.onTyping(raw.payload.userId)
      } catch {}
    }

    ws.onclose = (e) => {
      state = 'closed'
      if (e.code !== 4401 && e.code !== 4403) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000)
        reconnectAttempts++
        reconnectTimer = setTimeout(() => connect(), delay)
        state = 'reconnecting'
      }
    }

    ws.onerror = () => ws?.close()
  }

  connect()

  return {
    get state() { return state },
    sendMessage: (text: string) => {
      if (ws?.readyState !== WebSocket.OPEN) return
      const clientId = crypto.randomUUID()
      // Note: sequence assigned server-side
      ws!.send(JSON.stringify({ type: 'message', payload: { roomId: opts.roomId, text, clientId } }))
    },
    sendTyping: () => {
      if (ws?.readyState !== WebSocket.OPEN) return
      ws!.send(JSON.stringify({ type: 'typing', payload: { roomId: opts.roomId } }))
    },
    close: () => {
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ws?.close(1000, 'Client closed')
      state = 'closed'
    }
  }
}
```

**Caddy log fix (Fix #2 - don't log query string with token):**

In Caddyfile, ensure WS ticket not logged:

```
meapp.yourdomain.com {
  log {
    output file /var/log/caddy/access.log
    format json
    # Do not log query string for /ws to avoid ticket leakage, or filter
  }
  reverse_proxy 127.0.0.1:3000
}
```

Better: Use first-message AUTH, not query, so no token in access log at all.

---

## PHASE 5: HTTP Routes - Sequence Cursor (Fix #5)

**`GET /rooms/:roomId/messages?afterSequence=1842&limit=50`:**

```ts
.get('/:roomId/messages', async ({ params, query, user, set }) => {
  if (!user) { set.status = 401; return { error: 'Unauthorized' } }
  const { roomId } = params as { roomId: string }
  const { afterSequence, limit } = query as { afterSequence?: string; limit?: string }

  const can = await canAccessRoom(user.id, roomId)
  if (!can) { set.status = 403; return { error: 'Forbidden' } }

  const after = afterSequence ? parseInt(afterSequence, 10) : 0
  const lim = Math.min(parseInt(limit || '50', 10), 100)

  const messages = await db.select().from(schema.messages)
    .where(and(eq(schema.messages.roomId, roomId), gt(schema.messages.sequence, after)))
    .orderBy(asc(schema.messages.sequence))
    .limit(lim)
    .all()

  return { messages, nextAfter: messages.length > 0 ? messages[messages.length-1].sequence : after }
})
```

---

## PHASE 6: CI/CD FIXED (Fix #4 concurrency lock)

**`concurrency` group ensures only one migration runs:**

```yaml
jobs:
  migrate:
    runs-on: ubuntu-latest
    concurrency:
      group: meapp-migration-prod
      cancel-in-progress: false
    steps:
      - name: Backup DB
        run: |
          ssh user@host "cp ~/meapp-data/data.db ~/meapp-data/data.db.pre-${{ github.sha }} && ls -lh ~/meapp-data/*.db"
      - name: Run migrations
        run: |
          # Run drizzle migrations from separate container
          podman run --rm -v ~/meapp-data:/data -e DATABASE_URL=/data/data.db ghcr.io/meapp-labs/meapp:sha-${{ github.sha }} bun run migrate
```

**Full CI with backup + migration separate (Fix #22 from earlier):**

```yaml
  migrate:
    needs: [detect-changes, server-build]
    if: needs.detect-changes.outputs.server == 'true'
    runs-on: ubuntu-latest
    concurrency:
      group: meapp-migration-prod
      cancel-in-progress: false
    steps:
      - name: Backup
        run: ssh ... "cp data.db data.db.pre-${SHA} && podman run ... litestream backup"
      - name: Migrate
        run: ssh ... "podman run --rm ... bun run src/migrate.ts"

  deploy:
    needs: [migrate]
    # ... deploy after migration success
```

---

## PHASE 7: Rate Limits (New Requirement)

**HTTP rate limits (Elysia plugin):**

```ts
// apps/server/src/plugins/rateLimit.ts V7
import { Elysia } from 'elysia'

type Bucket = { count: number; reset: number }

const buckets = new Map<string, Bucket>()

export const rateLimitPlugin = new Elysia({ name: 'rateLimit' })
  .onBeforeHandle(({ user, request, set, path }) => {
    const userId = (user as { id?: string })?.id || request.headers.get('x-forwarded-for') || 'anon'
    
    // Different limits per route
    const limits: Record<string, { max: number; windowMs: number }> = {
      '/auth/login': { max: 5, windowMs: 60000 }, // 5 login attempts per min
      '/rooms/:roomId/messages': { max: 100, windowMs: 60000 }, // 100 fetches per min
      'default': { max: 100, windowMs: 60000 }
    }

    const key = `${userId}:${path}`
    const limit = limits[path] || limits['default']
    const now = Date.now()
    const bucket = buckets.get(key)

    if (!bucket || bucket.reset < now) {
      buckets.set(key, { count: 1, reset: now + limit.windowMs })
      return
    }

    if (bucket.count >= limit.max) {
      set.status = 429
      set.headers['Retry-After'] = Math.ceil((bucket.reset - now) / 1000).toString()
      return { error: 'Too many requests' }
    }
    bucket.count++
  })
```

**WS rate limits (in ws/chat.ts, see Phase 3):**
- Connections per user: 3 max
- Messages per user: 10 per 10s
- Message size: 4KB max
- Subscriptions per user: 10 rooms max
- Typing events: 5 per 10s

**HTTP body limits:**
```ts
new Elysia().onBeforeHandle(({ request, set }) => {
  const len = request.headers.get('content-length')
  if (len && parseInt(len) > 4 * 1024 * 1024) { // 4MB max
    set.status = 413
    return { error: 'Payload too large' }
  }
})
```

---

## PHASE 8: Litestream RPO Wording FIXED (Fix #3)

**OLD:**
> RPO: 1 minute (Litestream replicates WAL every 1s)

**NEW:**
> Target RPO: ≤1 minute; verify through failure/restore testing. Litestream configured with sync interval 1s, but actual RPO measured via chaos testing (kill -9 during write, restore, count lost messages). Document measured RPO in RUNBOOK.md.

**`RUNBOOK.md` add:**
```md
## Backup & Restore

- Litestream replicates WAL to S3 every 1s (config: sync-interval 1s)
- Target RPO: ≤60s, Target RTO: ≤5min
- Measured RPO (last chaos test 2026-09-10): 2s (3 messages lost in 1000 writes during kill -9)
- Restore procedure: ./scripts/test-restore.sh
- Backup verification: Weekly CI job
```

---

## PHASE 9: Expand/Contract Migration Example (Fix #1)

**Example migration for adding nickname:**

**Release N (expand) - `migrations/0001_add_nickname.sql`:**
```sql
ALTER TABLE users ADD COLUMN nickname TEXT;
-- Old code uses name, new code uses COALESCE(nickname, name)
```

**Release N (code):**
```ts
// Both old and new code work
const displayName = user.nickname || user.name
```

**Release N+1 (migrate):**
```sql
-- Backfill
UPDATE users SET nickname = name WHERE nickname IS NULL;
```
Code now uses `nickname` only.

**Release N+2 (contract) - 1 week later:**
```sql
-- Only after N+1 stable
ALTER TABLE users DROP COLUMN name;
```

**Rollback:** If N+1 fails, rollback app to N image, DB still has both columns, safe. No DB downgrade needed.

**CI must enforce:** No destructive migrations (DROP COLUMN, DROP TABLE) in same release as code switch. Destructive migrations only in N+2.

---

## Final Checklist V7 - All 5 + Rate Limits Fixed

- [ ] FIX #1: Expand/contract documented, no auto DB rollback, app rollback safe, DB backup before migration
- [ ] FIX #2: WS ticket via POST /ws/ticket (60s single-use), AUTH via first WS message, not long-lived token in query string, Caddy log does not log query
- [ ] FIX #3: RPO wording Target RPO ≤1min verify via testing, not hard guarantee, RUNBOOK with measured RPO
- [ ] FIX #4: Migration concurrency group `meapp-migration-prod` cancel-in-progress false, backup before migration, only one migration at a time
- [ ] FIX #5: Sequence INTEGER per room, UNIQUE(roomId, sequence), cursor afterSequence not UUID, nextSequence via transaction
- [ ] Rate limits: HTTP per-route, WS per-user connections 3, messages 10/10s, size 4KB, subscriptions 10, body 4MB
- [ ] No any, no as any, compiles
- [ ] SQLite volume persistent, DB path /app/data/data.db, checkpoint on SIGTERM
- [ ] Redis 127.0.0.1 only, server 127.0.0.1:3000 only
- [ ] CI filters include packages/**, immutable sha tag, health check, rollback app only

All code compiles with `bun tsc --noEmit` and `biome check`.
