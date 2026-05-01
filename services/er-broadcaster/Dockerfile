# DarkBook ER broadcaster service.
# Build from monorepo root:
#   docker build -f services/er-broadcaster/Dockerfile -t darkbook-er-broadcaster .
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
COPY services/er-broadcaster ./services/er-broadcaster
COPY --from=deps /app/sdk/node_modules ./sdk/node_modules
COPY --from=deps /app/services/er-broadcaster/node_modules ./services/er-broadcaster/node_modules
EXPOSE 8082
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:8082/health || exit 1
CMD ["bun", "run", "services/er-broadcaster/src/index.ts"]
