# Umbra Shielded Withdrawals — DarkBook Integration

Real integration shipping in `sdk/src/umbra.ts`. Routes `close_position` + `liquidate_position` PnL refunds through Umbra's shielded pool so withdrawal amounts + recipients are unlinkable from the original trade.

## What ships
- `sdk/src/umbra.ts` (213 LOC) — `UmbraShieldedClient` class wrapping Umbra SDK
- Exported via `sdk/src/index.ts`
- Program ID from `UMBRA_PROGRAM_ID` env (no hardcoded keys)
- TypeScript clean

## Flow
1. DarkBook `closePosition` transfers PnL to Umbra intermediary ATA
2. Umbra `DepositFromATA` (public ATA → encrypted ETA)
3. Umbra `CreateUTXO` (ETA → Unified Mixer Pool, anonymous)
4. Trader `BurnToETA` (claims UTXO from mixer, lands in their encrypted account)
5. Trader `WithdrawFromETA` (encrypted balance → public, if desired)

## Pairs with existing primitives
- DarkBook commitment scheme hides order size pre-fill
- Umbra hides PnL amount + recipient post-fill
- Combined = full position-lifecycle privacy

## Usage
```ts
import { UmbraShieldedClient } from "@darkbook/sdk";

const umbra = new UmbraShieldedClient(connection, wallet);
const sig = await umbra.closePositionShielded({
  darkbookClient: db,
  positionPdaKey: posPda,
  recipient: traderWallet,
});
```

## Env
- `UMBRA_PROGRAM_ID` — Umbra Solana program ID
- `DARKBOOK_USE_UMBRA=1` — dashboard "Withdraw shielded" button

## Status
- Sidetrack ($10k — Umbra privacy infra) — backed by real code
- Tracks `umbraprivacy.com` mainnet program ID; devnet endpoint set via env

## Phase 2
- Add CPI directly in `programs/darkbook/src/ix/close_position_shielded.rs` (new ix variant) so settlement → Umbra is atomic onchain rather than bundle-level. Pending Umbra anchor 0.32 + edition2021 toolchain compat.
