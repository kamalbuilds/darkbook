# DarkBook — DBOOK Token Design
**Version 1.0 | May 2026**

---

## 1. Summary

| Parameter | Value |
|---|---|
| Token name | DBOOK |
| Chain | Solana (SPL token) |
| Total supply | 1,000,000,000 (1B) |
| Initial circulating supply at TGE | ~100M (10%) |
| TGE valuation target | $30M–$50M FDV |
| Token standard | SPL Token-2022 |
| Primary utility | Fee discount, governance, MM rebate weight |

DBOOK is a fee-utility and governance token. It is not a revenue-sharing token. The protocol does not promise dividends or profit distribution. Token value derives from fee discount optionality, governance rights over protocol parameters, and rebate weighting for market makers.

---

## 2. Supply Distribution

**Total supply: 1,000,000,000 DBOOK**

| Bucket | % | Tokens | Purpose |
|---|---|---|---|
| Community & Airdrop | 30% | 300,000,000 | Retroactive airdrop to perps traders, early users, MM partners |
| Ecosystem Fund | 25% | 250,000,000 | LP incentives, MM rebates, grants, developer ecosystem |
| Team | 20% | 200,000,000 | Founders + future hires |
| Investors | 15% | 150,000,000 | Seed + future rounds |
| Treasury | 10% | 100,000,000 | Protocol ops, audits, emergency reserve |

### Rationale for allocation

**Community/Airdrop at 30%:** Perps venues live and die on trader acquisition. The largest allocation goes to the people who generate volume. Comparable: Hyperliquid allocated 31% to community in its genesis distribution; dYdX allocated 27.7% to users/community. DarkBook's 30% is at the upper bound of precedent, appropriate for a venue with no VC-backed marketing budget.

**Ecosystem Fund at 25%:** This is the operating capital for the protocol's flywheel — MM rebates, LP rewards, and developer grants. Without a funded ecosystem bucket, early MMs have no incentive to provide liquidity at worse-than-CEX spreads.

**Team at 20%:** Standard for early-stage crypto protocol. Four-year vest with one-year cliff. Alignment duration matches the expected time to significant protocol revenue (month 18–24 target).

**Investors at 15%:** Seed round (this round): 10% of supply (150M tokens / 1B total, but only 100M allocated to this round at $30M FDV = $3M proceeds). Reserve capacity for future rounds within the 15% bucket.

**Treasury at 10%:** Non-dilutive reserve. Used only for protocol-level emergencies (bridge hack recovery, oracle failure), ongoing audit costs, and multi-sig governance transitions.

---

## 3. Vesting Schedule

| Bucket | TGE unlock | Cliff | Vest duration | Monthly unlock post-cliff |
|---|---|---|---|---|
| Community/Airdrop | 30% (90M at TGE) | None | 18 months linear | ~11.7M/month |
| Ecosystem Fund | 10% (25M at TGE) | 6 months | 36 months linear | ~6.25M/month |
| Team | 0% | 12 months | 48 months linear | ~4.17M/month |
| Investors (seed) | 0% | 6 months | 24 months linear | ~6.25M/month |
| Treasury | 0% | 12 months | 48 months linear | ~2.08M/month |

**Initial circulating supply at TGE:**
- Community airdrop unlock: 90M (30% of 300M tranche)
- Ecosystem Fund unlock: 25M (10% of 250M tranche)
- **Total TGE circulating: 115M (~11.5% of total supply)**

**Circulating supply schedule:**

| Month | New unlock | Cumulative circulating | % of total |
|---|---|---|---|
| 0 (TGE) | 115M | 115M | 11.5% |
| 6 | ~70M | 185M | 18.5% |
| 12 | ~95M (team+treasury unlock begins) | 280M | 28% |
| 18 | ~90M | 370M | 37% |
| 24 | ~80M (community fully vested) | 450M | 45% |
| 36 | ~130M | 580M | 58% |
| 48 | ~420M | 1B | 100% |

**Inflation pressure assessment:** TGE circulating is 11.5%. Growth to 28% by month 12 is moderate for a DeFi protocol. Comparable: dYdX circulating at 12 months post-TGE was ~25–30% of total; Drift was ~22%.

---

## 4. Token Utility

### 4.1 Fee Discount (Primary Utility)

