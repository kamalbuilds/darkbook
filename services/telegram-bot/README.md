# DarkBook Telegram Bot

Real-time Telegram notifications for DarkBook on-chain events (OrderPlaced, FillRecorded, PositionOpened, PositionLiquidated, FundingPaid).

## Setup

### 1. Get a Bot Token from BotFather

1. Open Telegram and search for `@BotFather`
2. Send `/newbot` and follow the prompts
3. Copy the token (format: `123456789:ABCdef...`)

### 2. Environment Variables

Create a `.env` file (never commit this):

```
TELEGRAM_BOT_TOKEN=<your_token_from_botfather>
RPC_URL=https://api.devnet.solana.com
PROGRAM_ID=9i4Gpnt8GgrwxqwXdEyjFBsfNChis8z9jmyAbMpFVLcS
DB_PATH=bot.db
LOG_LEVEL=info
```

### 3. Run locally with Bun

```bash
cd services/telegram-bot
bun install
bun run src/index.ts
```

### 4. Run with Docker

Build from the workspace root:

```bash
# From darkbook/ root
docker build -f services/telegram-bot/Dockerfile -t darkbook-telegram-bot .

docker run -d \
  --name darkbook-bot \
  -e TELEGRAM_BOT_TOKEN=<token> \
  -e RPC_URL=https://api.devnet.solana.com \
  -e PROGRAM_ID=9i4Gpnt8GgrwxqwXdEyjFBsfNChis8z9jmyAbMpFVLcS \
  -v $(pwd)/bot.db:/app/services/telegram-bot/bot.db \
  darkbook-telegram-bot
```

## Deploy to fly.io

### Prerequisites

```bash
brew install flyctl
fly auth login
```

### Create fly.toml

```toml
app = "darkbook-telegram-bot"
primary_region = "ord"

[build]

[env]
  RPC_URL = "https://api.devnet.solana.com"
  PROGRAM_ID = "9i4Gpnt8GgrwxqwXdEyjFBsfNChis8z9jmyAbMpFVLcS"
  LOG_LEVEL = "info"

[[mounts]]
  source = "bot_data"
  destination = "/data"

[processes]
  app = "bun run src/index.ts"
```

Set the bot token as a secret (never in fly.toml):

```bash
fly secrets set TELEGRAM_BOT_TOKEN=<your_token>
fly secrets set DB_PATH=/data/bot.db
```

Deploy:

```bash
fly launch --dockerfile services/telegram-bot/Dockerfile --name darkbook-telegram-bot
fly deploy
```

Check logs:

```bash
fly logs --app darkbook-telegram-bot
```

## Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/subscribe <wallet> <events>` | Register wallet for alerts |
| `/unsubscribe` | Remove your subscription |
| `/list` | Show your subscriptions |
| `/markets` | List all DarkBook markets with stats |
| `/positions <wallet>` | Show open positions for a wallet |
| `/help` | Show all commands |

### Subscribe Examples

Subscribe to all events:
```
/subscribe <your_solana_wallet> all
```

Subscribe to specific events:
```
/subscribe <your_solana_wallet> OrderPlaced,FillRecorded
```

Valid event types: `OrderPlaced`, `FillRecorded`, `PositionOpened`, `PositionLiquidated`, `FundingPaid`

## Architecture

- **grammy**: Telegram bot framework (long-polling, no webhook server needed)
- **bun:sqlite**: Native SQLite for subscriber storage (zero-dependency, fast)
- **connection.onLogs**: Real on-chain log subscription, no polling
- Rate limiting: max 1 message per chat per 5 seconds (Telegram API constraint)
- Graceful shutdown: removes log subscription, stops bot, closes DB on SIGTERM/SIGINT

## Log-only Mode

If `TELEGRAM_BOT_TOKEN` is not set, the bot starts in log-only mode: it subscribes to on-chain events and logs them via pino, but does not start a Telegram bot or send any messages. This is useful for testing the event pipeline without a bot token.
