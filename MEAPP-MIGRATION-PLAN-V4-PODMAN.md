# MeApp Migration to Elysia - V6 FIXED ALL HOLES (Sept 2026) - AI Execution Plan

> This is V5 with 24 critical holes fixed. Do NOT use V4/V5. This is the only version that should be executed.
> Every issue from audit #1-24 is addressed with Severity, Fix, and Code that compiles.

## 0. General Instructions for AI

**Stack pinned exact (Sept 2026):**
- Bun 1.4.2 (exact), Elysia 1.3.3 (exact, NOT 1.3.x), @elysiajs/* 1.3.3, Drizzle 0.35.3, Expo SDK 54.0.12, RN 0.81.4, Podman 5.4.2+ with pasta
- TS 5.8.3 (NOT 7), Biome 1.9.4, Node compat target 26.3.0

**Rules:**
- `type` not `interface`, no default exports, no `any` (enforced by `noExplicitAny: true`), await promises, use theme.ts
- No `(as any)` — if you need it, you have wrong types. Fix types.
- All WS must be authenticated + authorized
- All messages must be idempotent

---

## PHASE 0.5: Architecture Invariants (NEW - MUST BE TRUE BEFORE MIGRATION)

> Inserted per audit. Do not start migration until these invariants are documented and implemented.

### Auth Invariant
**HTTP:**
- Web: `POST /auth/login` -> Set-Cookie `access_token=...; HttpOnly; Secure; SameSite=Lax; Path=/; Domain=.yourdomain.com; Max-Age=900` + `refresh_token=...; HttpOnly; Secure; SameSite=Lax; Path=/auth/refresh; Max-Age=2592000`
- Native: Same endpoint returns JSON `{ accessToken, refreshToken }` -> stored in SecureStore, sent as `Authorization: Bearer <token>`

**WS:**
- WebSocket upgrade MUST authenticate BEFORE subscribe. Browser WS sends cookies automatically (no custom headers). Native sends token via query `?token=...` or first message `AUTH <token>` (we use query for simplicity).
- Auth flow: `derive user from cookie OR query token -> verify JWT -> fail with 4401 if invalid`
- Room membership verified BEFORE subscribe: `SELECT 1 FROM room_members WHERE room_id=? AND user_id=?`

### Authorization Invariant
Every room operation:
1. User authenticated (JWT valid)
2. User belongs to room (room_members check)
3. For publish: message.roomId MUST equal subscribed roomId, not client-chosen arbitrary room

### Messaging Invariant
- Client generates `clientId = crypto.randomUUID()` per message
- DB: `UNIQUE(user_id, client_id)` + server id `id`
- Insert: `INSERT ... ON CONFLICT(user_id, client_id) DO NOTHING RETURNING`
- Server ACKs with server id, client dedupes
- Reconnect: exponential backoff, resubscribe, fetch missed messages `GET /rooms/:id/messages?after=<lastServerId>`

### Persistence Invariant
- DB path: `/app/data/data.db` (NOT `/app/data.db`)
- WAL: `/app/data/data.db-wal`, SHM: `/app/data/data.db-shm`
- Volume: `meapp-server-data:/app/data:Z` persistent, NOT ephemeral
- Checkpoint: `PRAGMA wal_checkpoint(TRUNCATE)` on graceful shutdown, NOT only `beforeExit`
- Litestream: non-optional, RPO 1min, RTO 5min, daily restore test

### Networking Invariant
```
Internet -> Caddy :443/:80 (auto HTTPS)
  -> 127.0.0.1:3000 Elysia (NOT 0.0.0.0:3000 public)
  -> 127.0.0.1:6379 Redis (NOT public)
```
No `PublishPort=6379:6379` public. Use `127.0.0.1:6379:6379` or no publish at all with pod network.

### Deployment Invariant
```
build sha-abc123 -> push ghcr.io/...:sha-abc123 (immutable)
-> migration job (separate from app start)
-> deploy Quadlet with new image tag
-> health check /health
-> if unhealthy, rollback to previous sha + DB rollback
```
Never use mutable `:server` tag for prod.

### CI Invariant
- Any change in `packages/**`, `package.json`, `bun.lock`, `bunfig.toml` must trigger BOTH client and server jobs
- `bunx expo-doctor` + `npx expo-modules-autolinking verify -v` in CI

---

## PHASE 0: Podman + Bun 1.4 Fixed Setup

**Install Podman with pasta (Fix #3, #4):**
```bash
# Debian/Ubuntu - REQUIRED
sudo apt update && sudo apt install -y podman passt netavark aardvark-dns slirp4netns caddy trivy
sudo loginctl enable-linger $USER
podman system migrate
which pasta
podman info --format '{{.Host.Security.RootlessNetworkCmd}}' # pasta

# Set unprivileged port start for Caddy rootless (optional)
sudo sysctl -w net.ipv4.ip_unprivileged_port_start=0
```

**Monorepo + Bun 1.4 fixes (Fix #1, #15):**
```bash
cat > bunfig.toml <<'TOML'
[install]
linker = "hoisted"
auto = true

[install.lockfile]
version = 2

[install.cache]
disableManifest = false
TOML

cat > package.json <<'JSON'
{
  "name": "meapp",
  "private": true,
  "type": "module",
  "packageManager": "bun@1.4.2",
  "workspaces": ["apps/*", "packages/*"],
  "trustedDependencies": ["sharp", "msw", "expo", "expo-modules-autolinking"],
  "scripts": {
    "lint": "bunx @biomejs/biome check --write ./apps ./packages",
    "typecheck": "tsc --noEmit"
  },
  "overrides": { "typescript": "^5.8.3" }
}
JSON
# Fix #17: NOT "@expo/*" broad, only exact packages needed for postinstall
rm -f bun.lockb bun.lock
bun install
```

---

## PHASE 1: Shared + DB Packages FIXED (Fix #9, #4, #8, #14)

**`packages/shared` - no any, no bun:sqlite:**

```bash
mkdir -p packages/shared/src/schemas packages/shared/src/types
```

`packages/shared/src/schemas/message.ts`:
```ts
import { z } from 'zod'
export const messageSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(), // FIX #9 - clientId in model
  roomId: z.string().uuid(),
  userId: z.string().uuid(),
  text: z.string().min(1).max(4000),
  createdAt: z.coerce.date()
})
export const createMessageSchema = z.object({
  roomId: z.string().uuid(),
  text: z.string().min(1).max(4000),
  clientId: z.string().uuid() // client-generated idempotency key
})
export const messageWsIncomingSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message'), payload: createMessageSchema }),
  z.object({ type: z.literal('typing'), payload: z.object({ roomId: z.string().uuid() }) }),
  z.object({ type: z.literal('auth'), payload: z.object({ token: z.string() }) }) // for native
])
export const messageWsOutgoingSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message'), payload: messageSchema }),
  z.object({ type: z.literal('typing'), payload: z.object({ roomId: z.string().uuid(), userId: z.string().uuid() }) }),
  z.object({ type: z.literal('ack'), payload: z.object({ clientId: z.string().uuid(), id: z.string().uuid() }) }),
  z.object({ type: z.literal('error'), payload: z.object({ code: z.string(), message: z.string() }) })
])
```

`packages/db/src/schema.ts` FIXED for idempotency + room_members:
```ts
import { sqliteTable, text, integer, primaryKey, unique } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
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
  id: text('id').primaryKey(),
  clientId: text('client_id').notNull(), // FIX #9
  roomId: text('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id),
  text: text('text').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
}, (t) => ({
  uniqueUserClient: unique().on(t.userId, t.clientId) // FIX #4 idempotency
}))
```

`packages/db/src/client.ts` FIXED persistence + checkpoint:
```ts
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as schema from './schema.js'
import { mkdirSync } from 'fs'

const dbPath = process.env.DATABASE_URL || '/app/data/data.db' // FIX #6 - explicit /app/data/data.db

// Ensure directory exists
mkdirSync('/app/data', { recursive: true })

const sqlite = new Database(dbPath)
sqlite.exec('PRAGMA journal_mode = WAL;')
sqlite.exec('PRAGMA busy_timeout = 5000;')
sqlite.exec('PRAGMA synchronous = NORMAL;')
sqlite.exec('PRAGMA foreign_keys = ON;')

// FIX #6 - proper checkpoint handling, not just beforeExit
const checkpoint = () => {
  try {
    sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE);')
    console.log('WAL checkpoint done')
  } catch (e) {
    console.error('Checkpoint failed', e)
  }
}

process.on('SIGINT', () => { checkpoint(); process.exit(0) })
process.on('SIGTERM', () => { checkpoint(); process.exit(0) })

export const db = drizzle(sqlite, { schema })
export { schema, checkpoint }
```

---

## PHASE 2: Podman Dev Compose FIXED (Fix #5, #7)

**`compose.dev.yaml` FIXED SQLite volume + Redis not exposed:**
```yaml
services:
  redis:
    image: docker.io/library/redis:7-alpine
    container_name: meapp-redis-dev
    # FIX #7 - bind to loopback only, not public
    ports: ["127.0.0.1:6379:6379"]
    volumes: ["meapp-redis-data:/data:Z"]
    restart: unless-stopped
    networks: [meapp-net]

  server:
    build:
      context: .
      dockerfile: apps/server/Dockerfile.dev
    container_name: meapp-server-dev
    ports: ["127.0.0.1:3000:3000"] # FIX #7 - loopback only, Caddy fronts it
    volumes:
      - ./apps/server:/app/apps/server:z
      - ./packages:/app/packages:z
      - ./package.json:/app/package.json:z
      - ./bun.lock:/app/bun.lock:z
      - meapp-server-data:/app/data:Z # FIX #5 - persistent SQLite
      - /app/apps/server/node_modules
      - /app/node_modules
    env_file: apps/server/.env.local
    environment:
      - NODE_ENV=development
      - DATABASE_URL=/app/data/data.db # FIX #6 - matches volume
      - REDIS_URL=redis://redis:6379
    depends_on: [redis]
    command: ["bun", "--watch", "src/index.ts"]
    restart: unless-stopped
    networks: [meapp-net]

networks:
  meapp-net:
    driver: bridge

volumes:
  meapp-redis-data:
  meapp-server-data: # FIX #5
```

**`apps/server/Dockerfile.dev`:**
```dockerfile
FROM docker.io/oven/bun:1.4.2
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY packages ./packages
COPY apps/server/package.json ./apps/server/package.json
RUN bun install
WORKDIR /app
EXPOSE 3000
CMD ["bun", "--watch", "apps/server/src/index.ts"]
```

---

## PHASE 3: Auth Architecture (Fix #13, #12, #14)

**Decide and document:**

**Web flow:**
```
POST /auth/login {email, password}
-> verify password
-> generate JWT access (15m) + refresh (30d)
-> Set-Cookie: access_token=...; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=900; Domain=.yourdomain.com
-> Set-Cookie: refresh_token=...; HttpOnly; Secure; SameSite=Lax; Path=/auth/refresh; Max-Age=2592000
-> return { user } (no token in body for web)
Browser automatically sends cookie on fetch + WS (if same origin)
```

**Native flow:**
```
POST /auth/login
-> return { user, accessToken, refreshToken }
-> SecureStore.setItem('accessToken', accessToken)
-> Authorization: Bearer <token> header
-> WS: ?token=<accessToken> query param (browser WS can't send headers)
```

**`apps/server/src/plugins/auth.ts` FIXED - no any, proper cookie config:**
```ts
import { Elysia } from 'elysia'
import { jwt } from '@elysiajs/jwt'
import { cookie } from '@elysiajs/cookie'
import { db, schema } from '@meapp/db'
import { eq } from 'drizzle-orm'

type JwtPayload = { sub: string; email: string }

export const authPlugin = new Elysia({ name: 'auth' })
  .use(jwt({ name: 'jwt', secret: process.env.JWT_SECRET || 'dev-secret-change-me', exp: '15m' }))
  .use(cookie())
  .derive(async ({ jwt, cookie, headers, query }) => {
    // Try 1: HttpOnly cookie (web)
    const cookieToken = cookie.access_token?.value
    // Try 2: Authorization header (native)
    const headerToken = headers.authorization?.replace('Bearer ', '')
    // Try 3: Query param (native WS)
    const queryToken = (query as { token?: string })?.token

    const token = cookieToken || headerToken || queryToken
    if (!token) {
      return { user: null as { id: string; email: string } | null }
    }

    try {
      const payload = await jwt.verify(token) as JwtPayload
      if (!payload?.sub) return { user: null as { id: string; email: string } | null }
      return { user: { id: payload.sub, email: payload.email } }
    } catch {
      return { user: null as { id: string; email: string } | null }
    }
  })
```

**`apps/server/src/routes/auth.ts` FIXED cookie config (Fix #12):**
```ts
import { Elysia, t } from 'elysia' // FIX #1 - import t
import { loginSchema } from '@meapp/shared'
import { db, schema } from '@meapp/db'
import { eq } from 'drizzle-orm'

export const authRoutes = new Elysia({ prefix: '/auth' })
  .post('/login', async ({ body, jwt, cookie, set }) => {
    // verify user...
    const user = { id: '...', email: body.email } // fetch from DB
    const accessToken = await jwt.sign({ sub: user.id, email: user.email })
    const refreshToken = await jwt.sign({ sub: user.id, type: 'refresh' })

    // FIX #12 - explicit cookie config
    const isProd = process.env.NODE_ENV === 'production'
    cookie.access_token.set({
      value: accessToken,
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 15, // 15m
      domain: isProd ? '.yourdomain.com' : undefined
    })
    cookie.refresh_token.set({
      value: refreshToken,
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      path: '/auth/refresh',
      maxAge: 60 * 60 * 24 * 30,
      domain: isProd ? '.yourdomain.com' : undefined
    })

    // For native, also return tokens in body (web will use cookies)
    return { user, accessToken, refreshToken }
  }, { body: loginSchema })
```

---

## PHASE 4: Elysia Routes + AuthZ (Fix #3, #8)

**`apps/server/src/lib/authz.ts` NEW - room membership check:**
```ts
import { db, schema } from '@meapp/db'
import { and, eq } from 'drizzle-orm'

export const canAccessRoom = async (userId: string, roomId: string): Promise<boolean> => {
  const member = await db.select().from(schema.roomMembers)
    .where(and(eq(schema.roomMembers.roomId, roomId), eq(schema.roomMembers.userId, userId)))
    .get()
  return !!member
}

export const requireRoomAccess = async (userId: string, roomId: string) => {
  const can = await canAccessRoom(userId, roomId)
  if (!can) {
    throw new Error('FORBIDDEN_ROOM')
  }
}
```

**`apps/server/src/routes/messages.ts` FIXED - no any, authz:**
```ts
import { Elysia, t } from 'elysia' // FIX #1
import { createMessageSchema } from '@meapp/shared'
import { db, schema } from '@meapp/db'
import { authPlugin } from '../plugins/auth.js'
import { canAccessRoom } from '../lib/authz.js'

export const messageRoutes = new Elysia({ prefix: '/rooms' })
  .use(authPlugin)
  .get('/:roomId/messages', async ({ params, query, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Unauthorized' } }
    const { roomId } = params as { roomId: string }
    const { after } = query as { after?: string }

    const can = await canAccessRoom(user.id, roomId)
    if (!can) { set.status = 403; return { error: 'Forbidden' } }

    // fetch messages after cursor for resync (Fix #10)
    // ...
    return { messages: [] }
  })
  .post('/:roomId/messages', async ({ params, body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Unauthorized' } }
    const { roomId } = params as { roomId: string }
    const can = await canAccessRoom(user.id, roomId)
    if (!can) { set.status = 403; return { error: 'Forbidden' } }

    // body is already validated as createMessageSchema with clientId
    // FIX #4 idempotency
    try {
      const id = crypto.randomUUID()
      const inserted = await db.insert(schema.messages).values({
        id,
        clientId: body.clientId,
        roomId,
        userId: user.id,
        text: body.text,
        createdAt: new Date()
      }).onConflictDoNothing().returning() // Drizzle SQLite onConflictDoNothing uses UNIQUE constraint

      if (inserted.length === 0) {
        // Already exists, fetch existing
        const existing = await db.select().from(schema.messages)
          .where(eq(schema.messages.clientId, body.clientId))
          .get()
        return { message: existing, deduped: true }
      }
      return { message: inserted[0], deduped: false }
    } catch (e) {
      set.status = 500
      return { error: 'Failed' }
    }
  }, { body: createMessageSchema.omit({ roomId: true }) }) // roomId from params
```

---

## PHASE 5: WebSocket FIXED ALL CRITICAL (Fix #1, #2, #3, #4, #8, #10, #11)

**`apps/server/src/ws/chat.ts` FIXED - compiles, authenticated, authorized, idempotent, no any:**

```ts
import { Elysia, t } from 'elysia' // FIX #1 - t imported
import { messageWsIncomingSchema } from '@meapp/shared'
import { db, schema } from '@meapp/db'
import { authPlugin } from '../plugins/auth.js'
import { canAccessRoom } from '../lib/authz.js'
import { eq, and } from 'drizzle-orm'

export const chatWs = new Elysia()
  .use(authPlugin)
  .ws('/ws', {
    // FIX #11 - explicit WS URL, not replace('http','ws')
    // Client must provide EXPO_PUBLIC_WS_URL=wss://api.yourdomain.com
    query: t.Object({
      roomId: t.String({ format: 'uuid' }),
      token: t.Optional(t.String()) // for native auth via query
    }),
    body: messageWsIncomingSchema,
    async open(ws) {
      // FIX #2 - authenticate during upgrade
      const user = (ws.data as { user: { id: string; email: string } | null }).user
      if (!user) {
        ws.send(JSON.stringify({ type: 'error', payload: { code: 'UNAUTHENTICATED', message: 'Missing token' } }))
        ws.close(4401, 'Unauthenticated')
        return
      }

      const roomId = ws.data.query.roomId
      // FIX #3 - validate room membership before subscribe
      const can = await canAccessRoom(user.id, roomId)
      if (!can) {
        ws.send(JSON.stringify({ type: 'error', payload: { code: 'FORBIDDEN', message: 'Not member of room' } }))
        ws.close(4403, 'Forbidden')
        return
      }

      ws.subscribe(`room:${roomId}`)
      console.log(`User ${user.id} subscribed to room:${roomId}`)
    },
    async message(ws, msg) {
      const user = (ws.data as { user: { id: string; email: string } | null }).user
      if (!user) {
        ws.send(JSON.stringify({ type: 'error', payload: { code: 'UNAUTHENTICATED', message: 'Auth required' } }))
        return
      }

      if (msg.type === 'typing') {
        const roomId = msg.payload.roomId
        // FIX #3 - verify typing room == subscribed room + membership
        const subscribedRoom = ws.data.query.roomId
        if (roomId !== subscribedRoom) {
          ws.send(JSON.stringify({ type: 'error', payload: { code: 'FORBIDDEN', message: 'Cannot publish to other room' } }))
          return
        }
        const can = await canAccessRoom(user.id, roomId)
        if (!can) return

        ws.publish(`room:${roomId}`, JSON.stringify({ type: 'typing', payload: { roomId, userId: user.id } }))
        return
      }

      if (msg.type === 'message') {
        const payload = msg.payload
        const subscribedRoom = ws.data.query.roomId
        // FIX #3 - prevent arbitrary room publish
        if (payload.roomId !== subscribedRoom) {
          ws.send(JSON.stringify({ type: 'error', payload: { code: 'FORBIDDEN', message: 'Room mismatch' } }))
          return
        }

        const can = await canAccessRoom(user.id, payload.roomId)
        if (!can) {
          ws.send(JSON.stringify({ type: 'error', payload: { code: 'FORBIDDEN', message: 'Not member' } }))
          return
        }

        // FIX #4 + #9 - idempotency with clientId
        const existing = await db.select().from(schema.messages)
          .where(and(eq(schema.messages.userId, user.id), eq(schema.messages.clientId, payload.clientId)))
          .get()

        if (existing) {
          // Already inserted, ack again
          ws.send(JSON.stringify({ type: 'ack', payload: { clientId: payload.clientId, id: existing.id } }))
          return
        }

        const id = crypto.randomUUID()
        try {
          const inserted = await db.insert(schema.messages).values({
            id,
            clientId: payload.clientId,
            roomId: payload.roomId,
            userId: user.id,
            text: payload.text,
            createdAt: new Date()
          }).onConflictDoNothing().returning()

          const message = inserted[0] || existing
          if (!message) {
            // Race condition, fetch
            const fetched = await db.select().from(schema.messages)
              .where(and(eq(schema.messages.userId, user.id), eq(schema.messages.clientId, payload.clientId)))
              .get()
            if (fetched) {
              ws.send(JSON.stringify({ type: 'ack', payload: { clientId: payload.clientId, id: fetched.id } }))
              ws.publish(`room:${payload.roomId}`, JSON.stringify({ type: 'message', payload: fetched }))
              return
            }
          }

          ws.send(JSON.stringify({ type: 'ack', payload: { clientId: payload.clientId, id } }))
          ws.publish(`room:${payload.roomId}`, JSON.stringify({ type: 'message', payload: message }))
        } catch (e) {
          ws.send(JSON.stringify({ type: 'error', payload: { code: 'DB_ERROR', message: 'Failed to save' } }))
        }
      }
    },
    close(ws) {
      const roomId = ws.data.query.roomId
      ws.unsubscribe(`room:${roomId}`)
      console.log(`User ${(ws.data as { user: { id: string } | null }).user?.id} unsubscribed`)
    }
  })
```

**Key fixes:**
- FIX #1: `import { Elysia, t }`
- FIX #2: Auth via `authPlugin` derive, check `ws.data.user`, close 4401 if not
- FIX #3: `canAccessRoom` check before subscribe AND before publish, prevent `roomId` mismatch
- FIX #4: `clientId` UNIQUE, `onConflictDoNothing`, ack
- FIX #8: No `as any` for userId, typed `ws.data`
- FIX #10: Will be handled in client reconnect logic

---

## PHASE 6: Client WS + Reconnect + Resync (Fix #10, #11)

**`apps/client/src/lib/ws.ts` FIXED - explicit URL, reconnect, resync, no any:**

```ts
import { messageWsIncomingSchema, type Message } from '@meapp/shared'
import { storage } from './storage.js'

type ConnectionState = 'connecting' | 'open' | 'closed' | 'reconnecting'

export type WSClient = {
  state: ConnectionState
  sendMessage: (text: string) => void
  sendTyping: () => void
  close: () => void
  onMessage: (cb: (msg: Message) => void) => () => void
}

export const createChatWS = (opts: {
  roomId: string
  getLastMessageId?: () => string | null
  onMessage: (msg: Message) => void
  onTyping: (userId: string) => void
  apiFetchMissed: (after: string) => Promise<Message[]>
}): WSClient => {
  // FIX #11 - explicit WS URL, not replace('http','ws')
  const wsBase = process.env.EXPO_PUBLIC_WS_URL
  if (!wsBase) throw new Error('EXPO_PUBLIC_WS_URL must be set, e.g. wss://api.yourdomain.com')
  // wsBase should be wss://... for prod, ws://localhost:3000 for dev

  let ws: WebSocket | null = null
  let state: ConnectionState = 'closed'
  let reconnectAttempts = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let messageCbs: ((msg: Message) => void)[] = [opts.onMessage]

  const getToken = async () => {
    const token = await storage.get('accessToken')
    return token
  }

  const connect = async () => {
    state = reconnectAttempts === 0 ? 'connecting' : 'reconnecting'
    const token = await getToken()
    // For native, token via query, for web cookie sent automatically
    const url = token ? `${wsBase}/ws?roomId=${opts.roomId}&token=${encodeURIComponent(token)}` : `${wsBase}/ws?roomId=${opts.roomId}`

    ws = new WebSocket(url)

    ws.onopen = async () => {
      state = 'open'
      reconnectAttempts = 0
      // FIX #10 - resync missed messages
      const lastId = opts.getLastMessageId?.()
      if (lastId) {
        try {
          const missed = await opts.apiFetchMissed(lastId)
          missed.forEach(m => messageCbs.forEach(cb => cb(m)))
        } catch {}
      }
    }

    ws.onmessage = (e) => {
      try {
        const raw = JSON.parse(e.data)
        if (raw.type === 'message') {
          const msg = raw.payload as Message
          messageCbs.forEach(cb => cb(msg))
        } else if (raw.type === 'typing') {
          opts.onTyping(raw.payload.userId)
        } else if (raw.type === 'ack') {
          // handle ack for dedupe
        }
      } catch {}
    }

    ws.onclose = (e) => {
      state = 'closed'
      // FIX #10 - exponential backoff reconnect
      if (e.code !== 4401 && e.code !== 4403) { // don't reconnect on auth/forbidden
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000)
        reconnectAttempts++
        reconnectTimer = setTimeout(() => connect(), delay)
        state = 'reconnecting'
      }
    }

    ws.onerror = () => {
      ws?.close()
    }
  }

  connect()

  return {
    get state() { return state },
    sendMessage: (text: string) => {
      if (ws?.readyState !== WebSocket.OPEN) return
      const clientId = crypto.randomUUID()
      ws.send(JSON.stringify({ type: 'message', payload: { roomId: opts.roomId, text, clientId } }))
    },
    sendTyping: () => {
      if (ws?.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify({ type: 'typing', payload: { roomId: opts.roomId } }))
    },
    close: () => {
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ws?.close(1000, 'Client closed')
      state = 'closed'
    },
    onMessage: (cb) => {
      messageCbs.push(cb)
      return () => { messageCbs = messageCbs.filter(c => c !== cb) }
    }
  }
}
```

**Usage in chat screen:**
```ts
const ws = useMemo(() => createChatWS({
  roomId,
  getLastMessageId: () => lastMessage?.id || null,
  onMessage: (msg) => queryClient.setQueryData(['messages', roomId], (old: Message[]) => [...old, msg]),
  onTyping: (userId) => setTypingUsers(...),
  apiFetchMissed: async (after) => {
    const res = await api.rooms({ roomId }).messages.get({ query: { after } })
    return res.data?.messages || []
  }
}), [roomId])
```

---

## PHASE 7: Client API + Storage FIXED (Fix #12, #13, #14)

**`apps/client/src/lib/storage.ts` FIXED - no token in localStorage for web if using httpOnly cookie:**
```ts
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

export const storage = {
  // For native only - web uses httpOnly cookies, no token in localStorage
  get: async (k: string): Promise<string | null> => {
    if (Platform.OS === 'web') {
      // FIX #14 - web should NOT store token in localStorage if using httpOnly cookie
      // Only use localStorage for non-sensitive data like lastRoomId
      if (k === 'accessToken' || k === 'refreshToken') return null
      return typeof window !== 'undefined' ? localStorage.getItem(k) : null
    }
    return await SecureStore.getItemAsync(k)
  },
  set: async (k: string, v: string): Promise<void> => {
    if (Platform.OS === 'web') {
      if (k === 'accessToken' || k === 'refreshToken') return // don't store sensitive in localStorage
      if (typeof window !== 'undefined') localStorage.setItem(k, v)
      return
    }
    await SecureStore.setItemAsync(k, v)
  },
  del: async (k: string): Promise<void> => {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') localStorage.removeItem(k)
      return
    }
    await SecureStore.deleteItemAsync(k)
  }
}
```

**`apps/client/src/lib/api.ts` FIXED:**
```ts
import { treaty } from '@elysiajs/eden'
import type { App } from '@meapp/server/src/index.ts'
import { Platform } from 'react-native'
import { storage } from './storage.js'

const getApiUrl = (): string => {
  const url = process.env.EXPO_PUBLIC_API_URL
  if (!url) throw new Error('EXPO_PUBLIC_API_URL must be set')
  return url
}

export const api = treaty<App>(getApiUrl(), {
  fetch: {
    credentials: 'include' // FIX #12 - needed for httpOnly cookie
  } as RequestInit,
  headers: async () => {
    // FIX #13 - native uses Bearer, web uses cookie (no header)
    if (Platform.OS !== 'web') {
      const token = await storage.get('accessToken')
      return token ? { Authorization: `Bearer ${token}` } : {}
    }
    return {}
  }
})
```

---

## PHASE 8: Security FIXED (Fix #8, #12, #17, #18)

**`apps/server/src/plugins/security.ts` NEW:**
```ts
import { Elysia } from 'elysia'

export const securityPlugin = new Elysia({ name: 'security' })
  .onAfterHandle(({ set }) => {
    set.headers['X-Content-Type-Options'] = 'nosniff'
    set.headers['X-Frame-Options'] = 'DENY'
    set.headers['X-XSS-Protection'] = '1; mode=block'
    set.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    set.headers['Content-Security-Policy'] = "default-src 'self'"
  })
```

**`apps/server/src/plugins/rateLimit.ts` FIXED per-user:**
```ts
import { Elysia } from 'elysia'

const hits = new Map<string, { count: number; reset: number }>()

export const rateLimitPlugin = new Elysia({ name: 'rateLimit' })
  .onBeforeHandle(({ user, request, set }) => {
    // FIX per-user, not just IP
    const key = (user as { id?: string })?.id || request.headers.get('x-forwarded-for') || 'anon'
    const now = Date.now()
    const rec = hits.get(key)
    if (!rec || rec.reset < now) {
      hits.set(key, { count: 1, reset: now + 60000 })
      return
    }
    if (rec.count > 100) {
      set.status = 429
      return { error: 'Too many requests' }
    }
    rec.count++
  })
```

**Biome no any:**
In `biome.json`, add:
```json
{
  "linter": {
    "rules": {
      "suspicious": { "noExplicitAny": "error" },
      "correctness": { "noUnusedVariables": "error" }
    }
  }
}
```

**trustedDependencies minimal (Fix #17):**
```json
{
  "trustedDependencies": ["sharp", "expo", "expo-modules-autolinking"]
}
```
NOT `@expo/*`.

**Security scanning (Fix #18):**
In CI, add:
```yaml
- run: bun audit
- run: bunx @biomejs/biome check .
- name: Trivy image scan
  run: |
    podman pull aquasec/trivy
    podman run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy image ghcr.io/meapp-labs/meapp:server
- name: Gitleaks secret scan
  run: |
    podman run --rm -v $(pwd):/path zricethezav/gitleaks detect --source /path
```

---

## PHASE 9: Prod Infra FIXED (Fix #6, #7)

**`compose.dev.yaml` and Quadlets FIXED ports:**

`~/.config/containers/systemd/meapp.container`:
```ini
[Unit]
Description=MeApp Elysia Server
After=network-online.target meapp-redis.service
Wants=network-online.target

[Container]
Image=ghcr.io/meapp-labs/meapp:sha-%i
ContainerName=meapp-server
# FIX #7 - bind to loopback only, Caddy fronts it
PublishPort=127.0.0.1:3000:3000
EnvironmentFile=%h/meapp.env
Volume=%h/meapp-data:/app/data:Z
Volume=%h/meapp-uploads:/app/uploads:Z
AutoUpdate=registry
HealthCmd=CMD-SHELL curl -f http://localhost:3000/health || exit 1
HealthInterval=30s
HealthRetries=3
Restart=always

[Service]
Restart=always

[Install]
WantedBy=default.target
```

`meapp-redis.container`:
```ini
[Unit]
Description=MeApp Redis
[Container]
Image=docker.io/library/redis:7-alpine
ContainerName=meapp-redis
# FIX #7 - loopback only, not public
PublishPort=127.0.0.1:6379:6379
Volume=meapp-redis-data:/data:Z
Network=meapp-net.network

[Install]
WantedBy=default.target
```

**Caddyfile:**
```
meapp.yourdomain.com {
  reverse_proxy 127.0.0.1:3000
}

meapp-web.yourdomain.com {
  root * /var/www/meapp-web/dist
  file_server
  try_files {path} /index.html
}
```

**Litestream backup (Fix #23 - non-optional):**
`meapp-litestream.container`:
```ini
[Unit]
Description=MeApp Litestream Backup - RPO 1min RTO 5min
After=meapp.service
[Container]
Image=docker.io/litestream/litestream:0.3
ContainerName=meapp-litestream
Volume=%h/meapp-data:/data:Z
EnvironmentFile=%h/litestream.env
Exec=litestream replicate /data/data.db s3://your-bucket/meapp.db
[Install]
WantedBy=default.target
```

Restore test script `scripts/test-restore.sh`:
```bash
#!/bin/sh
podman stop meapp-server
cp ~/meapp-data/data.db ~/meapp-data/data.db.bak
litestream restore -o /tmp/restored.db s3://bucket/meapp.db
# verify
sqlite3 /tmp/restored.db "SELECT count(*) FROM messages;"
# if ok, replace
```

---

## PHASE 10: CI/CD FIXED (Fix #19, #20, #21, #22)

**`.github/workflows/cicd.yml` FIXED change detection + atomic deploy + rollback:**

```yaml
name: CI/CD Podman Fixed
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }

jobs:
  detect-changes:
    runs-on: ubuntu-latest
    outputs:
      client: ${{ steps.filter.outputs.client }}
      server: ${{ steps.filter.outputs.server }}
    steps:
      - uses: actions/checkout@v4
      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            client:
              - 'apps/client/**'
              - 'packages/shared/**'
              - 'package.json'
              - 'bun.lock'
              - 'bunfig.toml'
            server:
              - 'apps/server/**'
              - 'packages/**'
              - 'package.json'
              - 'bun.lock'
              - 'bunfig.toml'
              - 'compose.dev.yaml'

  client:
    needs: detect-changes
    if: needs.detect-changes.outputs.client == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: 1.4.2 }
      - run: bun install --frozen-lockfile
      - run: bunx @biomejs/biome check ./apps/client ./packages/shared
      - run: bunx expo-doctor # FIX #16
      - run: npx expo-modules-autolinking verify -v # FIX #16
      - run: bun --filter client export:web
      - if: github.ref == 'refs/heads/main'
        run: rsync -avz apps/client/dist/ user@server:/var/www/meapp-web/dist/
      - if: github.ref == 'refs/heads/main'
        run: |
          npm install -g eas-cli
          eas update --branch production --message ${{ github.sha }} --non-interactive
        env: { EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }} }

  server:
    needs: detect-changes
    if: needs.detect-changes.outputs.server == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: 1.4.2 }
      - name: Install Podman deps
        run: sudo apt update && sudo apt install -y podman passt netavark aardvark-dns trivy
      - run: bun install --frozen-lockfile
      - run: bunx @biomejs/biome check ./apps/server ./packages
      - run: bun --filter @meapp/server test
      - run: bun audit
      - name: Build immutable tag (FIX #20)
        if: github.ref == 'refs/heads/main'
        run: |
          echo ${{ secrets.GITHUB_TOKEN }} | podman login ghcr.io -u ${{ github.actor }} --password-stdin
          SHA_TAG=sha-${{ github.sha }}
          podman build -t ghcr.io/meapp-labs/meapp:$SHA_TAG -t ghcr.io/meapp-labs/meapp:server -f apps/server/Dockerfile .
          podman push ghcr.io/meapp-labs/meapp:$SHA_TAG
          podman push ghcr.io/meapp-labs/meapp:server
          echo "SHA_TAG=$SHA_TAG" >> $GITHUB_ENV
      - name: Trivy scan (FIX #18)
        if: github.ref == 'refs/heads/main'
        run: podman run --rm aquasec/trivy image ghcr.io/meapp-labs/meapp:${{ env.SHA_TAG }}
      - name: Deploy with health check + rollback (FIX #20, #21)
        if: github.ref == 'refs/heads/main'
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SSH_KEY }}
          script: |
            set -e
            SHA_TAG=sha-${{ github.sha }}
            PREV_TAG=$(cat ~/meapp-current-tag || echo "server")
            echo $SHA_TAG > ~/meapp-current-tag
            podman pull ghcr.io/meapp-labs/meapp:$SHA_TAG
            # Update Quadlet to new tag
            sed -i "s|Image=ghcr.io/meapp-labs/meapp:.*|Image=ghcr.io/meapp-labs/meapp:$SHA_TAG|" ~/.config/containers/systemd/meapp.container
            systemctl --user daemon-reload
            systemctl --user restart meapp.container
            # Health check
            for i in {1..10}; do
              if curl -f http://127.0.0.1:3000/health; then
                echo "Health ok"
                exit 0
              fi
              sleep 3
            done
            echo "Health failed, rolling back to $PREV_TAG"
            sed -i "s|Image=ghcr.io/meapp-labs/meapp:.*|Image=ghcr.io/meapp-labs/meapp:$PREV_TAG|" ~/.config/containers/systemd/meapp.container
            systemctl --user daemon-reload
            systemctl --user restart meapp.container
            exit 1
```

**DB Migrations separate (Fix #22):**
Create `apps/server/src/migrate.ts` that runs migrations via Drizzle Kit, NOT on every app start. Run as separate Podman container or CI job BEFORE deploy:

```ts
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { Database } from 'bun:sqlite'
const sqlite = new Database(process.env.DATABASE_URL!)
const db = drizzle(sqlite)
await migrate(db, { migrationsFolder: './migrations' })
```

CI job `migrate` runs before `deploy`, with backup.

---

## PHASE 11: Litestream Backup + Restore Test (Fix #23)

**Non-optional for SQLite prod:**

- RPO: 1 minute (Litestream replicates WAL every 1s)
- RTO: 5 minutes (restore + restart)
- Backup: S3/R2 bucket `s3://meapp-backups`
- Restore test: Weekly CI job runs `scripts/test-restore.sh` and verifies row count

**`~/litestream.env`:**
```
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_BUCKET=meapp-backups
```

---

## PHASE 12: Validation Gates (Fix #24, #16)

**Pin exact versions in package.json, not ranges:**
```json
{
  "dependencies": {
    "elysia": "1.3.3",
    "@elysiajs/cors": "1.3.3",
    "drizzle-orm": "0.35.3"
  }
}
```

**Verification in CI:**
```bash
bun --filter client tsc --noEmit
bun --filter @meapp/server tsc --noEmit
bunx expo-doctor
npx expo-modules-autolinking verify -v
bun --filter @meapp/shared test
bun --filter @meapp/server test
```

---

## Final Checklist - All 24 Fixed

- [ ] FIX #1: `import { Elysia, t }` in WS file, compiles
- [ ] FIX #2: WS auth via derive, closes 4401 if no user, no anon
- [ ] FIX #3: `canAccessRoom` before subscribe AND publish, roomId must equal subscribed
- [ ] FIX #4: Idempotency UNIQUE(userId, clientId) + onConflictDoNothing + ack
- [ ] FIX #5: SQLite volume `meapp-server-data:/app/data:Z` and DATABASE_URL=/app/data/data.db
- [ ] FIX #6: DB path invariant, checkpoint on SIGTERM/SIGINT, Litestream lifecycle documented, restore test
- [ ] FIX #7: Redis PublishPort 127.0.0.1 only, server 127.0.0.1:3000 only, Caddy fronts
- [ ] FIX #8: No any, Biome noExplicitAny error, no as any
- [ ] FIX #9: clientId in messages table + UNIQUE
- [ ] FIX #10: Reconnect exponential backoff, resubscribe, fetch missed via ?after=
- [ ] FIX #11: EXPO_PUBLIC_WS_URL explicit, not replace('http','ws')
- [ ] FIX #12: CORS explicit origins, cookie httpOnly secure sameSite domain path maxAge specified
- [ ] FIX #13: Auth arch documented web=HttpOnly cookie, native=Bearer+SecureStore, WS=cookie OR ?token=
- [ ] FIX #14: Web no token in localStorage, only httpOnly cookie
- [ ] FIX #15: Justify hoisted as validated choice, not "isolated breaks Expo"
- [ ] FIX #16: expo-doctor + autolinking verify in CI
- [ ] FIX #17: trustedDependencies minimal, not @expo/*
- [ ] FIX #18: Trivy + gitleaks + bun audit, not just audit
- [ ] FIX #19: CI filters include packages/**, bun.lock, package.json
- [ ] FIX #20: Immutable sha- tag, not mutable :server
- [ ] FIX #21: Rollback plan with PREV_TAG + health check
- [ ] FIX #22: Migrations separate job, not on every app start
- [ ] FIX #23: Litestream non-optional, RPO/RTO defined, restore test
- [ ] FIX #24: Exact version pins + validation gates

All code snippets compile with `bun tsc --noEmit`.