Staking DBOOK reduces taker fees. Staking is non-slashable and non-lockup-required (any amount qualifies for tier, but minimum hold periods apply for discount activation).

| Tier | DBOOK Staked | Taker Fee | Discount vs. baseline |
|---|---|---|---|
| Standard | 0 | 5bps | — |
| Bronze | 10,000 | 4bps | 20% |
| Silver | 50,000 | 3bps | 40% |
| Gold | 100,000 | 2.5bps | 50% |
| Platinum | 500,000 | 2bps | 60% |

At $0.03/DBOOK (conservative TGE price at $30M FDV / 1B supply), Gold tier requires $3,000 staked to earn 50% fee discount. A trader paying 5bps on $10M/month volume ($5,000/month in fees) saves $2,500/month by staking $3,000 of DBOOK. Payback period: ~5 weeks. This creates genuine demand, not speculative demand.

### 4.2 Market Maker Rebate Weight

The Ecosystem Fund pays MM rebates. The rebate amount a given MM receives is weighted by DBOOK staked relative to total MM DBOOK staked.

Rebate weight = (MM_DBOOK_staked / Total_MM_DBOOK_staked) × Monthly_Rebate_Pool

Example: If 5 MMs collectively stake 10M DBOOK, and MM Alice stakes 3M, she receives 30% of the monthly rebate pool. Monthly rebate pool size is governed by DBOOK holders (see 4.3).

This creates structural buy pressure from MMs proportional to their desire for rebate share.

### 4.3 Governance

DBOOK holders vote on:
- Fee schedule changes (maker/taker bps per tier)
- Monthly rebate pool size (from Ecosystem Fund)
- Listing new perps pairs (approval gate)
- Treasury disbursements above $100k
- Settlement program upgrade authorization (irrelevant post-immutability, but applies to UI/SDK governance)

Quorum: 5% of circulating supply. Threshold: 66% of quorum votes.

Governance is delayed from TGE by 6 months to prevent early token dumps weaponizing governance. First governance vote: month 7 (BTC/USDC pair listing proposal).

### 4.4 Staking Lockup Rewards

Users who voluntarily lock DBOOK (30-day, 90-day, or 180-day lockup) earn additional DBOOK from the Ecosystem Fund. This creates a sticky supply sink.

| Lockup | Additional annual yield |
|---|---|
| 30-day | 5% APY in DBOOK |
| 90-day | 10% APY in DBOOK |
| 180-day | 15% APY in DBOOK |

Yield source: Ecosystem Fund (25% of supply). At 15% APY on 100M staked DBOOK, annual emission is 15M DBOOK (~1.5% of total supply). Sustainable for 6+ years before Ecosystem Fund depletion.

---

## 5. Airdrop Design

**Target: 300M DBOOK to perps traders and ecosystem contributors.**

### 5.1 Eligibility Criteria

| Cohort | Allocation | Criteria |
|---|---|---|
| DarkBook early users (devnet + beta) | 60M (20%) | Used devnet, placed at least 1 order, non-Sybil |
| Drift / Dexlab / Zeta traders | 90M (30%) | $10k+ notional traded on Solana perps venues, Q1 2025 – Q2 2026 |
| Hyperliquid traders (cross-chain) | 60M (20%) | $50k+ notional on Hyperliquid, proving institutional appetite |
| Open-source contributors | 15M (5%) | GitHub contributors, audit reviewers, SDK integrations |
| MM partners (strategic airdrop) | 60M (20%) | MMs who complete integration, minimum 30-day active quoting |
| Community events / Colosseum | 15M (5%) | Frontier 2026 attendees, ecosystem events |

### 5.2 Anti-Sybil

- On-chain activity minimum: 10+ transactions on Solana mainnet prior to snapshot date.
- Minimum position size threshold for all trader cohorts.
- Unique wallet per person (verified via wallet activity pattern analysis, not KYC).

### 5.3 TGE Unlock

30% of airdrop (90M DBOOK) unlocks immediately at TGE. Remaining 70% (210M) vests linearly over 18 months. This avoids immediate dump pressure while still rewarding early users.

### 5.4 Comparable Airdrops

