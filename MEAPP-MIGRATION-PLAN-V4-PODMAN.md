# MeApp Migration to Elysia - Podman Edition (Dev + Prod) - AI Execution Plan

> Repo: https://github.com/meapp-labs/meapp
> Goal: Elysia + Eden + shared types + Podman for BOTH dev and prod + OTA + Web kept (iOS, Android, Web)

## 0. General Instructions for AI

**You MUST use Podman everywhere, not Docker. No `docker` commands, only `podman`.**

**Stack after audit:**
- Runtime: Bun 1.4.2 (root runtime)
- Server: `elysia@1.2`, `@elysiajs/cors`, `@elysiajs/swagger`, `@elysiajs/eden`, `@elysiajs/cookie`, `@elysiajs/jwt`, `@elysiajs/websocket`
- DB: `bun:sqlite` via `drizzle-orm/bun-sqlite` (REMOVE better-sqlite3, it's native addon broken on Bun)
- Infra: Podman 5.x, podman-compose or `podman compose` (built-in), Quadlet for prod, Redis 7, Caddy 2 for reverse proxy + auto HTTPS
- Client: Expo 54, RN 0.81, Expo Router (universal iOS/Android/Web), `@elysiajs/eden`, TanStack Query 5, Zustand 4, Zod 3, expo-secure-store + localStorage fallback
- Tooling: Bun workspaces, Biome (replaces ESLint+Prettier, faster), `bun:test` (replaces Vitest), `bun audit`

**Coding rules (from CLAUDE.md):**
- Use `type` not `interface`
- No default exports
- No `any`, strict TS, await promises
- Use theme.ts
- Comments only complex logic

**Check other replacements before using old tools:**
- pm2 -> Quadlet systemd (Podman) [BETTER]
- Nginx -> Caddy [BETTER for auto HTTPS]
- ESLint+Prettier -> Biome [BETTER, 10x faster, single binary]
- Vitest -> bun:test [BETTER, native]
- Socket.IO -> Elysia WS [BETTER, typed, lighter]
- Axios -> Eden Treaty [BETTER, shared types]
- better-sqlite3 -> bun:sqlite + Drizzle [BETTER, works on Bun]
- Docker Desktop -> Podman Desktop [BETTER for rootless, or equal]

---

## PHASE 0: Podman Setup for Dev + Prod

**Why Podman for dev too:** No daemon, rootless, same commands in CI and local, works with Dockerfiles.

**Commands - On dev machine (Linux):**
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install podman podman-compose caddy -y
podman --version # must be >=5.0

# Rootless setup
sudo loginctl enable-linger $USER
podman system migrate
podman info --format "{{.Host.Security.Rootless}}" # must be true

# Alias for muscle memory (optional)
echo "alias docker=podman" >> ~/.bashrc
echo "alias docker-compose='podman-compose'" >> ~/.bashrc

# Test
podman run --rm -it docker.io/library/alpine echo "podman works rootless"
```

**On Mac/Windows dev machine:**
```bash
brew install podman
podman machine init --cpus 4 --memory 4096 --disk-size 50
podman machine start
podman info

# Or install Podman Desktop GUI (replaces Docker Desktop)
# https://podman-desktop.io/downloads
```

**On VPS (prod):**
```bash
sudo apt update && sudo apt install podman caddy -y
sudo loginctl enable-linger $USER
podman system migrate
```

**Root monorepo setup (same as V3 but podman):**
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
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "podman compose -f compose.dev.yaml up",
    "dev:server": "bun --filter @meapp/server dev",
    "dev:client": "bun --filter client dev",
    "dev:web": "bun --filter client web",
    "lint": "bunx @biomejs/biome check --write ./apps ./packages"
  }
}
JSON
```

---

## PHASE 1: Tooling Replacement - Biome + bun:test

**Why Biome is better than ESLint+Prettier for you:** Single binary, 10x faster, works in .githooks pre-commit, no config hell. Perfect for 2 friends.

**Files to change:**
- Delete `.eslintrc*`, `.prettierrc*`, `.eslintignore`
- Delete `apps/client/.eslintrc`, `apps/server/.eslintrc`
- Edit `.githooks/pre-commit`

**Commands:**
```bash
bun add -D -g @biomejs/biome
cat > biome.json <<'JSON'
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": { "ignoreUnknown": false, "include": ["apps/**/*", "packages/**/*"] },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2 },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "javascript": { "formatter": { "quoteStyle": "single", "semicolon": "asNeeded" } }
}
JSON

cat > .githooks/pre-commit <<'SH'
#!/bin/sh
bunx @biomejs/biome check --write --staged
SH
chmod +x .githooks/pre-commit
```

**Replace Vitest with bun:test in `apps/server`:**
```bash
cd apps/server
bun remove vitest @vitest/coverage-v8
# bun:test is built-in, no install
# Change test scripts
```
Edit `apps/server/package.json`:
```json
{ "scripts": { "test": "bun test", "test:watch": "bun test --watch" } }
```
Convert `describe/it` imports: `import { describe, it, expect } from 'bun:test'` (same API).

---

## PHASE 2: Shared + DB Packages (Same as V3)

**Create packages/shared and packages/db exactly as V3, but with Biome.**

Commands same as V3 PHASE 1. Do not import `bun:sqlite` in shared, only Zod.

**Files:**
- `packages/shared/src/schemas/auth.ts`, `user.ts`, `message.ts`, `room.ts`, `index.ts`
- `packages/shared/src/types/index.ts`
- `packages/db/src/schema.ts`, `client.ts`, `index.ts`, `drizzle.config.ts`

**Verify:** `bun install && bunx @biomejs/biome check packages/shared`

---

## PHASE 3: Fix better-sqlite3 -> bun:sqlite + Drizzle

Same as V3 PHASE 2, but Podman version.

```bash
cd apps/server
bun remove better-sqlite3 @types/better-sqlite3
bun add drizzle-orm
bun add -d drizzle-kit
cd ../..
```

Search and replace all `db.prepare` -> Drizzle.

---

## PHASE 4: Podman Dev Environment (NEW - Replaces docker-compose.dev)

**Why Podman for dev:** Hot reload with volumes, Redis in container, no local Redis install needed.

**Create `compose.dev.yaml` at root (Podman Compose):**
```yaml
services:
  redis:
    image: docker.io/library/redis:7-alpine
    container_name: meapp-redis-dev
    ports: ["6379:6379"]
    volumes: ["meapp-redis-data:/data"]
    restart: unless-stopped

  server:
    build:
      context: .
      dockerfile: apps/server/Dockerfile.dev
    container_name: meapp-server-dev
    ports: ["3000:3000"]
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

volumes:
  meapp-redis-data:
```

**Create `apps/server/Dockerfile.dev` (for dev with watch):**
```dockerfile
FROM docker.io/oven/bun:1.4 AS base
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY packages ./packages
COPY apps/server/package.json ./apps/server/package.json
RUN bun install
WORKDIR /app
EXPOSE 3000
CMD ["bun", "--watch", "apps/server/src/index.ts"]
```

**Commands for dev:**
```bash
# Start infra + server with hot reload
podman compose -f compose.dev.yaml up

# Or with podman-compose
podman-compose -f compose.dev.yaml up

# Logs
podman logs -f meapp-server-dev
podman logs -f meapp-redis-dev

# Stop
podman compose -f compose.dev.yaml down

# Clean
podman system prune -f
```

**Client dev (native + web) stays native for HMR speed:**
```bash
# In another terminal, still native (fastest)
bun --filter client dev        # Expo start for native
bun --filter client web        # Expo web on :8081

# If you REALLY want client in Podman too (slower HMR but fully containerized):
# Create apps/client/Dockerfile.dev with expo, but NOT recommended for 2 friends
```

**Why not put Expo in Podman for dev?** Expo needs to expose Metro bundler, watch files, and tunnel to phone via QR. Podman adds VM overhead on Mac/Windows, slows HMR. Best practice: Infra (Redis) in Podman, app code (Bun + Expo) natively with `bun --watch`. You still get Podman benefits for prod parity.

---

## PHASE 5: Migrate Fastify -> Elysia (Server)

Same as V3 PHASE 3 & 4, but ensure `apps/server/src/index.ts` uses Podman-friendly host `0.0.0.0`.

**File `apps/server/src/index.ts`:**
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
  .use(cors({ origin: (req) => true, credentials: true }))
  .use(swagger({ path: '/documentation' }))
  .use(cookie())
  .use(redisPlugin)
  .use(authPlugin)
  .use(authRoutes)
  .use(userRoutes)
  .use(roomRoutes)
  .use(messageRoutes)
  .use(chatWs)
  .get('/health', () => ({ status: 'ok', uptime: process.uptime(), podman: true }))
  .listen({ port: Number(process.env.PORT) || 3000, hostname: '0.0.0.0' })

export type App = typeof app
console.log(`🦊 Elysia + Podman at http://${app.server?.hostname}:${app.server?.port}`)
```

---

## PHASE 6: Socket.IO -> Elysia WS

Same as V3 PHASE 5, but add Redis pub/sub for multi-instance (Podman will run 1 instance, but prepare for 2).

File `apps/server/src/ws/chat.ts` same as V3, with optional Redis publish.

---

## PHASE 7: Client Axios -> Eden Treaty (Universal Web + Native)

Same as V3 PHASE 6 & 7, with universal storage.

**File `apps/client/src/lib/storage.ts`:**
```ts
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
export const storage = {
  get: async (k: string) => Platform.OS === 'web' ? localStorage.getItem(k) : await SecureStore.getItemAsync(k),
  set: async (k: string, v: string) => Platform.OS === 'web' ? localStorage.setItem(k, v) : await SecureStore.setItemAsync(k, v),
  del: async (k: string) => Platform.OS === 'web' ? localStorage.removeItem(k) : await SecureStore.deleteItemAsync(k)
}
```

**File `apps/client/src/lib/api.ts`:**
```ts
import { treaty } from '@elysiajs/eden'
import type { App } from '@meapp/server/src/index.ts'
import { storage } from './storage.js'
export const api = treaty<App>(process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000', {
  fetch: { credentials: 'include' } as any,
  headers: async () => {
    const token = await storage.get('token')
    return token ? { Authorization: `Bearer ${token}` } : {}
  }
})
```

---

## PHASE 8: Prod Infra - Podman Quadlet + Caddy (Replaces pm2 + Nginx)

**Why Caddy instead of Nginx:** Auto HTTPS via Let's Encrypt, 1-line config, works rootless with Podman.

**On VPS, create `~/Caddyfile`:**
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

**Create Quadlet for server `~/.config/containers/systemd/meapp.container`:**
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

**Create Quadlet for Redis `~/.config/containers/systemd/meapp-redis.container`:**
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

**Commands on VPS:**
```bash
mkdir -p ~/.config/containers/systemd
# copy .container files there
systemctl --user daemon-reload
systemctl --user enable --now meapp-redis.container
systemctl --user enable --now meapp.container
systemctl --user status meapp.container
journalctl --user -u meapp -f

