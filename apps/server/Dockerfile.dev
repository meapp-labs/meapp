FROM docker.io/oven/bun:1.4.2
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY packages ./packages
COPY apps/server/package.json ./apps/server/package.json
RUN bun install
WORKDIR /app
EXPOSE 3000
CMD ["bun", "--watch", "apps/server/src/index.ts"]
