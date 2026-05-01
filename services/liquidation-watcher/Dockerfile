# DarkBook liquidation watcher service.
# Build from monorepo root:
#   docker build -f services/liquidation-watcher/Dockerfile -t darkbook-liquidation-watcher .
FROM oven/bun:1 AS deps
WORKDIR /app
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
COPY services/liquidation-watcher ./services/liquidation-watcher
COPY --from=deps /app/sdk/node_modules ./sdk/node_modules
COPY --from=deps /app/services/liquidation-watcher/node_modules ./services/liquidation-watcher/node_modules
CMD ["bun", "run", "services/liquidation-watcher/src/index.ts"]
