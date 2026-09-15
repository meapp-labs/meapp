# MeApp - Communicator Application

## Project Overview
Full-stack communicator app with a React Native (Expo) client and an Elysia server.

## Tech Stack

### Client (apps/client)
- **Framework**: Expo 54, React 19, React Native 0.81
- **Routing**: Expo Router (file-based)
- **State**: Zustand (client state), TanStack Query (server state), React Native Async Storage
- **Forms**: React Hook Form + Zod validation
- **HTTP**: Axios
- **Platforms**: iOS, Android, Web

### Server (apps/server)
- **Runtime**: Bun (>=24.3.0)
- **Framework**: Elysia 1.4 (migrated off Fastify)
- **WebSockets**: Elysia WebSocket, ticket-authenticated via `POST /ws/ticket`
- **Database**: SQLite via `bun:sqlite` + Drizzle ORM (`packages/db`)
- **Cache/Sessions**: Redis (ioredis) for app data; sessions are a signed JWT in an HttpOnly cookie
- **Validation**: Zod schemas from `@meapp/shared` (plus Elysia TypeBox for query params)
- **Testing**: `bun:test` (Bun's built-in runner)

## Quick Start

### Prerequisites
- Bun >= 1.4 (client and server)
- Node.js >= 24.3 (server runtime target)
- Redis (server data store)

### Initial Setup
```bash
# Setup git hooks
git config core.hooksPath .githooks

# Client
cd apps/client
bun install
bun start

# Server (in new terminal)
cd apps/server
bun install
cp .env.example .env.local  # Set REDIS_URL and JWT_SECRET
redis-server                # Start Redis
bun dev
```

## Common Commands

### Client Commands (in apps/client)
```bash
bun start              # Start Expo dev server
bun run export:web     # Export static web build
bun run build:android:dev   # Local EAS Android dev build
bun run build:android:prod  # Local EAS Android production build
bun run lint           # Lint (Biome)
bun run lint:fix       # Fix linting
bun run format:fix     # Fix formatting
```

### Server Commands (in apps/server)
```bash
bun dev                # Dev server with hot reload
bun start              # Production server
bun test               # Run tests
bun test:watch         # Tests in watch mode
bun run migrate        # Run database migrations
# Linting/formatting/typecheck run from the repo root: bun lint, bun typecheck
```

## Project Structure
```
apps/client           - React Native Expo app
  /app                 - Expo Router pages (file-based routing)
apps/server           - Elysia API server
  src/index.ts         - Entry point: plugins, error mapping, route mounting
  src/plugins/         - redis, auth (session JWTs), rateLimit
  src/routes/          - REST endpoints under /api plus the WS ticket route
packages/db            - Drizzle schema, migrations and SQLite client
packages/shared        - Zod schemas and inferred types shared by client and server
/.githooks             - Pre-commit hooks (lint/format)
/.github/workflows     - CI/CD pipeline
```

## Key Architecture Details

### Client
- **Routing**: File-based via Expo Router in `/app` directory
- **State**: Zustand for local state, TanStack Query for API data
- **Forms**: React Hook Form with Zod schemas for validation
- **Environment**: Configure in `.env` or `.env.local`

### Server
- **Port**: http://localhost:3000 (default)
- **API Docs**: Swagger UI at `/swagger`
- **Sessions**: Signed JWT (`JWT_SECRET`) in an HttpOnly `access_token` cookie, 30 day expiry
- **Routes**: one module per resource in `src/routes/`, each mounted at `/api`; errors normalise to `{ message, code }`

## Development Notes
- Server requires Redis locally (`REDIS_URL`); the API tests skip themselves when it is absent
- Server reads `.env.local`: `PORT`, `HOST`, `REDIS_URL`, `JWT_SECRET` (+ optional `DOMAIN`, `WS_TICKET_SECRET`)
- Git hooks run linting/formatting checks pre-commit
- CI/CD auto-deploys to remote server on push to main
- Server managed by PM2 in production
- Always use type instead of interface
- There are strict TypeScript rules in `tsconfig.json` files, like no any or Promises need to be always awaited or with void
- Do not use default exports
- Use theming from theme.ts
- Add comments only for complex logic
- No need to run lint and format for every change

