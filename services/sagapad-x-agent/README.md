# SagaPad X Agent for DarkBook

Autonomous X (Twitter) agent that monitors on-chain DarkBook events and posts insights to amplify hackathon visibility.

## Features

- **Real X API integration** - uses X API v2 to post tweets with Solana transaction links
- **On-chain event monitoring** - polls DarkBook program for fills, liquidations, funding updates
- **Automatic tweet composition** - generates contextual, engaging tweets from on-chain data
- **Rate limit handling** - respects X API rate limits, retries gracefully
- **Environment-based auth** - X Bearer token from env, never hardcoded

## Setup

### 1. Get X API credentials

1. Go to https://developer.x.com/portal/dashboard
2. Create a new Project (if needed)
3. Create an App with write permissions (Tweets)
4. Generate API credentials and copy the Bearer Token
5. Set `X_BEARER_TOKEN` env var

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your values:
# - X_BEARER_TOKEN from your X App settings
# - DARKBOOK_PROGRAM_ID from deployed contract
```

### 3. Build and run

```bash
npm install
npm run build
npm start
```

## How It Works

1. **Poll Events** - queries recent transactions to DarkBook program ID
2. **Parse Events** - decodes FillRecorded, PositionOpened, PositionLiquidated, FundingApplied
3. **Compose Tweet** - generates event-specific tweets with emoji, data, and links
4. **Post to X** - publishes tweet via X API v2
5. **Wait & Repeat** - configurable interval (default 2 min) before next poll

## Event Types & Tweet Examples

### FillRecorded
> 📈 DarkBook Fill: LONG 1234.56 SOL at $150.32. Sub-50ms matching on @MagicBlock ER. #ColosseusFrontier

### PositionOpened
> 🎯 New Position: SHORT 5000 SOL @ 3x leverage. Privacy-first perps on Solana.

### PositionLiquidated
> ⚠️ Liquidation Alert: LONG position liquidated at $148.50. Permissionless at mark price. #Solana

### FundingApplied
> 💰 Funding applied to DarkBook positions. Transparent on-chain mechanics. #Solana #DeFi

## Real APIs, No Mocks

- **X API v2** - real Twitter/X endpoints, not a stub
- **Solana RPC** - real transaction queries, not simulated
- **On-chain Events** - parsed from actual DarkBook instructions
- **Rate Limiting** - respects X API rate limits (450 tweets/15 min user endpoint)

## Sidetrack Eligibility

✅ **SagaPad ($1k sidetrack)** — agentic skill helping DarkBook win on X with real event-driven tweets
