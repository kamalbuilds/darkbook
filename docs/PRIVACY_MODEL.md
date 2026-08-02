# DarkBook Privacy Model (source of truth)

Last updated: 2026-08-03

This document is the **canonical** privacy claim for DarkBook. Landing copy, README, and social posts must not exceed what this file states.

## Threat model

| Adversary | Sees | Cannot profitably use for exact-size sandwich |
|-----------|------|-----------------------------------------------|
| Public mempool observer | place_order ix fields + events | exact `size_lots` (commitment only) |
| Competing trader reading book account | Order struct fields | exact `size_lots` until claim |
| MagicBlock ER validator | full delegated OrderBook PDA | still no plaintext size if not given salt |
| Settler service | plaintext size for claim_fill | N/A (trusted for size confidentiality) |
| Post-settlement observer | Position with exact size | N/A (PnL path is public by design) |

## On-chain Order fields

From `programs/darkbook/src/state.rs` and `ix/orders.rs`:

| Field | Public | Rationale |
|-------|--------|-----------|
| `order_id` | yes | matching / cancel |
| `trader` | yes | collateral lock + settlement binding |
| `side` | yes | CLOB |
| `price_ticks` | yes | CLOB |
| `size_band` | yes | collateral ceiling estimate without exact size |
| `leverage_bps` | yes | collateral math + risk |
| `commitment` | yes | binds exact size without revealing it |
| `placed_slot` | yes | time priority |

**Hidden until settlement:** exact `size_lots` and `salt`.

Commitment:

```text
commitment = SHA-256(salt || size_lots_le || leverage_bps_le || trader_pubkey)
```

`leverage_bps` appears both in the clear on the order **and** inside the commitment so a trader cannot swap leverage at reveal time.

## What DarkBook is not

- Not a full dark pool (price and side are public).
- Not ZK identity privacy (trader pubkey is on the Order).
- Not trustless size privacy against the settler or a compromised ER operator.
- Not a claim that Hyperliquid "cannot copy" the design.

## Roadmap (honest upgrades)

1. **Trader pseudonym:** store `trader_hash = H(trader || session_salt)` on the book; map only at claim (reduces public whale labeling).
2. **Threshold settler:** multi-party reveal so one settler cannot alone learn sizes.
3. **Optional ZK reveal:** prove commitment opens correctly without posting size to a single settler.
4. **Finer size bands or continuous intervals** with range proofs when Solana zk paths are production-ready.

## Social / grant copy rule

Allowed one-liners:

- "Exact order size hidden until settlement on Solana."
- "Size-private CLOB matching under 50ms via MagicBlock ER."

Disallowed:

- "Identity hidden"
- "The dark pool Hyperliquid can't copy"
- "No MEV exposure" (absolute)
- "Full privacy" / "invisible orders"