# Auto-update
podman auto-update --dry-run
systemctl --user enable podman-auto-update.timer
```

**Dockerfile for prod `apps/server/Dockerfile`:**
```dockerfile
FROM docker.io/oven/bun:1.4 AS base
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

**Build + push from CI:**
```bash
podman build -t ghcr.io/meapp-labs/meapp:server -f apps/server/Dockerfile .
podman push ghcr.io/meapp-labs/meapp:server
```

---

## PHASE 9: CI/CD with Podman

**File `.github/workflows/cicd.yml`:**

```yaml
name: CI/CD Podman

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

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
            client: apps/client/**
            server: apps/server/**

  client:
    needs: detect-changes
    if: needs.detect-changes.outputs.client == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bunx @biomejs/biome check ./apps/client
      - run: bun --filter client export:web
      - name: Deploy web via rsync
        if: github.ref == 'refs/heads/main'
        run: |
          rsync -avz apps/client/dist/ user@server:/var/www/meapp-web/dist/
      - name: EAS OTA
        if: github.ref == 'refs/heads/main'
        run: |
          npm install -g eas-cli
          eas update --branch production --message ${{ github.sha }} --non-interactive
        env:
          EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}

  server:
    needs: detect-changes
    if: needs.detect-changes.outputs.server == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bunx @biomejs/biome check ./apps/server
      - run: bun --filter @meapp/server test
      - name: Build and push with Podman
        if: github.ref == 'refs/heads/main'
        run: |
          sudo apt update && sudo apt install podman -y
          echo ${{ secrets.GITHUB_TOKEN }} | podman login ghcr.io -u ${{ github.actor }} --password-stdin
          podman build -t ghcr.io/meapp-labs/meapp:server -f apps/server/Dockerfile .
          podman push ghcr.io/meapp-labs/meapp:server
      - name: Deploy via Quadlet
        if: github.ref == 'refs/heads/main'
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SSH_KEY }}
          script: |
            podman pull ghcr.io/meapp-labs/meapp:server
            systemctl --user restart meapp.container
            podman auto-update
```

