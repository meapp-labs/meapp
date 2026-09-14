FROM docker.io/oven/bun:1.4.2 AS base
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY packages ./packages
COPY apps/server/package.json ./apps/server/package.json
RUN bun install --frozen-lockfile
COPY apps/server ./apps/server
WORKDIR /app/apps/server
EXPOSE 3000
CMD ["bun", "src/index.ts"]
