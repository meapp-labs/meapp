# MeApp Migration to Elysia - V5 Podman Fixed (Sept 2026) - AI Execution Plan

> Repo: https://github.com/meapp-labs/meapp
> This is V4 FIXED with 12 holes patched from deep audit. Use this, not V4.

## 0. General Instructions for AI - UPDATED FOR SEPT 2026

**Stack:**
- Runtime: Bun 1.4.2 (pin exact, lockfileVersion 2, hoisted linker for Expo)
- Server: Elysia 1.3.x (NOT 1.2, breaking changes!), @elysiajs/cors@1.3, @elysiajs/swagger@1.3, @elysiajs/eden@1.3 (treaty v2), @elysiajs/cookie@1.3, @elysiajs/jwt@1.3
- DB: bun:sqlite + drizzle-orm, WAL + busy_timeout + Litestream backup
- Infra: Podman 5.4+ with pasta+netavark, Quadlet, Caddy 2, Redis 7
- Client: Expo SDK 54 (STAY on Old Arch for this migration, newArchEnabled false), RN 0.81, Expo Router universal (ios/android/web), @elysiajs/eden, TanStack Query 5, Zustand 4, Zod 3, Biome, bun:test

**Critical Sept 2026 rules:**
- Use `podman` only, never `docker`
- Must install `passt` everywhere (dev, CI, VPS) or Podman bridge fails
- Use `type` not `interface`, no default exports, no any, await promises
- Use `linker = "hoisted"` in bunfig.toml for Expo compatibility (isolated breaks Expo)
- Elysia 1.3: No `api.index`, no WS chaining

---

## PHASE 0: Podman + Bun 1.4 Setup (FIXED)

