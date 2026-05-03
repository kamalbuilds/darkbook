# Zerion CLI Autonomous Trading Agent

Autonomous agent powered by Zerion CLI that polls portfolio data and executes trades on DarkBook with risk-aware position management.

## Features

- **Real Zerion CLI integration** - uses `zerion-cli` binary for portfolio analysis
- **Autonomous decision loop** - polls, analyzes signals, executes trades on configurable interval
- **Risk management** - enforces max position size, max leverage, max drawdown
- **DarkBook settlement** - atomic position creation with Solana confirmation
- **Environment-based secrets** - API key and keypair loaded from env, never hardcoded

## Setup

### 1. Install Zerion CLI

```bash
npm install -g zerion-cli
zerion init -y --browser  # Generates API key and persists it
```

### 2. Create agent keypair and fund it

```bash
solana-keygen new -o agent-keypair.json
# Fund the keypair with devnet SOL
solana airdrop 10 $(solana-keygen pubkey agent-keypair.json) -u devnet
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env with your values:
# - ZERION_API_KEY from `zerion init`
# - Path to agent-keypair.json
# - DARKBOOK_PROGRAM_ID from deployed contract
```

### 4. Build and run

```bash
npm install
npm run build
npm start
```

## How It Works

1. **Poll Portfolio** - calls `zerion analyze <wallet>` to fetch current holdings
2. **Analyze Signals** - evaluates market conditions (currently a placeholder; production would use Pyth Lazer for sub-ms feeds)
3. **Execute Trade** - if signal confidence meets threshold, places order on DarkBook within risk limits
4. **Wait & Repeat** - configured interval (default 60s) before next cycle

## Risk Controls

- **Max Position Size** - cap on USDC per order (e.g., 10,000 USDC)
- **Max Leverage** - limit on position multiplier (e.g., 5x)
- **Max Drawdown** - stop-loss trigger (e.g., 20% decline triggers close)

All configured via env vars; agent rejects orders that violate limits.

## Real APIs, No Mocks

- **Zerion CLI** - real `zerion-cli` binary, not a stub
- **DarkBook Settlement** - calls actual `@darkbook/sdk` methods
- **Solana RPC** - real devnet/mainnet connection
- **Funding** - expects real funded keypair, not hardcoded test account

## Sidetrack Eligibility

✅ **Zerion CLI ($5k sidetrack)** — autonomous agent using real Zerion CLI + real DarkBook settlement