| Protocol | Airdrop size | % of supply | Outcome |
|---|---|---|---|
| dYdX | 75M tokens | 7.5% | $2B FDV on announcement day |
| Drift | ~60M tokens | ~10% | $400M FDV sustained post-airdrop |
| Jito | 10% of supply | 10% | $5B+ FDV; benchmark for Solana airdrop quality |
| Hyperliquid (HYPE) | 310M tokens (31%) | 31% | ~$20B FDV; the reference case |

DarkBook's 30% community allocation positions it at the Hyperliquid end of the generosity spectrum. Given zero VC marketing budget, community-driven distribution is both the principled and practical choice.

---

## 6. Token Launch Considerations

### 6.1 TGE Timing

Target: Q4 2026, after:
- Mainnet beta has been live 60+ days.
- Second audit complete.
- At least 1 MM producing $100M+/month notional (proof of protocol-market fit).
- Legal structure confirmed.

Premature TGE (before protocol-market fit) destroys token value permanently and is excluded from the plan.

### 6.2 Launch Venue

Priority: Raydium CLMM pool (SOL/DBOOK pair) as the primary DEX liquidity source. Approach CEX listings (Bybit, OKX, Kraken) only after $500M+ FDV sustained for 30+ days post-TGE. CEX listing costs ($250k–$1M in market-making fees) do not make sense at sub-$100M FDV.

### 6.3 Initial Liquidity

From Ecosystem Fund: 10M DBOOK + $300k USDC deployed as initial Raydium CLMM liquidity at TGE.
This provides ~$600k of liquidity at $0.03/DBOOK, sufficient for price discovery without early manipulation.

### 6.4 Price Targets

| Phase | FDV | Implied DBOOK price | Milestone |
|---|---|---|---|
| TGE | $30M | $0.030 | Protocol live, 1 MM |
| Month 6 post-TGE | $75M | $0.075 | 3 MMs, $300M/mo notional |
| Month 12 post-TGE | $200M | $0.200 | 5 MMs, $1B/mo notional, BTC/ETH added |
| Month 24 post-TGE | $500M–$1B | $0.50–$1.00 | 10+ MMs, $5B/mo notional |

These are not promises. They are internal planning targets tied to specific protocol milestones.

---

## 7. Token Economics Summary

**Why DBOOK has non-speculative demand:**
1. Fee discount is math: traders paying $5k/month in fees will buy $3k of DBOOK to save $2.5k/month. Payback in 5 weeks. Demand is continuous, not event-driven.
2. MM rebate weight: institutional MMs competing for rebate share must acquire and stake DBOOK. Volume begets DBOOK demand.
3. Governance: listing new pairs is a governance vote. Traders who want BTC/USDC perps need to own DBOOK to vote yes.

**Why DBOOK is not inflationary junk:**
1. Total supply is fixed at 1B. No mint authority retained (burned post-distribution).
2. Ecosystem Fund emission is governed — DBOOK holders vote on rebate pool size.
3. Staking lockup removes supply from circulation (30–180 day lockups create consistent sink).
4. TGE circulating is only 11.5% — no single unlock event creates >5% new supply in any given month.

**Comparable token supply schedules at seed stage:**

| Protocol | Seed % allocated | Seed cliff | Seed vest |
|---|---|---|---|
| dYdX | 15.3% | 18 months | 24 months |
| Vertex | 10% | 12 months | 24 months |
| Drift | 12% | 12 months | 24 months |
| **DarkBook (DBOOK)** | **15%** | **6 months** | **24 months** |

DarkBook seed vesting is at-market. The 6-month cliff (vs. 12-month industry average) is shorter but paired with a 24-month full vest, net alignment period is similar to peers.

---

## 8. Treasury Multi-Sig Structure

At TGE, Treasury (10%, 100M DBOOK) is controlled by a 3-of-5 Squads multi-sig:
- Founder key
- Lead investor key
- MagicBlock ecosystem key (if partnership formalized)
- Security researcher key (post-audit relationship)
- Colosseum / advisor key

Any treasury disbursement above 1M DBOOK requires 3-of-5 signature and a 48-hour timelock.

All Ecosystem Fund disbursements above 5M DBOOK require governance vote (see 4.3) followed by multi-sig execution.

---

*This document is for investor informational purposes. DBOOK token has not been issued. Nothing herein constitutes an offer to sell securities. Legal review pending entity formation.*
