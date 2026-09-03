# Ascent (Superteam India DeFi Residency): DarkBook or something else?

Date: 2026-09-03. **Applications close today** (@SuperteamIN tweet 2095531626285732044, 15:17 UTC).

## Verdict

**Apply with DarkBook today. Do not build something new.** There is no time to build, and the form rewards live links + traction over idea quality. Reframe DarkBook as a shipped Solana perps venue with a narrow, honest wedge, and use the residency to fix its real gap (users, GTM), which is exactly what Ascent says it does.

## What Ascent actually selects for (form is the rubric)

Airtable form fields (read via Brave, 2026-09-03):

| Field | Implication |
|---|---|
| "What are you working on? (Live links preferred)" | Need live URL. DarkBook has one: darkbook-solana.vercel.app (200), devnet program `3F99U2...E7yf` live. |
| "Project Demo: Loom/YouTube, no decks, max 3 min" | **Missing. Must record today.** |
| "How long working on this?" min option `>6 months` | DarkBook git: 2026-05-12 to 2026-08-03 (~4 months). Pick `>6 months` only if counting research/prior work; otherwise honest answer is the lowest bucket anyway. |
| "What traction? volume, users, integrations" | Weak spot. Have: Frontier submission, MagicBlock/Pyth/Jito/Encrypt integrations, devnet e2e. No users/volume. |
| Category: Grant / VC / Accelerator / Bootstrapped | Bootstrapped. |
| Goal: co-founder / liquidity / hire / raise / MMs+VCs | Pick "Bootstrap liquidity" + "Get connected with Market Makers". Perps venue needs MMs; that is the honest ask. |

