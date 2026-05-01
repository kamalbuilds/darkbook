FROM oven/bun:1.1-alpine AS base

WORKDIR /app

# Copy workspace root files needed by bun workspaces
COPY package.json bun.lock ./
COPY services/faucet/package.json ./services/faucet/

# Install only faucet's dependencies (production + dev for typecheck)
WORKDIR /app/services/faucet
RUN bun install --frozen-lockfile

# Copy source
COPY services/faucet/src ./src
COPY services/faucet/tsconfig.json ./

EXPOSE 8083

ENV NODE_ENV=production
ENV FAUCET_PORT=8083

CMD ["bun", "run", "src/index.ts"]
