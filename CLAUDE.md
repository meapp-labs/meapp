# MeApp - Communicator Application

## Project Overview
Full-stack communicator app with React Native (Expo) client and Fastify server.

## Tech Stack

### Client (/client)
- **Framework**: Expo 54, React 19, React Native 0.81
- **Routing**: Expo Router (file-based)
- **State**: Zustand (client state), TanStack Query (server state), React Native Async Storage
- **Forms**: React Hook Form + Zod validation
- **HTTP**: Axios
- **Platforms**: iOS, Android, Web

### Server (/server)
- **Runtime**: Bun (>=24.3.0)
- **Framework**: Fastify 5
- **WebSockets**: Socket.IO
- **Database**: SQLite (better-sqlite3)
- **Cache/Sessions**: Redis
- **Validation**: Zod schemas
- **Testing**: Vitest

## Quick Start

### Prerequisites
- Node.js/npm (for client)
- Bun (for server)
- Redis (for server sessions)

### Initial Setup
```bash
# Setup git hooks
git config core.hooksPath .githooks

# Client
cd client
npm install
npm start

# Server (in new terminal)
cd server
bun install
cp .env.example .env.local  # Edit with SESSION_SECRET and SESSION_SALT
redis-server                # Start Redis
bun dev
```

## Common Commands

### Client Commands (in /client)
```bash
npm start              # Start Expo dev server
npm run android        # Run on Android
npm run ios            # Run on iOS
npm run web            # Run on web
npm run export:web     # Export web build
npm run lint:fix       # Fix linting
npm run format:fix     # Fix formatting
```

### Server Commands (in /server)
```bash
bun dev                # Dev server with hot reload
bun start              # Production server
bun test               # Run tests
bun test:watch         # Tests in watch mode
bun lint:fix           # Fix linting
bun format:fix         # Fix formatting
```

## Project Structure
```
/client                - React Native Expo app
  /app                 - Expo Router pages (file-based routing)
/server                - Fastify API server
  server.ts            - Main entry point
  /plugins             - Fastify plugins (auto-loaded)
  /routes              - API routes (auto-loaded)
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
- **API Docs**: Swagger UI at `/documentation`
- **Sessions**: Secure sessions via Redis backend
- **Auto-loading**: Plugins and routes auto-loaded by Fastify

## Development Notes
- Server requires Redis running locally (`redis-server`)
- Server needs `.env.local` with `SESSION_SECRET` and `SESSION_SALT`
- Git hooks run linting/formatting checks pre-commit
- CI/CD auto-deploys to remote server on push to main
- Server managed by PM2 in production
- Always use type instead of interface
- There are strict TypeScript rules in `tsconfig.json` files, like no any or Promises need to be always awaited or with void
- Do not use default exports
- Use theming from theme.ts
- Add comments only for complex logic

