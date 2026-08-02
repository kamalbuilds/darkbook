# Dark Commit: size privacy without ZK latency

**Published:** 2026-08-03  
**Program:** `programs/darkbook`  
**Spec:** [PRIVACY_MODEL.md](../PRIVACY_MODEL.md)

## Problem

On a public CLOB, exact size in the mempool leaks direction and impact. Informed flow pays a tax to snipers. Full ZK or MPC dark pools fix that at high prover cost and weak Solana UX today.

## Primitive

At place:

```text
commitment = SHA-256(salt || size_lots_le || leverage_bps_le || trader_pubkey)
```

Public fields on the order account: side, price, size_band, leverage, trader, commitment.  
Hidden: exact size_lots and salt.

At settlement, `claim_fill` reveals plaintext, recomputes the hash, opens the Position. Binding is collision resistance of SHA-256. Hiding is "salt secrecy until reveal."

## Why leverage is public

Collateral locked at place uses size band ceiling and leverage. Leverage is also inside the commitment so a trader cannot open with 5x and reveal 50x. Dual-encoding is intentional.

## Trust residual

- MagicBlock ER runs matching; operators see book accounts  
- Settler must learn sizes to claim  
- After fill, size becomes public on the Position  

If you need absolute privacy against operators, you need threshold reveal or ZK. DarkBook currently optimizes for **latency + exact-size mempool privacy**, not maximal privacy.

## Matching path

1. Deposit USDC collateral on mainnet  
2. `place_order` with commitment + size_band  
3. OrderBook PDA delegated to MagicBlock ER  
4. `match_orders` price-time priority  
5. Settler submits `claim_fill` with both opens  
6. Pyth marks, funding, liquidation as usual  

## Use it

```bash
git clone https://github.com/kamalbuilds/darkbook
cd darkbook
bun install
anchor test
```

Demo UI: https://darkbook-solana.vercel.app  
Privacy source of truth: `docs/PRIVACY_MODEL.md`

## Why publish this now

Hackathon culture rewards absolute slogans. Institutional and grant reviewers reward precise threat models. Dark Commit is useful when you state the threat model correctly. That is the bar we hold ourselves to after Frontier.
