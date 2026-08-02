# DarkBook

**Exact size hidden until settlement. Sub-50ms matching on MagicBlock. Atomic Solana settlement.**

> The invention: **Dark Commit** — the deferred-reveal invariant every size-private order must satisfy.  
> `commitment = SHA-256(salt ‖ size_lots ‖ leverage_bps ‖ trader)` published at place; exact size revealed only at settlement and verified on-chain.

Honest privacy model (what is public vs hidden): [docs/PRIVACY_MODEL.md](./docs/PRIVACY_MODEL.md)

---

## What it is

DarkBook is a **size-private** central limit order book (CLOB) for perpetual futures on Solana. Orders match on a MagicBlock Ephemeral Rollup at sub-50ms latency. Exact lot size is bound by a SHA-256 commitment and revealed only at settlement. Side, price, leverage, size band (Small/Med/Large/Whale), and trader pubkey remain public on the book account. Settlement is atomic on Solana mainnet. PnL after fill is public.

This is a performance-privacy tradeoff for Solana perps: hide exact size from mempool snipers without ZK prover latency, accept residual trust in the ER validator and settler path.

- Architecture: see [ARCHITECTURE.md](./ARCHITECTURE.md)
- Privacy truth table: [docs/PRIVACY_MODEL.md](./docs/PRIVACY_MODEL.md)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  TRADER (Alice)                                                 │
│  Phantom wallet, USDC collateral deposited on mainnet           │
└────────────────────────┬────────────────────────────────────────┘
                         │ 1. place_order(side, price_ticks,
                         │    size_band, leverage_bps, commitment)
                         │    commitment = sha256(salt || size || lev || trader)
                         │    Public: side, price, size_band, leverage, trader
                         │    Hidden until settlement: exact size_lots
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  MAGICBLOCK EPHEMERAL ROLLUP                                    │
│  Single Anchor program `darkbook`, OrderBook PDA delegated here │
│  Validator: devnet-us.magicblock.app (MAS1Dt9...)               │
│  ├── match_orders: BTreeMap bids/asks, price-time priority      │
│  ├── Produces Fill { taker, maker, price, size_band, slot }     │
│  └── commit_book: state root committed to Solana mainnet        │
│  Latency: <50ms matching window between ER finalities           │
└────────────────────────┬────────────────────────────────────────┘
                         │ 2. ER commits OrderBook state root
                         │    settler service watches ER for fills
                         ▼
┌─────────────────────────────────────────────────────────────────----┐
│  SOLANA MAINNET (Anchor settlement program)                         │
│  ├── claim_fill: verifier reveals plaintext (both sides),           │
│  │              checks sha256 == commitment, creates Position       │
│  ├── Position { side, size_lots, entry_price, collateral }          │
│  ├── mark_position: reads Pyth price feed, updates unrealized       │
│  ├── update_funding + accrue_funding: 8h funding accrual            │
│  ├── liquidate_position: (remaining_after_pnl / locked) × 10_000    │
│  │    falls below 8_000 bps (80% maintenance); else NotLiquidatable │
│  └── close_position: trader-initiated exit, PnL realized            │
└────────────────────────┬─────────────────────────────────────----───┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│  OFF-CHAIN SERVICES (TypeScript / Bun)                          │
│  ├── settler: watches ER fills, calls claim_fill on mainnet     │
│  ├── liquidation-watcher: Pyth Lazer → collateral_ratio check   │
│  ├── funding-cron: 8h periodic update_funding + accrue          │
│  └── er-broadcaster: mirrors order book state for dashboard     │
└─────────────────────────────────────────────────────────────────┘
```

### Privacy Model (honest)

Full table: [docs/PRIVACY_MODEL.md](./docs/PRIVACY_MODEL.md). Short version:

| Field | Pre-settlement public? | Notes |
|-------|------------------------|-------|
| side, price_ticks | yes | required for CLOB price-time matching |
| size_band | yes | Small / Medium / Large / Whale ceiling |
| leverage_bps | yes | stored on Order account and events |
| trader pubkey | yes | stored on Order; needed for collateral / claim |
| exact size_lots | **no** | only SHA-256 commitment until claim_fill |
| salt | no | held by trader + settler channel |

- Off-chain: trader can encrypt payload with ECIES for the settler channel
- On-chain: `commitment = sha256(salt || size_lots_le || leverage_bps_le || trader_pubkey)`
- At settlement: plaintext revealed, contract verifies commitment, Position opens
- Residual trust: MagicBlock ER validator sees book accounts; settler sees plaintext sizes
- Not claimed: full dark pool, identity hide, or "Hyperliquid cannot copy"

### Mermaid (collapsible view)

```mermaid
sequenceDiagram
    participant T as Trader
    participant MB as MagicBlock ER
    participant SOL as Solana Mainnet
    participant PYTH as Pyth Lazer

    T->>SOL: deposit_collateral(USDC)
    T->>SOL: place_order(commitment, size_band, price, side)
    SOL->>MB: delegate OrderBook PDA
    MB->>MB: match_orders() fills BTreeMap
    MB->>SOL: commit_book (state root)
    Note over MB,SOL: settler service watches fills
    SOL->>SOL: claim_fill(plaintext_taker, plaintext_maker)
    SOL->>PYTH: verify oracle price
    SOL->>SOL: create Position accounts
    loop Every 8h
        SOL->>SOL: update_funding + accrue_funding
    end
    PYTH->>SOL: price update triggers mark / liquidate