---

## PHASE 10: Testing, Security, Performance

```bash
bun --filter @meapp/server test
bunx @biomejs/biome check --write ./apps ./packages
bun audit
podman run --rm -it --security-opt=no-new-privileges ghcr.io/meapp-labs/meapp:server bun audit
```

---

## PHASE 11: Other Better Replacements Checked

| Old | Replacement | Why Better | Use? |
|-----|-------------|------------|------|
| pm2 | Quadlet systemd | Rootless, auto-restart, logs via journalctl, no Node process manager needed | YES |
| Nginx | Caddy | Auto HTTPS, 3 lines config, Podman friendly | YES for prod |
| ESLint+Prettier | Biome | 10x faster, single tool, Rust, works in githooks | YES |
| Vitest | bun:test | Native, 5x faster, no config | YES |
| better-sqlite3 | bun:sqlite + Drizzle | Works on Bun, no native addon | YES |
| Axios | Eden Treaty | Shared types, no manual types | YES |
| Socket.IO | Elysia WS | Typed, lighter, 35MB vs 250MB per 10k | YES |
| Docker Desktop | Podman Desktop | Rootless, no license, Quadlet | YES for Linux, optional Mac/Win |
| Redis (optional) | Could use PGlite or Dragonfly | Not needed yet, keep Redis simple | KEEP Redis |
| SQLite file | Turso/libSQL | Edge replication | LATER, keep SQLite now |

---

## Final Verification (Podman Dev)

```bash
podman --version
podman compose -f compose.dev.yaml up -d
podman logs -f meapp-server-dev
# in other terminal
bun --filter client web # http://localhost:8081
bun --filter client start # Expo native
curl http://localhost:3000/health # should return {status:"ok", podman:true}
podman compose -f compose.dev.yaml down
```

- [ ] No docker command used, only podman
- [ ] No better-sqlite3, no socket.io, no axios
- [ ] Web + native both work
- [ ] Quadlet files exist
- [ ] Biome replaces ESLint
- [ ] Eden types work
