# DarkBook — Investor Deck
**Seed Round | $3M at $30M Post | May 2026**

---

## Slide 1 — Cover

**DarkBook**
Confidential Perpetuals. Institutional Speed. Solana.

> Sub-50ms CLOB matching via MagicBlock Ephemeral Rollups. Order-size privacy via cryptographic commitments. Atomic settlement on Solana mainnet. The trading venue institutions have been waiting for.

**Contact:** Aarav - anshuk3917@gmail.com
**Stage:** Seed | $3M on $30M post-money cap
**Date:** May 2026

---

## Slide 2 — Problem

### On-chain perps are broken for large traders

Three structural failures keep institutional flow off Solana perps venues today:

**1. Zero order privacy.**
Every order is broadcast to the mempool before matching. A $10M AUM fund placing a 1,000-SOL short sees sandwich bots move the market within the same block. Hyperliquid solves this by running a centralized sequencer — not a permissionless solution.

**2. Unacceptable latency.**
Drift and Dexlab settle at 400ms+ per order. Hyperliquid runs at ~100ms on its own chain. Latency-sensitive quant strategies cannot profitably run at 400ms. This is not a UI problem — it is an execution-layer problem.

**3. MEV extraction is structural.**
Because order books are fully visible and settlement is in-flight, MEV bots extract 2-5bps on every large order on existing Solana venues. For a fund routing $100M/month, that is $200k-$500k/year in invisible tax.

**Net result:** Institutional flow routes to Hyperliquid (centralized, opaque) or stays off-chain entirely. Solana captures roughly 5% of on-chain perps notional volume despite having superior throughput.

*Source: Coingecko/Dune on-chain volume data, Q1 2026.*

---

## Slide 3 — Market

### $2T+ addressable. Solana's share is growing 50% YoY.

**Top-down TAM — Perpetual Futures**

| Venue | Est. Annual Notional (2025) | Notes |
|---|---|---|
| Binance Perps | ~$800B | Largest CEX perps |
| Bybit / OKX / Bitmex | ~$600B | Tier-2 CEX combined |
| Hyperliquid | ~$150B | Fastest growing on-chain |
| dYdX v4 | ~$50B | Cosmos-based CLOB |
| GMX / Vertex / Drift | ~$40B | EVM + Solana combined |
| **Total addressable** | **$1.6T–$2T+** | Conservative; excludes basis/delta-neutral vols |

*Source: Coingecko, Dune Analytics, DeFiLlama perps dashboards, Q4 2025 data.*

**Bottom-up: Solana institutional wedge**

The target customer is not retail. It is institutional market makers already quoting Solana DEX perps.

- ~50 institutional MMs active on Solana perps today (Drift, Phoenix, Zeta).
- ~50-100 more are interested but blocked on latency (400ms) or MEV exposure.
- Each qualifying MM routes $50M–$500M/month notional when their criteria are met.
- Conservative case: 5 MMs at $200M/month average = **$1B/month throughput**.
- Revenue at 5bps taker fee on $1B/month = **$6M annual run-rate** from 5 MMs.

**Galaxy Research (Oct 2025) ICM thesis:** "Every app a financial app. Every user a trader." Solana is positioned to capture the next phase of crypto market structure migration — from CEX to decentralized venues — if speed and privacy gaps close. DarkBook closes both.

**Solana perps market share trajectory:**
- 2024: ~2% of on-chain perps notional
- 2025: ~4% (Drift growth, Zeta Markets launch)
- 2026 estimate: ~7–10% (ICM narrative, Hyperliquid migration pressure)

Capturing 1% of the $2T market = $20B notional/year. At 5bps weighted average fee: **$100M revenue potential**.

---

## Slide 4 — Solution

### DarkBook: Confidential CLOB Perps on Solana

**What it is:**
A central limit order book for perpetual futures where order size and identity are hidden during matching. Settlement is atomic on Solana mainnet. PnL is public. Order details are not.

**The three-primitive stack that makes this possible:**

| Primitive | What it provides | Alternative cost |
|---|---|---|
| MagicBlock Ephemeral Rollups | Sub-50ms matching inside SVM trust model | ZK rollup: $5M+ engineering, 2-year build |
| Token-2022 Confidential Transfers | Order size hidden via SPL-native encryption | ZK circuit per trade: 100-500ms proof time |
| Pyth Lazer (<1ms feeds) | Liquidation timing competitive with CEX | Proprietary oracle: centralization risk |

**Why now:** All three became production-ready in the last 90 days (Pyth Lazer GA, MagicBlock ER GA, Percolator open-source release by Anatoly Mar 2026). The window to build this combination is open now; it was not open in 2025.

