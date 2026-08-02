# Why DarkBook Did Not Win Frontier (and what we fixed)

**Published:** 2026-08-03  
**Repo:** [github.com/kamalbuilds/darkbook](https://github.com/kamalbuilds/darkbook)  
**Canonical privacy model:** [PRIVACY_MODEL.md](../PRIVACY_MODEL.md)

## Context

DarkBook shipped for Colosseum Frontier 2026: Anchor perps CLOB, MagicBlock Ephemeral Rollup matching, SHA-256 size commitments, settler path, dashboard. We entered main plus MagicBlock Privacy, Eitherway DeFi Infra, and Encrypt x Ika sidetracks. We did not place.

Frontier closed with more than 2,800 final projects. That is not an excuse. It is a filter. Good code is the median.

## What judges optimized for

Looking at winners (CrowdBrain, Peaks, Stablecorp, DashX, Sudont, Flovia, and others), the scoring center of gravity was:

1. Clear founder-market fit and a 10-second user loop  
2. Consumer, mobile, India/EM payments, RWA, novel markets, physical ops  
3. One sharp wedge used deeply  
4. Traction or at least a believable path to users  

DarkBook was institutional perps infrastructure with a privacy story. Real engineering. Wrong shape for that cohort.

## The real technical miss: claim > code

Marketing said identity and leverage were hidden. The program did not.

On `Order` we store:

- trader pubkey  
- side, price_ticks  
- size_band  
- leverage_bps  
- commitment  

Only **exact size_lots** is commitment-bound until `claim_fill`. The ER validator sees book accounts. The settler sees plaintext sizes. That is a valid performance-privacy tradeoff. It is **not** a full dark pool and not "Hyperliquid cannot copy."

Sophisticated judges open `state.rs`. Overclaim is an automatic trust write-down, including on privacy sidetracks.

## What we shipped after the autopsy

1. **`docs/PRIVACY_MODEL.md`** as the single source of truth  
2. README and landing copy rewritten to match the program  
3. Comparison table: privacy / MEV / decentralization marked **partial**, not green checks  
4. GitHub links pointed at `kamalbuilds/darkbook`  
5. Program comments corrected so the next reader is not lied to  

Next code upgrades on the honest roadmap: trader pseudonym hashes on the book, threshold settler, optional ZK reveal when it is production-ready on Solana.

## PoW lesson for Superteam and future hackathons

Superteam India Foundation Grants say it plainly: **Proof of Work > Potential**, **Active Links > Concepts**, **Product Feedback > Market Thesis**.

Solid repos that never win usually fail on product packaging, honest claims, and continuous public shipping, not on whether Anchor compiles.

DarkBook remains strong PoW for Solana systems depth. For grants that fund founder-mode startups with users, lead with a product that has live loops and weekly public updates. Keep DarkBook as technical depth, not as a deck of absolute privacy claims.

## One-liner we will use going forward

> Exact order size hidden until settlement. Side, price, and size band public. MagicBlock matching under 50ms. Solana settlement.

That sentence is true. The old one was not.

Built in public. Feedback welcome on GitHub issues.