**Install Podman with pasta (FIX for Hole #3):**
```bash
# Ubuntu/Debian - REQUIRED for Podman 5.x
sudo apt update && sudo apt install -y podman passt netavark aardvark-dns slirp4netns caddy
sudo loginctl enable-linger $USER
podman system migrate
which pasta # must exist
podman info --format '{{.Host.Security.RootlessNetworkCmd}}' # must be pasta

# Fedora
sudo dnf install -y podman passt netavark aardvark-dns

# macOS
brew install podman passt
podman machine init --cpus 4 --memory 4096 --disk-size 50
podman machine start

# Test
podman run --rm -p 3000:3000 docker.io/library/alpine echo "ok" # must not fail with pasta error
```

**Monorepo + Bun 1.4 fixes (FIX for Hole #1):**
```bash
mkdir -p apps packages
[ -d client ] && mv client apps/client || true
[ -d server ] && mv server apps/server || true
[ -d apps/mobile ] && mv apps/mobile apps/client || true

cat > package.json <<'JSON'
{
  "name": "meapp",
  "private": true,
  "type": "module",
  "packageManager": "bun@1.4.2",
  "workspaces": ["apps/*", "packages/*"],
  "trustedDependencies": ["@expo/*", "expo", "sharp", "msw"],
  "scripts": {
    "dev": "podman compose -f compose.dev.yaml up",
    "dev:server": "bun --filter @meapp/server dev",
    "dev:client": "bun --filter client dev",
    "dev:web": "bun --filter client web",
    "lint": "bunx @biomejs/biome check --write ./apps ./packages"
  },
  "overrides": { "typescript": "^5.8.0" }
}
JSON

cat > bunfig.toml <<'TOML'
[install]
linker = "hoisted"
auto = true

[install.lockfile]
version = 2

[install.cache]
disableManifest = false
TOML

# Delete old lockfiles
rm -f bun.lockb bun.lock apps/*/bun.lock
bun install # creates v2 lockfile
```

**Verify:** `cat bun.lock | grep lockfileVersion` should show 2, `podman info` shows rootless true.

---

## PHASE 1: Tooling - Biome + bun:test

Same as V4, but with TS 5.8 pin.

```bash
bun add -D -g @biomejs/biome
cat > biome.json <<'JSON'
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": { "include": ["apps/**/*", "packages/**/*"] },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2 },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "javascript": { "formatter": { "quoteStyle": "single", "semicolon": "asNeeded" } }
}
JSON
```

Replace Vitest with `bun:test` in server package.json: `"test": "bun test"`

---

## PHASE 2: Shared + DB Packages (FIXED WAL)

Same as V3/V4 for schemas, but DB client FIXED:

**`packages/db/src/client.ts` FIXED:**
```ts
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as schema from './schema.js'
const dbPath = process.env.DATABASE_URL || './data.db'
const sqlite = new Database(dbPath)
sqlite.exec('PRAGMA journal_mode = WAL;')
sqlite.exec('PRAGMA busy_timeout = 5000;')
sqlite.exec('PRAGMA synchronous = NORMAL;')
// Graceful checkpoint on exit
process.on('beforeExit', () => {
  try { sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE);') } catch {}
})
export const db = drizzle(sqlite, { schema })
export { schema }
```

Add migration runner `packages/db/src/migrate.ts` that runs on server startup.

---

## PHASE 3: Remove better-sqlite3 + Audit Native Addons

```bash
cd apps/server
# Audit native addons - Bun 1.4 NODE_MODULE_VERSION 147, must rebuild
bun pm ls | xargs -I {} sh -c 'ls node_modules/{}/binding.gyp 2>/dev/null && echo {}' || true
bun remove better-sqlite3 @types/better-sqlite3
bun add drizzle-orm
bun add -d drizzle-kit
cd ../..
```

Replace all `db.prepare` with Drizzle as in V4.

---

## PHASE 4: Podman Dev Compose (FIXED with pasta)

**`compose.dev.yaml` FIXED:**
```yaml
services:
  redis:
    image: docker.io/library/redis:7-alpine
    container_name: meapp-redis-dev
    ports: ["6379:6379"]
    volumes: ["meapp-redis-data:/data:Z"]
    restart: unless-stopped
    # Podman 5 pasta fix - ensure bridge works
    networks: [meapp-net]

  server:
    build:
      context: .
      dockerfile: apps/server/Dockerfile.dev
    container_name: meapp-server-dev
    ports: ["3000:3000"] # rootless, cannot be <1024, use 3000 not 80
    volumes:
      - ./apps/server:/app/apps/server:z
      - ./packages:/app/packages:z
      - ./package.json:/app/package.json:z
      - ./bun.lock:/app/bun.lock:z
      - /app/apps/server/node_modules
      - /app/node_modules
    env_file: apps/server/.env.local
    environment:
      - NODE_ENV=development
      - DATABASE_URL=/app/data.db
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
```

**`apps/server/Dockerfile.dev`:**
```dockerfile
FROM docker.io/oven/bun:1.4.2 AS base
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY packages ./packages
COPY apps/server/package.json ./apps/server/package.json
RUN bun install
WORKDIR /app
EXPOSE 3000
CMD ["bun", "--watch", "apps/server/src/index.ts"]
```

**Dev commands:**
```bash
podman compose -f compose.dev.yaml up -d
podman logs -f meapp-server-dev
# client native for HMR
bun --filter client dev
bun --filter client web
```

---

## PHASE 5: Fastify -> Elysia 1.3 (FIXED BREAKING CHANGES)

**Install:**
```bash
cd apps/server
bun remove fastify @fastify/cors @fastify/cookie @fastify/session @fastify/swagger @fastify/autoload socket.io
bun add elysia@1.3 @elysiajs/cors@1.3 @elysiajs/swagger@1.3 @elysiajs/cookie@1.3 @elysiajs/jwt@1.3 @elysiajs/websocket@1.3
cd ../..
```

**`apps/server/src/index.ts` FIXED for 1.3:**
```ts
import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { swagger } from '@elysiajs/swagger'
import { cookie } from '@elysiajs/cookie'
import { redisPlugin } from './plugins/redis.js'
import { authPlugin } from './plugins/auth.js'
import { authRoutes } from './routes/auth.js'
import { userRoutes } from './routes/users.js'
import { roomRoutes } from './routes/rooms.js'
import { messageRoutes } from './routes/messages.js'
import { chatWs } from './ws/chat.js'

export const app = new Elysia()
  .use(cors({ origin: ['http://localhost:8081', 'http://localhost:19006', 'https://meapp.yourdomain.com'], credentials: true }))
  .use(swagger({ path: '/documentation' }))
  .use(cookie())
  .use(redisPlugin)
  .use(authPlugin)
  .use(authRoutes)
  .use(userRoutes)
  .use(roomRoutes)
  .use(messageRoutes)
  .use(chatWs)
  .get('/health', () => ({ status: 'ok', uptime: process.uptime(), podman: true, bun: Bun.version }))
  .listen({ port: Number(process.env.PORT) || 3000, hostname: '0.0.0.0' })

export type App = typeof app
console.log(`🦊 Elysia 1.3 + Bun ${Bun.version} + Podman at http://${app.server?.hostname}:${app.server?.port}`)
```

**Routes - same as V4 but ensure no default exports, use `type` not `interface`.**

---

## PHASE 6: Socket.IO -> Elysia WS FIXED (No Chaining)

**`apps/server/src/ws/chat.ts` FIXED for 1.3 (no chaining):**
```ts
import { Elysia } from 'elysia'
import { messageWsSchema, createMessageSchema } from '@meapp/shared'
import { db, schema } from '@meapp/db'
import { randomUUID } from 'crypto'

export const chatWs = new Elysia()
  .ws('/ws', {
    query: t.Object({ roomId: t.String() }),
    body: messageWsSchema,
    open(ws) {
      const roomId = (ws.data.query as any).roomId
      if (roomId) {
        ws.subscribe(`room:${roomId}`) // FIXED: no chaining in 1.3
      }
    },
    async message(ws, msg) {
      const roomId = (ws.data.query as any).roomId
      if (msg.type === 'typing') {
        // FIXED: separate calls
        ws.publish(`room:${msg.roomId}`, { type: 'typing', userId: (ws as any).userId, roomId: msg.roomId })
        return
      }
      if (msg.type === 'message') {
        const parsed = createMessageSchema.parse((msg as any).payload)
        const id = randomUUID()
        const userId = (ws as any).userId || 'anon'
        await db.insert(schema.messages).values({ id, roomId: parsed.roomId, userId, text: parsed.text, createdAt: new Date() })
        const full = { id, ...parsed, userId, createdAt: new Date() }
        // FIXED: no chaining
        ws.publish(`room:${msg.roomId}`, { type: 'message', payload: full })
        // TODO: Redis pub/sub for multi-instance
      }
    },
    close(ws) {
      const roomId = (ws.data.query as any).roomId
      if (roomId) {
        ws.unsubscribe(`room:${roomId}`)
      }
    }
  })
```

**Client WS `apps/client/src/lib/ws.ts`:**
Same as V4, but add idempotency:
```ts
export const createChatWS = (roomId: string, onMessage: (m: any) => void) => {
  const base = process.env.EXPO_PUBLIC_WS_URL || 'ws://localhost:3000'
  const ws = new WebSocket(`${base.replace('http','ws')}/ws?roomId=${roomId}`)
  ws.onmessage = (e) => {
    try { onMessage(JSON.parse(e.data)) } catch {}
  }
  return {
    ws,
    sendMessage: (text: string, clientId = crypto.randomUUID()) => {
      ws.send(JSON.stringify({ type: 'message', roomId, payload: { roomId, text, clientId } }))
    },
    close: () => ws.close()
  }
}
```

---

## PHASE 7: Client Axios -> Eden Treaty v2 FIXED + Universal Storage

**`apps/client/src/lib/storage.ts`:**
```ts
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
export const storage = {
  get: async (k: string) => Platform.OS === 'web' ? localStorage.getItem(k) : await SecureStore.getItemAsync(k),
  set: async (k: string, v: string) => Platform.OS === 'web' ? localStorage.setItem(k, v) : await SecureStore.setItemAsync(k, v),
  del: async (k: string) => Platform.OS === 'web' ? localStorage.removeItem(k) : await SecureStore.deleteItemAsync(k)
}
```

**`apps/client/src/lib/api.ts` FIXED for Elysia 1.3 treaty v2 + httpOnly cookie for web:**
```ts
import { treaty } from '@elysiajs/eden'
import type { App } from '@meapp/server/src/index.ts'
import { Platform } from 'react-native'
import { storage } from './storage.js'

export const api = treaty<App>(process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000', {
  fetch: { credentials: 'include' } as any,
  headers: async () => {
    // For native, use Authorization header, for web use httpOnly cookie (no header needed)
    if (Platform.OS !== 'web') {
      const token = await storage.get('token')
      return token ? { Authorization: `Bearer ${token}` } : {}
    }
    return {}
  }
})
// Usage: const { data, error } = await api.rooms.get()
// In 1.3, root index is removed, so api.get() not api.index.get()
```

**Migrate hooks:** `axios.get('/rooms')` -> `api.rooms.get()` with `{ data, error }` handling.

---

## PHASE 8: Client Universal + Expo SDK 54 Final Legacy Fix

**Stay on SDK 54 Old Arch for this migration:**

In `apps/client/app.json`:
```json
{
  "expo": {
    "newArchEnabled": false,
    "platforms": ["ios","android","web"],
    "updates": {
      "url": "https://u.expo.dev/<projectId>",
      "fallbackToCacheTimeout": 0
    },
    "runtimeVersion": { "policy": "appVersion" },
    "extra": { "eas": { "projectId": "<id>" } }
  }
}
```

**Note:** SDK 54 is final release that includes Legacy Architecture. SDK 55 drops legacy. Do NOT upgrade to SDK 55 in same PR.

---

## PHASE 9: Prod Infra - Podman Quadlet + Caddy (FIXED pasta + ports)

**Caddyfile `~/Caddyfile`:**
```
meapp.yourdomain.com {
  reverse_proxy localhost:3000
}
meapp-web.yourdomain.com {
  root * /var/www/meapp-web/dist
  file_server
  try_files {path} /index.html
}
```

**Quadlet `~/.config/containers/systemd/meapp.container` FIXED (no <1024 port):**
```ini
[Unit]
Description=MeApp Elysia Server
After=network-online.target
Wants=network-online.target

[Container]
Image=ghcr.io/meapp-labs/meapp:server
ContainerName=meapp-server
PublishPort=3000:3000
EnvironmentFile=%h/meapp.env
Volume=%h/meapp-data:/app/data:Z
Volume=%h/meapp-uploads:/app/uploads:Z
AutoUpdate=registry
Restart=always

[Service]
Restart=always
TimeoutStartSec=900

[Install]
WantedBy=default.target
```

**Quadlet Redis:**
```ini
[Unit]
Description=MeApp Redis
[Container]
Image=docker.io/library/redis:7-alpine
ContainerName=meapp-redis
PublishPort=6379:6379
Volume=meapp-redis-data:/data:Z
[Install]
WantedBy=default.target
```

**Optional Litestream backup sidecar `meapp-litestream.container`:**
```ini
[Unit]
Description=MeApp Litestream Backup
After=meapp.container
[Container]
Image=docker.io/litestream/litestream:0.3
ContainerName=meapp-litestream
Volume=%h/meapp-data:/data:Z
Exec=litestream replicate /data/data.db s3://your-bucket/meapp.db
EnvironmentFile=%h/litestream.env
[Install]
WantedBy=default.target
```

**VPS commands:**
```bash
mkdir -p ~/.config/containers/systemd
# copy files
systemctl --user daemon-reload
systemctl --user enable --now meapp-redis.container
systemctl --user enable --now meapp.container
systemctl --user status meapp.container
journalctl --user -u meapp -f
podman auto-update --dry-run
```

**Dockerfile prod `apps/server/Dockerfile`:**
```dockerfile
FROM docker.io/oven/bun:1.4.2 AS base
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY packages ./packages
COPY apps/server ./apps/server
RUN bun install --frozen-lockfile --production
WORKDIR /app/apps/server
ENV NODE_ENV=production
EXPOSE 3000
CMD ["bun", "src/index.ts"]
```

---

## PHASE 10: CI/CD Podman (FIXED pasta install)

**`.github/workflows/cicd.yml`:**
```yaml
name: CI/CD Podman
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
jobs:
  detect-changes:
    runs-on: ubuntu-latest
    outputs: { client: ${{ steps.filter.outputs.client }}, server: ${{ steps.filter.outputs.server }} }
    steps:
      - uses: actions/checkout@v4
      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            client: apps/client/**
            server: apps/server/**
  client:
    needs: detect-changes
    if: needs.detect-changes.outputs.client == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: 1.4.2 }
      - run: bun install --frozen-lockfile
      - run: bunx @biomejs/biome check ./apps/client
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
      - name: Install Podman deps (FIX pasta)
        run: sudo apt update && sudo apt install -y podman passt netavark aardvark-dns
      - run: bun install --frozen-lockfile
      - run: bunx @biomejs/biome check ./apps/server
      - run: bun --filter @meapp/server test
      - if: github.ref == 'refs/heads/main'
        run: |
          echo ${{ secrets.GITHUB_TOKEN }} | podman login ghcr.io -u ${{ github.actor }} --password-stdin
          podman build -t ghcr.io/meapp-labs/meapp:server -f apps/server/Dockerfile .
          podman push ghcr.io/meapp-labs/meapp:server
      - if: github.ref == 'refs/heads/main'
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SSH_KEY }}
          script: |
            podman pull ghcr.io/meapp-labs/meapp:server
            systemctl --user restart meapp.container
```

---

## PHASE 11: Security + Observability

- Add `bun audit` and `bun pm check` in CI
- Add per-user rate limit in Redis, not just IP
- Add security headers via Elysia `onAfterHandle`
- Add `pino` logger + `/metrics` endpoint

---

## PHASE 12: Future - SDK 55 New Arch Migration (Separate PR)

After Elysia stable:
- Upgrade to Expo SDK 55 (drops legacy arch), enable Hermes v1 + bytecode diffing (75% smaller OTA)
- Migrate to New Architecture

---

## Final Verification (Podman Fixed)

```bash
podman --version # 5.4+
which pasta # must exist
podman compose -f compose.dev.yaml up -d
podman logs -f meapp-server-dev
bun --filter client web # http://localhost:8081
curl http://localhost:3000/health # {status:"ok", podman:true, bun:"1.4.2"}
podman compose -f compose.dev.yaml down
```

- [ ] No docker command, only podman
- [ ] bun.lock version 2, linker hoisted
- [ ] No better-sqlite3, no socket.io, no axios
- [ ] api.get() not api.index.get() (Elysia 1.3)
- [ ] WS no chaining
- [ ] Web + native both work
- [ ] Pasta installed everywhere