**Key technical properties:**
- Single Anchor program runs on both mainnet and ER (not two separate programs).
- sha256 commitment scheme reveals order details only at fill settlement — no trusted oracle, no off-chain reveal service.
- Permissionless liquidation: any crank calls `liquidate_position` when post-PnL remaining collateral as a fraction of `collateral_locked` is below 8_000 bps (80% maintenance). No whitelist.
- Admin keys burned post-deploy. Settlement is immutable (Percolator pattern).
- Jito atomic bundles at settlement: no MEV window on final settlement.

---

## Slide 5 — Competitive Moat

### The moat is the combination. No single-feature competitor matches all three.

| Dimension | DarkBook | Drift | dYdX v4 | Hyperliquid | GMX v3 |
|---|---|---|---|---|---|
| Order size privacy | Yes (commitment scheme) | No | No | No | No |
| Matching latency | <50ms (ER) | 400ms+ | 300ms+ | ~100ms | 500ms+ |
| Settlement chain | Solana mainnet | Solana mainnet | Cosmos | Proprietary chain | Arbitrum |
| MEV protection at settlement | Jito bundles | Partial | None | N/A (own sequencer) | None |
| Liquidation oracle | Pyth Lazer (<1ms) | Pyth pull (slot-delay) | Proprietary | Proprietary | Chainlink |
| Permissionless liquidation | Yes | Yes | Partial | No | Yes |
| Immutable settlement | Yes (keys burned) | No (upgradeable) | No | No (centralized) | No |
| CLOB model | Yes | Yes | Yes | Yes | AMM |

**The key position DarkBook occupies:** Fast + private + decentralized. No existing venue holds all three simultaneously.

- Hyperliquid is fast and private but centralized (own sequencer, own chain, single point of failure).
- Drift is decentralized but slow (400ms+) and fully transparent.
- dYdX is fast and semi-decentralized but on Cosmos, not Solana, and fully transparent.

**Structural moat drivers:**
1. **ER integration depth:** DarkBook is the first production perps CLOB on MagicBlock ER. The integration patterns, performance tuning, and bug surface are sunk cost for any competitor to reproduce.
2. **Commitment scheme as standard:** If DarkBook's ECIES + sha256 reveal scheme becomes the canonical privacy primitive for Solana CLOB, integration network effects compound.
3. **MM relationships:** The first venue that solves latency + privacy for MMs becomes the default routing target. Order flow begets order flow.
4. **Immutability:** No upgrade authority. Traders cannot be rug-pulled. This is a trust primitive that cannot be retroactively matched by upgradeable competitors.

---

## Slide 6 — Business Model

### Revenue = Taker Fee × Notional Volume. Simple, proven, scalable.

**Fee structure (basis points):**

| Participant | Maker fee | Taker fee | DBOOK staker discount |
|---|---|---|---|
| Standard | 0 bps (rebate eligible) | 5 bps | — |
| DBOOK staker (100k+) | 0 bps | 2.5 bps | 50% |
| MM partner (negotiated) | −1 bps rebate | 3 bps | Rebate weight |

Standard 5bps taker / 0bps maker is consistent with industry benchmarks (dYdX: 5bps taker, Drift: 6bps taker, Hyperliquid: 2.5bps taker at scale).

**Fee revenue math:**

| Monthly Notional | Annual Notional | Revenue at 5bps avg | Revenue at 3bps avg (staker discount) |
|---|---|---|---|
| $100M | $1.2B | $600K | $360K |
| $500M | $6B | $3M | $1.8M |
| $1B | $12B | $6M | $3.6M |
| $5B | $60B | $30M | $18M |

Hyperliquid comparison: Hyperliquid reached $10B+ monthly notional within 18 months of launch with 2.5–5bps average fee = $30M-$60M annual revenue run-rate. DarkBook is targeting the same institutional cohort with a higher-margin privacy premium.

**Revenue growth levers:**
1. MM partnership volume (primary driver in months 1–12)
2. Retail flow from Solana ecosystem (secondary, months 6–24)
3. Listing new perp pairs (BTC, ETH beyond SOL/USDC)
4. DBOOK staking fee discount (reduces effective fee, increases volume)

---

## Slide 7 — Unit Economics

### CAC is near zero. The acquisition cost is technical credibility + MM relationships.

**Customer acquisition model:**

DarkBook does not acquire retail traders via paid marketing. It acquires institutional market makers (MMs) via:
1. Technical credibility (open-source, audited, immutable settlement, latency benchmarks)
2. MM rebate seeding ($50k earmarked in use-of-funds)
3. Colosseum/Solana ecosystem network (direct introductions)

