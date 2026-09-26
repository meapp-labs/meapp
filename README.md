# MeApp

A cross-platform messaging app: Expo (Android + web) client with an Elysia/Bun API server,
SQLite storage, and Redis-backed rate limiting and WebSocket fan-out.

## Features

- Real-time chat over WebSocket (single-use ticket auth)
- Direct messages and group conversations
- Push notifications (Android, Expo)
- Rate limiting, login lockout, and CSRF/CORS hardening built in
- Containerized dev and production deployments (Podman + Caddy)

## Stack

| Layer    | Tech                                          |
| -------- | --------------------------------------------- |
| Client   | Expo / React Native, react-query, zustand     |
| Server   | Elysia on Bun, JWT auth, Drizzle ORM          |
| Database | SQLite (WAL mode)                             |
| Cache    | Redis (rate limits, tickets, pub/sub)         |
| Deploy   | Podman / podman-compose, Caddy, GitHub Actions|

## Quickstart

Prerequisites: [Bun](https://bun.sh) and [Podman](https://podman.io).

```sh
# 1. Configure environment
cp apps/server/.env.example apps/server/.env.local
# edit JWT_SECRET / WS_TICKET_SECRET

# 2. Start Redis, the API server, and Expo
bun run dev

# Or run either app separately
bun run dev:server
bun run dev:client
bun run dev:web
```

The server listens on `127.0.0.1:3000` (loopback only — Caddy fronts it in production).
`bun run dev` starts Redis directly through Podman, so it does not require a Compose provider.
Redis remains available after the dev process exits and is reused on the next run.
Interactive API docs are served at `/swagger` when the server is running.

## Development

```sh
bun run typecheck          # typecheck all workspaces
bun run lint               # biome check
bun --filter @meapp/server test
bun --filter @meapp/server migrate
sh scripts/chaos-test.sh   # DB concurrency + backup verification
```

## Project structure

```
apps/
  client/    Expo app (screens, components, services, hooks)
  server/    Elysia API (routes, ws, plugins, lib)
packages/
  shared/    Zod schemas + types shared by client and server
  db/        Drizzle schema, migrations, SQLite client
deploy/      Production quadlet units + backup/restore docs
scripts/     Chaos test, migration guard
```

## Production

See [`deploy/README.md`](deploy/README.md) for the quadlet-based deployment,
pre-migration backups (`VACUUM INTO`), and restore procedure. CI (`.github/workflows/cicd.yml`)
builds an immutable image tag, scans it with Trivy, migrates, and deploys with health-check
rollback.
