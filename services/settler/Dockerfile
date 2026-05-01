# DarkBook settler service.
# Build context MUST be the monorepo root (so we can copy sdk/ + lockfile).
# From repo root:
#   docker build -f services/settler/Dockerfile -t darkbook-settler .
FROM oven/bun:1 AS deps
WORKDIR /app
# Copy lock + every workspace package.json so bun install resolves the graph.
COPY package.json bun.lock ./
COPY sdk/package.json ./sdk/
COPY dashboard/package.json ./dashboard/
COPY services/settler/package.json ./services/settler/
COPY services/er-broadcaster/package.json ./services/er-broadcaster/
COPY services/funding-cron/package.json ./services/funding-cron/
COPY services/liquidation-watcher/package.json ./services/liquidation-watcher/
RUN bun install --frozen-lockfile

FROM oven/bun:1 AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock ./
COPY sdk ./sdk
COPY services/settler ./services/settler
COPY --from=deps /app/sdk/node_modules ./sdk/node_modules
COPY --from=deps /app/services/settler/node_modules ./services/settler/node_modules
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:8081/health || exit 1
CMD ["bun", "run", "services/settler/src/index.ts"]
