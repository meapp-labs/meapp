# Stage 1: Build
FROM docker.io/oven/bun:1.4.2 AS builder
WORKDIR /app

COPY package.json bun.lock bunfig.toml ./
COPY packages ./packages
COPY apps/server ./apps/server

RUN bun install --frozen-lockfile
RUN bun build apps/server/src/index.ts --outdir ./apps/server/dist --target bun

# Stage 2: Production runner
FROM docker.io/oven/bun:1.4.2 AS runner
WORKDIR /app

ENV NODE_ENV=production

# Install production dependencies
COPY package.json bun.lock bunfig.toml ./
COPY packages ./packages
COPY apps/server/package.json ./apps/server/package.json
RUN bun install --frozen-lockfile --production

# Copy built artifacts and migrations
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY packages/db/drizzle ./packages/db/drizzle

# Run as non-root user
RUN mkdir -p /app/data && chown -R bun:bun /app
USER bun

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD bun --eval 'fetch("http://localhost:3000/health").then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))'

CMD ["bun", "apps/server/dist/index.js"]
