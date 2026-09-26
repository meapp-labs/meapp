# AGENTS.md

## Goal

MeApp: monorepo chat app — Expo client (Android/web), Elysia/Bun server, SQLite (Drizzle) + Redis.
Bun workspaces: `apps/client`, `apps/server`, `packages/db`, `packages/shared`. Zod schemas in
`packages/shared` are the single contract used by BOTH client and server — change them there.

## Commands

```sh
bun run dev                # podman compose -f compose.dev.yaml up -d (redis + server)
bun run dev:server         # bun --filter @meapp/server dev
bun run dev:client         # bun --filter @meapp/client dev (Expo)
bun run dev:web            # bun --filter @meapp/client web
bun run typecheck && bun run lint   # all 4 workspaces + biome
bun --filter @meapp/server test     # bun test
bun --filter @meapp/server migrate  # drizzle migrations
```

## Entry

- Server: `apps/server/src/index.ts` (Elysia app, CORS/CSRF/rate-limit, `/health`)
- Routes: `apps/server/src/routes/` · WebSocket: `apps/server/src/ws/chat.ts`
- DB: `packages/db/src/schema.ts` · `sequence.ts` (message insert) · `client.ts` (lazy singletons)
- Client: `lib/api.ts` (fetch layer) · `lib/stores.ts` (zustand) · `services/` (react-query hooks)
  · `app/` (expo-router screens) · `components/chat/`

## How it works

- **Auth**: pure JWT — HttpOnly cookie (web) or Bearer header (native, token in expo-secure-store).
  No session tables. WebSocket requires a single-use ticket: `POST /api/ws/ticket {roomId}` →
  send `{"type":"auth","payload":{"ticket"}}` within 2 s of connecting.
- **Messages**: every insert goes through `insertMessageWithSequence()` (`packages/db/sequence.ts`)
  — per-room monotonic `sequence` + idempotency by `(userId, clientId)`. Server returns messages
  ascending by `sequence`; the client reverses once for its inverted FlatList.
- **Redis is optional at runtime**: when down, the server degrades — in-memory rate limits,
  in-memory WS tickets, local-only pub/sub. Don't add hard Redis dependencies in request paths
  without a fallback.
- **Env**: validated by zod at startup (`apps/server/src/lib/config.ts`); prod refuses dev
  secrets. Source of truth is `apps/server/.env.example` → copied to `apps/server/.env.local`
  (compose.dev.yaml loads it via `env_file`). Root `.env.example` is only a pointer.
- **SQLite**: WAL mode, single writer, loopback-only server. The production container has no
  `sqlite3` binary — back up with `bun -e "...VACUUM INTO..."` (see `deploy/README.md`).
- **Errors**: handlers throw `ApiError` from `apps/server/src/lib/errors.ts`; the client expects
  the `{message, code}` body shape.

## Boundaries

Ask before: changing `schema.ts`, `compose.*`, `Caddyfile`, `deploy/`, adding dependencies.
Never: edit `packages/db/drizzle/*` (generated), `bun.lock`, bind `0.0.0.0` (loopback only),
hardcode `EXPO_PUBLIC_API_URL`, insert messages outside `insertMessageWithSequence()`.
For schema changes, rebuild the database and its initial schema snapshot; do not add incremental
migrations unless the user explicitly requests them.

## Where to look

- Env truth: `apps/server/.env.example` · CI: `.github/workflows/cicd.yml`
- Prod deploy: `deploy/` (quadlets + backup/restore README)
- Rate limits & WS limits: `apps/server/src/plugins/rateLimit.ts`, `apps/server/src/ws/connectionManager.ts`
