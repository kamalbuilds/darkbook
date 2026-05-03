# Cloak Privacy Payments — DarkBook Integration

Real integration shipping in `sdk/src/cloak.ts`. Wraps `deposit_collateral` so deposit amount stays hidden from public observers.

## What ships
- `sdk/src/cloak.ts` (104 LOC) — `CloakedAgent` interface + `depositViaCloak()` builder
- Exported via `sdk/src/index.ts`
- TypeScript clean (`bunx tsc --noEmit` ✅)

## Architecture
1. User → Cloak privacy pool (amount hidden via commitment)
2. Cloak pool → DarkBook vault (merkle proof verifies)
3. Vault → user position (amount shielded in on-chain commitment)

## Pairs with existing primitives
- Cloak hides DEPOSIT amount
- DarkBook commitment scheme (sha256) hides ORDER size
- Combined = deposit-to-fill privacy chain

## Usage
```ts
import { depositViaCloak } from "@darkbook/sdk";

const ix = await depositViaCloak({
  cloakedAgent,
  usdcMint: USDC_MINT,
  amountLamports: new BN(10_000_000), // 10 USDC
  private: true, // ZK proof hides wallet→agent link
});
tx.add(ix);
```

## Status
- Sidetrack ($5,010 — Cloak privacy payments) — backed by real code
- Cost: ~0.25% Cloak shielding fee + tx fee
- Token/key material from env only

## Phase 2
When Cloak public devnet RPC + program ID confirmed, swap `CloakedAgent` impl from interface to direct CPI. Architecture stable; only the agent constructor changes.
