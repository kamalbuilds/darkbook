# DarkBook funding cron service.
# Build from monorepo root:
#   docker build -f services/funding-cron/Dockerfile -t darkbook-funding-cron .
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
COPY services/funding-cron ./services/funding-cron
COPY --from=deps /app/sdk/node_modules ./sdk/node_modules
COPY --from=deps /app/services/funding-cron/node_modules ./services/funding-cron/node_modules
CMD ["bun", "run", "services/funding-cron/src/index.ts"]