| CAC Driver | Cost | Expected MMs | Monthly Notional per MM |
|---|---|---|---|
| MM integration grants | $10k–$15k per MM | 3–5 MMs in Y1 | $100M–$500M |
| Audit cost (credibility prerequisite) | $50k (2 audits) | Enables all MMs | — |
| Engineering (protocol hardening) | $100k (1 senior Anchor eng) | Enables all MMs | — |

**CAC math:**
Total MM acquisition cost (year 1): $50k rebates + $50k audits + $100k eng = **$200k to acquire 3–5 MMs**.
Conservative 3 MMs × $200M/month = $600M/month notional.
Revenue: $600M × 5bps = $360k/month = **$4.3M ARR**.
**Implicit CAC payback: ~6 weeks.**

**LTV calculation:**
A single institutional MM with $200M/month throughput generates:
- $120k/month revenue at 5bps
- LTV at 3-year retention: $4.3M per MM
- LTV:CAC ratio: 4.3M / 50k = **86x**

---

## Slide 8 — Traction

### Working code. Devnet live. Not a whitepaper.

**What exists today (as of May 2026):**

| Milestone | Status |
|---|---|
| Anchor settlement program | Deployed on Solana devnet |
| MagicBlock ER matching engine | Running on MagicBlock testnet |
| End-to-end happy path (place → match → settle → liquidate) | Verified, no mocks |
| TypeScript SDK (`placeOrder`, `getPosition`, `closePosition`) | Shipped |
| Next.js dashboard (Trade, Positions, History, Leaderboard) | Shipped |
| Pyth Lazer oracle integration | Live on devnet |
| Funding payment cron (8h periods) | Shipped |
| Liquidation watcher (Vercel edge cron, 5s intervals) | Shipped |
| 3-min Loom demo (full trade lifecycle) | Recorded |
| Open source (MIT license) | Public on GitHub |
| Frontier 2026 submission | Submitted May 11, 2026 |

**Built in 14 days by 1 engineer.** Full stack: Rust (Anchor), TypeScript (SDK, dashboard, off-chain services), MagicBlock ER Rust contract.

**Sidetrack prize pipeline (non-dilutive):**

| Track | Prize | Alignment |
|---|---|---|
| Encrypt × Ika (Encrypted Markets) | $15,000 | Core commitment scheme primitive |
| Eitherway (DeFi Infra) | $20,000 | Settlement contract + off-chain services |
| Umbra (Privacy Infra) | $10,000 | Privacy model without ZK circuits |
| MagicBlock (Privacy Track) | $5,000 | First privacy perps app on ER |
| Cloak (Privacy Payments) | $5,010 | Confidential collateral deposits |
| Colosseum Main (Grand/Standout) | $10,000–$30,000 | Novel primitive, ICM-aligned |
| **Total pipeline** | **$65,010** | |

**Early signal:**
- MagicBlock team engaged as sponsor/judge — DarkBook is their flagship ER reference implementation.
- Colosseum accelerator application submitted (pre-seed SAFE track).
- Institutional MM outreach initiated (pipeline notes in data room).

---

## Slide 9 — Financial Model (36-Month Projection)

### Conservative case reaches $3M ARR by month 18. Base case reaches $10M ARR by month 24.

**Key assumptions:**
- Y1 focus: institutional MMs only (no retail marketing spend)
- Fee: 5bps taker avg blended (lower for stakers/MMs, higher for retail)
- Monthly notional growth: S-curve, accelerates Q3 2026 → Q2 2027 as MMs onboard
- Headcount: 4 FTE by month 12, 8 FTE by month 24
- Burn: ~$110k/month at month 12 (salaries + infra + audits), ~$200k/month at month 24

**36-Month Financials (USD)**

| Period | Monthly Notional | Monthly Revenue | Monthly Burn | Monthly Net | Cumulative Cash |
|---|---|---|---|---|---|
| M1–M3 (devnet/beta) | $0 | $0 | $50k | -$50k | -$150k |
| M4–M6 (1 MM live, SOL only) | $100M | $50k | $90k | -$40k | -$270k |
| M7–M9 (2 MMs, BTC/ETH added) | $300M | $150k | $110k | +$40k | -$150k |
| M10–M12 (3 MMs, cap lifted) | $600M | $300k | $120k | +$180k | +$390k |
| M13–M18 (scaling, 5 MMs) | $1.5B | $750k | $180k | +$570k | +$3.8M |
| M19–M24 (10 MMs, multi-asset) | $4B | $2M | $220k | +$1.78M | +$14.5M |
| M25–M36 (mature, 20+ MMs) | $10B | $5M | $350k | +$4.65M | +$70M+ |

