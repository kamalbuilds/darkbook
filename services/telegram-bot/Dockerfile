FROM oven/bun:1.2-alpine AS base
WORKDIR /app

# Copy workspace root manifests for dependency resolution
COPY package.json bun.lock* ./
COPY sdk/package.json ./sdk/
COPY services/telegram-bot/package.json ./services/telegram-bot/

# Install all workspace dependencies
RUN bun install --frozen-lockfile

# Copy source files
COPY sdk/ ./sdk/
COPY services/telegram-bot/ ./services/telegram-bot/

WORKDIR /app/services/telegram-bot

ENV NODE_ENV=production

CMD ["bun", "run", "src/index.ts"]