Perks: site lists "Ecosystem Perks... and more" without names; the Sep 3 tweet attaches a perks image (saved as perks.jpg in this dir, not OCR'd). Confirmed from FAQ: housing/food/cowork at Zo House, $2k Breakout Grant, follow-on Superteam intros, grant guidance.

Superteam India public signal 2025-26 (X search via social-cli, 40+ posts read):
- "more DeFi out of india please!" (Apr 2025). They actively want DeFi teams.
- Highlighted DeFi teams: Archer Exchange (MEV-resistant exchange primitive, 4th DeFi track Dec 2025), Umbra (privacy DeFi), Encifher (privacy engine for DeFi, Alliance-backed), met_engine, Paystream, asgardfi, Twinn, Plutus.
- Podcasts with Arcium, MagicBlock, bloXroute/Paladin (MEV). Market-structure/privacy/MEV is a theme they like.
- Frontier autopsy (own doc): overclaiming privacy cost trust. Honest one-liner already fixed.

## Market data (DefiLlama, 2026-09-03)

Solana perps (defillama.com/perps/chain/solana): 24h $1.87B, 30d $37.1B, OI $358M, weekly -25%.

| Venue | 24h vol | 30d vol | Note |
|---|---|---|---|
| GMTrade | $1.21B | $19.4B | new, dominant by volume |
| Pacifica | $430M | $10.5B | self-funded, mainnet Jun 2025, $220B cumulative, CEX-grade API |
| Jupiter | $194M | $5.8B | $763M TVL, pool model |
| Phoenix | $34M | $1.2B | CLOB |
| Drift | ~$0 | | collapsed |

Solana category counts vs ETH/Base (api.llama.fi/protocols): Derivatives 24 protocols (ETH 52, Base 69). Perps is *not* under-served on Solana. Room exists only via a sharp wedge and MM relationships, not via "another CLOB".

Under-served on Solana by count (sol / eth / base): Options 4/28/12, CDP 9/70/15, Yield 31/210/56, Payments 2/11/7, Prediction 9/10/21, Privacy 5/13/5.

## Competitor truth (read docs, not READMEs)

- **Pacifica**: no order privacy claimed. Speed + UX + API. Kills DarkBook on execution, not on wedge.
- **GMTrade/Jupiter**: no privacy. Volume leaders.
- **Archer Exchange** (India, Superteam-loved): MEV-resistant primitive shielding MMs from adverse selection. Closest local competitor on *thesis*; different mechanism (batch/auction vs commit-reveal). Site returned empty body; status unclear.
- **Umbra / Encifher / Arcium**: general privacy compute, not a perps venue.
- **Hyperliquid, Lighter, Renegade, Penumbra**: not Solana.

DarkBook wedge that survives: **size-only commit-reveal on a Solana CLOB with ER matching, settlement atomic on L1.** Nobody on Solana ships this on mainnet. It is a head start, not a moat.

## Why not pivot

1. Deadline is today. Anything new is a deck, and the form bans decks.
2. Superteam India's own filter: "Proof of Work > Potential, Active Links > Concepts". DarkBook has 4k LOC Rust, devnet program, dashboard, docs, Frontier submission, honest postmortem. That *is* PoW.
3. Ascent's stated output (30-day GTM experiment, MM/liquidity intros, market-structure days) is precisely DarkBook's missing piece.
4. Other repos: shadowlend/privacykit last touched Feb 2026 (stale). neobank is Starknet (wrong chain).

## Application angle (copy for the form)

**Working on:** DarkBook, a size-private perps CLOB on Solana. Exact order size hidden via SHA-256 commitment until settlement; side, price, size band public. Matching on MagicBlock Ephemeral Rollup (<50ms), atomic settlement on Solana, Pyth Lazer marks, 8h funding, liquidations. Links: github.com/kamalbuilds/darkbook, darkbook-ascent.vercel.app, devnet program `3F99U2rZ2fob5NBgVTqQYqMq8whF4WUqiZXgeaYPE7yf`, docs/PRIVACY_MODEL.md.

**Traction (honest):** Devnet live, e2e tests (bankrun), integrations built: MagicBlock ER, Pyth Lazer, Jito bundles, Helius, Encrypt/Ika bridges. Submitted to Colosseum Frontier 2026 (main + 3 sidetracks, did not place; published autopsy). Zero mainnet users. Blocker is not code, it is MM liquidity and a first cohort of size-sensitive traders.

**Why Ascent:** Need market-structure critique (is size-band + commit-reveal enough MEV protection for MMs?), MM intros, and a 30-day GTM: 3 MMs quoting SOL-PERP on devnet with real order flow, then mainnet with capped OI.

**Goals:** Bootstrap liquidity; connect with MMs/VCs.

## Must do before submitting (today)

1. Record 3-min Loom: wallet connect, deposit, place hidden-size order, match on ER, claim_fill reveal on explorer, position + liquidation. No slides.
2. Confirm darkbook-solana.vercel.app renders and points at devnet program (curl 200 confirmed; click-through not yet).
3. Both team members apply individually (form rule).
4. Regulatory note for India-facing pitch: perps are offshore for Indian retail (30% tax, 1% TDS). Pitch users as global MMs/funds, not Indian retail. Do not claim Indian retail demand.

## Verified after writing

- **MagicBlock ER mainnet is GA**: docs list mainnet validators us/eu/as/tee (`us.magicblock.app`, `MUS3hc9...`). 30-day mainnet plan is credible. Say it.
- **darkbook-solana.vercel.app is STALE**: live HTML still says "Order size and identity are encrypted off-chain with ECIES... the only perps venue worth trading on Solana" (pre-autopsy overclaim). Repo copy is fixed (`0eceef9`, pushed to origin/master now). Ticker shows OFFLINE (ER WS not connected). Old project is not in the `kamalishere` Vercel team. **Fixed by deploying a fresh copy: https://darkbook-ascent.vercel.app** (honest copy verified live, overclaim string count 0). Use this URL in the form. Also fixed dashboard build (`@wallet-standard/base` type import) and `dashboard/vercel.json` commands so any account can redeploy with root dir `dashboard`.

## Blind spot

Did not read Archer's mechanism docs (site empty body). Did not click-test wallet flow on the dashboard (needs Phantom on devnet).

## Log

- Tools: social-cli X search (5 queries, ~45 posts), Brave harness (Airtable form), Scrapling get (defillama perps page, pacifica docs, umbra, archer), api.llama.fi/protocols (451 Solana protocols), devnet RPC getAccountInfo, 4 research agents on omniroute agy/gemini-2.5-flash (outputs 01-04 in this dir, thin; used as secondary).
- Failures: api.llama.fi/overview/derivatives now 402 (paid). DuckDuckGo anti-bot. Bing returned payroll spam for "Ascent". superteam.fun/grants 404. Scrapling stealthy_fetch missing Chromium (do not install; use bh-multi). First 4 agents on auto/fast + auto/coding:cheap returned empty streams (OmniRoute stream incompat), stopped and respawned.