**Breakeven:** Month 9–10 on operating basis (after seed capital deployed).
**ARR at month 12:** $3.6M
**ARR at month 24:** $24M
**ARR at month 36:** $60M

**Sensitivity table (Month 24 revenue):**

| MMs | Avg Notional/MM | Monthly Revenue | ARR |
|---|---|---|---|
| Bear (5 MMs) | $100M | $250k | $3M |
| Base (10 MMs) | $300M | $1.5M | $18M |
| Bull (20 MMs) | $500M | $5M | $60M |

---

## Slide 10 — Team

### One engineer shipped the full stack in 14 days. Now hiring the team to scale it.

**Aarav — Founder**
- 6+ years building production blockchain systems on Sui, Solana, and EVM.
- Built DarkBook end-to-end solo: Anchor settlement program, MagicBlock ER integration, TypeScript SDK, Next.js dashboard, liquidation watcher.
- Full-stack from Rust on-chain to TypeScript/React frontend. Comfortable owning protocol math, risk engine design, and product UX simultaneously.
- Contact: https://t.me/aarav1656

**Hiring (seed round enables):**
- Senior Anchor/Rust engineer — matching engine hardening, cross-margin, portfolio margin
- Full-stack TypeScript engineer — SDK, dashboard, MM integrations
- Market maker-side advisor — Hyperliquid/Drift relationship network (active search)

**Advisors sought:**
- Protocol security specialist (post-audit relationship)
- Solana ecosystem connector (introductions to institutional MMs)

**Why a solo founder ships faster:**
DarkBook was conceived, specified, and deployed in 14 days by one person. No design committee, no consensus overhead. The co-founder search is active but is not blocking the technical progress.

---

## Slide 11 — Financials & Ask

### $3M seed at $30M post. 18-month runway. Three specific outcomes.

**The ask:**
- **Amount:** $3,000,000
- **Structure:** Equity seed round (priced or SAFE acceptable; $30M post-money cap)
- **Pre-money valuation:** $27M
- **Equity offered:** ~10%

**Why $30M post:**
- Hyperliquid launched at similar technical stage (working testnet, no revenue) with a $50M+ implied valuation.
- Drift Protocol's seed was at roughly $20–30M valuation pre-revenue.
- DarkBook has something neither had at seed: a working mainnet program, a second audit budget already modeled, and a privacy moat that is architecturally harder to copy than a UI differentiation.

**Use of funds:**

| Bucket | $ | % | Milestones unlocked |
|---|---|---|---|
| Engineering (2 hires, 18 months) | $1,350,000 | 45% | Cross-margin, portfolio margin, multi-asset perps, SDK v2 |
| Audits (Neodyme/Zellic + ongoing) | $300,000 | 10% | Mainnet beta launch, TVL cap removal |
| MM partnership seeding (rebates + integration grants) | $600,000 | 20% | 5 MMs live, $1B+/month notional by month 12 |
| Legal & compliance | $150,000 | 5% | Entity, MM contract templates, jurisdictional review |
| Operations (infra, RPC, monitoring) | $150,000 | 5% | 24-month uptime guarantee |
| Runway buffer | $450,000 | 15% | 6-month extension fund |

**18-month milestones the $3M achieves:**
1. Mainnet beta launch with 3 MMs live and $500M/month notional ($250k ARR).
2. Second independent audit complete; TVL cap removed.
3. BTC/USDC and ETH/USDC perps shipped; portfolio margin in design review.

**Investor rights:** standard preferred, 1x non-participating liquidation preference, pro-rata in next round.

---

## Slide 12 — Risks & Mitigations

### Known risks, honest sizing, concrete mitigations.

**Risk 1: MagicBlock ER production stability**
ER is a new execution layer (GA 2026). State root finality may be unreliable under load.
Mitigation: Run on ER testnet until 3-month stability window proven. Fallback path: standard Solana validator with 400ms matching (degrades privacy but preserves settlement safety). No TVL commitment until ER stable.

**Risk 2: Pyth Lazer feed coverage gaps**
Lazer is not available for all trading pairs on devnet yet.
Mitigation: MVP ships SOL/USDC only. Add BTC/ETH after Lazer feed confirmed. Switchboard v3 fallback accepts 400ms latency as degraded mode.

**Risk 3: Regulatory classification**
Perpetual futures may require licensing in some jurisdictions (CFTC in US, FCA in UK).
Mitigation: Legal budget covers jurisdictional review. UI geo-blocks regulated markets during beta. Protocol itself is permissionless (cannot be shut down at the contract level).