```



---

## Quickstart

### Prerequisites

- Rust 1.78+ (`rustup default stable`)
- Solana CLI 1.18+ (`solana --version`)
- Anchor CLI 0.32.1 (`anchor --version`)
- Bun 1.1+ (`bun --version`)
- A Solana devnet wallet with SOL and USDC

### Install dependencies

```bash
git clone https://github.com/kamalbuilds/darkbook
cd darkbook
bun install
cd sdk && bun install && cd ..
cd dashboard && bun install && cd ..
```

### Build the Anchor program

```bash
anchor build
```

### Run tests (bankrun, no devnet required)

```bash
anchor test
```

### Deploy to devnet

```bash
cd scripts
bash deploy-devnet.sh
# Outputs deployed program ID — set DARKBOOK_PROGRAM_ID in .env
```

### Initialize a market (SOL/USDC)

```bash
bun run scripts/setup-market.ts \
  --asset SOL \
  --oracle 0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d \
  --max-leverage 1000 \
  --taker-fee 10 \
  --maker-rebate 3
```

### Run the dashboard (development)

```bash
cd dashboard
bun dev
# Open http://localhost:3000
```

### Run off-chain services

```bash
# Terminal 1: settler (watches ER fills, submits claim_fill)
cd services/settler && bun run index.ts

# Terminal 2: liquidation watcher
cd services/liquidation-watcher && bun run index.ts

# Terminal 3: ER broadcaster (mirrors order book for dashboard)
cd services/er-broadcaster && bun run index.ts

# Terminal 4: funding cron (8h period)
cd services/funding-cron && bun run index.ts
```

### Seed demo wallets (devnet)

```bash
bun run scripts/seed-demo.ts
# Creates Alice (short) + Bob (long) wallets, airdrops devnet SOL, places demo orders
```

---

## Tech Stack


| Layer            | Technology                                                            |
| ---------------- | --------------------------------------------------------------------- |
| Smart contract   | Anchor 0.32.1, Rust, single `darkbook` program                        |
| Ephemeral Rollup | MagicBlock BOLT SDK (`ephemeral-rollups-sdk 0.11.1`)                  |
| Oracle           | Pyth pull oracle (`pyth-solana-receiver-sdk 0.6.x`), Pyth Lazer WS    |
| Token standard   | SPL Token (plain), USDC collateral                                    |
| Order privacy    | ECIES off-chain encryption + sha256 commitment on-chain               |
| Settlement       | Jito bundles for atomic mainnet settlement                            |
| RPC              | Helius devnet (Geyser for position event streaming)                   |
| SDK              | Solana Web3.js v2, `@magicblock-labs/ephemeral-rollups-sdk`           |
| Frontend         | Next.js 16 App Router, shadcn/ui, TradingView Lightweight Charts      |
| Services         | TypeScript + Bun (settler, liq-watcher, funding-cron, er-broadcaster) |
| Testing          | bankrun (unit), Anchor tests on ER testnet (integration)              |


---

## Repo Layout

```
darkbook/
├── Anchor.toml
├── Cargo.toml
├── package.json
├── programs/darkbook/
│   └── src/
│       ├── lib.rs              # entrypoint, declare_id, mod re-exports
│       ├── state.rs            # account structs (Market, Position, OrderBook, Fill)
│       ├── errors.rs           # DarkbookError enum
│       ├── events.rs           # OrderPlaced, PositionOpened, Liquidated, etc.
│       ├── constants.rs        # PDA seeds, fee decimals
│       ├── matching_engine.rs  # pure BTreeMap matching logic
│       └── ix/
│           ├── admin.rs        # initialize_market, pause
│           ├── collateral.rs   # deposit_collateral, withdraw_collateral
│           ├── orders.rs       # place_order, cancel_order, delegate_book
│           ├── matching.rs     # match_orders (ER), commit_book, undelegate
│           ├── settlement.rs   # claim_fill
│           ├── positions.rs    # mark_position, liquidate_position, close_position
│           └── funding.rs      # update_funding, accrue_funding
├── sdk/                        # TypeScript DarkbookClient SDK
│   └── src/
│       ├── client.ts
│       ├── encryption.ts       # ECIES + commitment
│       ├── pyth.ts             # Lazer subscriber
│       ├── pdas.ts
│       └── types.ts
├── dashboard/                  # Next.js 16 app (Trade, Positions, History, Leaderboard)
├── services/
│   ├── settler/
│   ├── liquidation-watcher/
│   ├── funding-cron/
│   └── er-broadcaster/
├── tests/
│   ├── darkbook.ts             # bankrun unit tests
│   └── e2e-demo.ts             # end-to-end demo scenario
└── scripts/
    ├── deploy-devnet.sh
    ├── setup-market.ts
    └── seed-demo.ts
```

---

## Endpoints (devnet)


| Service                | URL                                                                  |
| ---------------------- | -------------------------------------------------------------------- |
| Solana devnet RPC      | `https://api.devnet.solana.com`                                      |
| MagicBlock ER (devnet) | `https://devnet-us.magicblock.app/`                                  |
| MagicBlock ER WS       | `wss://devnet-us.magicblock.app/`                                    |
| ER validator pubkey    | `MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57`                        |
| Pyth Lazer WS          | `wss://pyth-lazer.dourolabs.app/v1/stream`                           |
| SOL/USD feed ID        | `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d` |


---

## License

MIT

---

## Acknowledgements

- **Anatoly Yakovenko** — Percolator (immutable risk engine, Feb 2026). DarkBook extends the Percolator pattern to a private order book context. Same operational-safety philosophy: immutable settlement contract, burned admin keys, permissionless liquidators.
- **MagicBlock team** — Ephemeral Rollups SDK + devnet infrastructure that makes sub-50ms on-chain matching possible without a separate chain.
- **Pyth Network** — Lazer sub-ms price feeds that eliminate oracle latency as a bottleneck for liquidation accuracy.
- **Galaxy Digital** — ICM thesis (Oct 2025) framing Solana's destiny as "Nasdaq at the speed of light." DarkBook is infrastructure for that future.

