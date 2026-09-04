# DarkBook

**The size-blind orderbook market makers quote on.** Exact taker size hidden until settlement. Sub-50ms matching on MagicBlock. Atomic Solana settlement.

> The primitive: **Dark Commit**. `commitment = SHA-256(salt || size_lots || leverage_bps || trader)` is published at place; exact size is revealed only at settlement and verified on-chain. This is the commit-reveal protocol Canidio and Danos prove stops the most severe front-running ([arXiv 2301.13785](https://arxiv.org/abs/2301.13785)), run at Ephemeral Rollup latency so the two-phase delay stops mattering.

Honest privacy model (what is public vs hidden): [docs/PRIVACY_MODEL.md](./docs/PRIVACY_MODEL.md)

---

## Direction (Sept 2026)

DarkBook started as a retail perps venue for whales. It is now being repositioned as **execution infrastructure for market makers**, and the customer change is the whole pivot. Full evidence in [docs/research/pivot/PIVOT_DECISION.md](./docs/research/pivot/PIVOT_DECISION.md). Short version:

- Every privacy or MEV-resistant DEX that won a Colosseum prize since 2024 is either dead or pivoted to infra (Blackpool, Vanish, URANI, Mato gone; Archer and Encifher pivoted). Zero are still a private DEX.
- Solana perps volume is $38B/30d and concentrated in GMTrade, Pacifica and Jupiter, none of which offer size privacy. A fourth retail venue does not win on volume.
- Market makers are the party that actually pays for adverse-selection protection, and Solana Foundation's **Frontier Traders** program (Aug 2026) now pays rebates to venues that bring makers on. Archer and Flint joined in the same week.
- RL market makers detect and adversely select split meta-orders ([2510.27334](https://arxiv.org/abs/2510.27334)); slicing a whale order does not hide it. A size-blind book is the structural fix.

So: same engine, same commit-reveal, same ER matching. New one-liner, new counterparty, new go-to-market.

**What changes**

| Was | Is |
|---|---|
| Whale trader hides size from snipers | Market maker quotes without being picked off on size |
| Retail perps terminal | Venue that plugs into Frontier Traders and aggregator flow |
| "Privacy" pitch | "Adverse selection" pitch, with the rebate schedule following [2501.12591](https://arxiv.org/abs/2501.12591) |
| Flat maker rebate | Frontier Traders funded rebate tiers |

**Open question we are answering first (Ascent residency, Sept 21 to 28):** if a maker cannot see taker size, do they quote tighter or wider? The agent-based literature ([2606.05882](https://arxiv.org/abs/2606.05882)) predicts wider unless size bands carry enough signal. Five maker interviews decide whether the pivot holds or we move the engine to a size-private prediction-market book instead.

**What is not claimed:** flow privacy. The fill tape after settlement leaks magnitude information ([2512.15720](https://arxiv.org/abs/2512.15720)). DarkBook hides pre-trade size, nothing more.

---

## What it is

DarkBook is a **size-private** central limit order book (CLOB) on Solana, currently for perpetual futures. Orders match on a MagicBlock Ephemeral Rollup at sub-50ms latency. Exact lot size is bound by a SHA-256 commitment and revealed only at settlement. Side, price, leverage, size band (Small/Med/Large/Whale), and trader pubkey remain public on the book account. Settlement is atomic on Solana mainnet. PnL after fill is public.

This is a performance-privacy tradeoff: hide exact size from anyone reading the book before the match, without ZK prover latency, accepting residual trust in the ER validator and settler path.

- Architecture: see [ARCHITECTURE.md](./ARCHITECTURE.md)
- Privacy truth table: [docs/PRIVACY_MODEL.md](./docs/PRIVACY_MODEL.md)
- Research log (Copilot data, winner outcomes, literature): [docs/research/](./docs/research/)

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
# Outputs deployed program ID, then set DARKBOOK_PROGRAM_ID in .env
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

- **Anatoly Yakovenko**: Percolator (immutable risk engine, Feb 2026). DarkBook extends the Percolator pattern to a private order book context. Same operational-safety philosophy: immutable settlement contract, burned admin keys, permissionless liquidators.
- **MagicBlock team**: Ephemeral Rollups SDK + devnet infrastructure that makes sub-50ms on-chain matching possible without a separate chain.
- **Pyth Network**: Lazer sub-ms price feeds that eliminate oracle latency as a bottleneck for liquidation accuracy.
- **Galaxy Digital**: ICM thesis (Oct 2025) framing Solana's destiny as "Nasdaq at the speed of light." DarkBook is infrastructure for that future.

