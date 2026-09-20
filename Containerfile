# Stage 1: Build
FROM docker.io/oven/bun:1.4.2 AS builder
WORKDIR /app

COPY package.json bun.lock bunfig.toml ./
COPY packages ./packages
COPY apps/server ./apps/server

# --ignore-scripts: git is unavailable in the image (prepare script needs it)
RUN git config --global --add safe.directory '*' || true && \
    bun install --frozen-lockfile --ignore-scripts
RUN bun build apps/server/src/index.ts --outdir ./apps/server/dist --target bun && \
    bun build apps/server/src/migrate.ts --outdir ./apps/server/dist --target bun

# Stage 2: Production runner
FROM docker.io/oven/bun:1.4.2 AS runner
WORKDIR /app

ENV NODE_ENV=production

# Install production dependencies
COPY package.json bun.lock bunfig.toml ./
COPY packages ./packages
COPY apps/server/package.json ./apps/server/package.json
RUN bun install --frozen-lockfile --production --ignore-scripts

# migrate.js resolves the migrations folder relative to its own location,
# so drizzle must exist at both paths.
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY packages/db/drizzle ./apps/server/drizzle
COPY packages/db/drizzle ./packages/db/drizzle

# Migrate (idempotent), then serve.
RUN printf '#!/bin/sh\nbun apps/server/dist/migrate.js\nexec bun apps/server/dist/index.js\n' \
      > /usr/local/bin/start && chmod +x /usr/local/bin/start

# Run as non-root user
RUN mkdir -p /app/data && chown -R bun:bun /app
USER bun

EXPOSE 3000

# start-period 20s: allow cold SQLite WAL recovery + first migration check
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=3 \
  CMD bun --eval 'fetch("http://localhost:3000/health").then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))'

CMD ["start"]