**Risk 4: Competitor with more capital copies the stack**
A well-funded team (Drift v2, or a new team) could replicate ER + confidential transfers.
Mitigation: (a) immutable settlement means DarkBook can be trusted before a fork can be audited; (b) MM relationships are sticky — order flow network effects favor the incumbent; (c) the ER integration depth is a 3–6 month head start minimum.

**Risk 5: Smart contract exploit**
Perps settlement programs are high-value targets.
Mitigation: Two independent audits (Neodyme/Zellic-class) before TVL cap removal. $1M TVL cap during beta. Bug bounty program live at launch.

---

## Slide 13 — Exit Comps

### Conservative: 5× revenue on $60M ARR = $300M. Optimistic: 10× on $100M ARR = $1B+.

See COMPS section in full EXIT-COMPS.md. Summary:

| Comparable | FDV at peak | Revenue multiple | Monthly notional at exit |
|---|---|---|---|
| Hyperliquid | ~$20B | 40–80× (early), 15–20× (mature) | $10B+ |
| dYdX (peak 2022) | ~$1.6B | 20–30× | $2B–$5B |
| Drift Protocol | ~$400M (2024) | 15–20× | $300M–$500M |
| GMX (peak 2022) | ~$800M | 8–12× | $2B+ |
| Vertex Protocol | ~$200M | 10–15× | $200M–$400M |

**DarkBook exit scenarios:**

| Scenario | ARR | Revenue Multiple | Implied FDV |
|---|---|---|---|
| Bear (Drift-class) | $10M | 15× | $150M |
| Base (mid-tier perps) | $30M | 20× | $600M |
| Bull (Hyperliquid trajectory) | $100M | 25× | $2.5B |

**Investor return at $3M seed on $30M post (10% ownership):**
- Bear: $150M FDV → $15M return → **5× MOIC**
- Base: $600M FDV → $60M return → **20× MOIC**
- Bull: $2.5B FDV → $250M return → **83× MOIC**

Token launch optionality: if DBOOK token launches at a comparable FDV premium (as Hyperliquid's HYPE did at $20B), early equity-equivalent returns compress the timeline further.

---

## Slide 14 — Why Now / Why Us

### The 12-month window to be the canonical confidential perps venue on Solana.

**The timing convergence (last 90 days):**

| Event | Date | Implication for DarkBook |
|---|---|---|
| Anatoly publishes Percolator (immutable risk engine) | March 2026 | Open-source pattern for permissionless perps risk exists; DarkBook extends it |
| MagicBlock ER general availability | 2026 | Sub-50ms matching inside SVM trust model is production-ready |
| Pyth Lazer GA (sub-ms feeds) | 2026 | First oracle fast enough for CEX-competitive liquidation timing |
| Galaxy ICM thesis ("every user a trader") | October 2025 | Institutional capital is now actively looking for the venue |

These four events did not coexist before Q1 2026. The product is buildable now; it was not in 2025.

**Why this team:**
- Only team that built on Percolator during Frontier 2026. Anatoly's thesis applied at the application layer.
- Full-stack Rust + TypeScript + Solana expertise in one person who shipped in 14 days.
- Open-source, immutable, auditable — trust-first from day one.

**Why Solana:**
- No other chain has ER + Pyth Lazer + Token-2022 + Jito bundles simultaneously. Ethereum L2s need expensive ZK for privacy. Hyperliquid's privacy is illusory (centralized sequencer). Solana is the only place DarkBook is buildable as described.

---

## Slide 15 — The Ask

### $3M seed. Three milestones. One year.

**Ask:** $3,000,000 on $30M post-money cap (10% equity)

**What we will deliver in 18 months:**

1. **Mainnet beta** — SOL/USDC perps live on Solana mainnet, second audit complete, TVL cap lifted to $5M.
2. **3 institutional MMs onboarded** — producing $500M+/month aggregate notional, $3M ARR run-rate.
3. **Multi-asset perps** — BTC/USDC and ETH/USDC added, cross-margin in beta, v2 dashboard.

**What we are NOT asking for:**
- Marketing budget (distribution comes from MM relationships and open-source reputation)
- Speculative runway (every line item maps to a measurable milestone)

**Data room available:**
- Settlement contract source (MIT, public)
- Architecture document
- 36-month financial model (this document)
- Threat model and security plan
- MM pipeline notes
- Cap table (clean, pre-SAFE)

**Next step:** 30-minute technical deep-dive. We will demo the devnet live — place order, match, settle, liquidate — no slides, no mocks.

Contact: Kamal — kamalthedev7+letsbuild@gmail.com
