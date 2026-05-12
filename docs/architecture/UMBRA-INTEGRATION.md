# Umbra privacy completion — DarkBook

DarkBook settles positions on-chain; the trader ends up with USDC in a **public** SPL ATA. Umbra completes the privacy story: **direct deposit** moves that USDC from the public ATA into an **encrypted** Umbra balance using the official `@umbra-privacy/sdk`, so the post-settlement graph is harder to link to the original trade flow.

Dark Commit hides size and intent **before** fill. Umbra hides **after** fill once funds sit in the wallet ATA (two-layer privacy). A single atomic DarkBook close that CPIs into Umbra would need a **new program instruction**; today the honest integration is **close (or withdraw) then shield** in the client or script.

## What ships

- `sdk/src/umbra.ts` — `connectDarkbookUmbraClient`, `ensureUmbraRegistered`, `shieldPublicAtaToEncryptedBalance`, cluster/indexer defaults, `UmbraShieldedClient` with optional `shieldPayoutWithUmbra` on close/liquidate
- Re-exports: `createSignerFromPrivateKeyBytes`, `createSignerFromWalletAccount`, `createInMemorySigner` (from `@umbra-privacy/sdk`)
- Exported from `@darkbook/sdk` via `sdk/src/index.ts`

## Flow (recommended)

1. DarkBook `closePosition` / `liquidatePosition` (PnL hits the user ATA as today).
2. Optional: `ensureUmbraRegistered(umbraClient)` once per wallet (idempotent; costs SOL if not already registered).
3. `shieldPublicAtaToEncryptedBalance({ client, mintBase58, amountBaseUnits })` — Umbra public→encrypted pipeline (Arcium queue + callback signatures in the result).

## Usage

```ts
import {
  connectDarkbookUmbraClient,
  createSignerFromPrivateKeyBytes,
  shieldPublicAtaToEncryptedBalance,
  ensureUmbraRegistered,
  solanaWsUrlFromHttp,
} from "@darkbook/sdk";

const signer = await createSignerFromPrivateKeyBytes(secretKeyBytes);
const client = await connectDarkbookUmbraClient({
  signer,
  rpcUrl: process.env.SOLANA_RPC_URL!,
  rpcSubscriptionsUrl: solanaWsUrlFromHttp(process.env.SOLANA_RPC_URL!),
});
await ensureUmbraRegistered(client);
const deposit = await shieldPublicAtaToEncryptedBalance({
  client,
  mintBase58: "YOUR_USDC_MINT",
  amountBaseUnits: 1_000_000n,
});
```

## Environment

| Variable | Purpose |
|----------|---------|
| `UMBRA_PROGRAM_ID` | Override Umbra program id (optional) |
| `UMBRA_CLUSTER` / `NEXT_PUBLIC_SOLANA_CLUSTER` | `mainnet` / `mainnet-beta` vs devnet for Umbra network + defaults |
| `UMBRA_INDEXER_DEVNET_URL` / `UMBRA_INDEXER_MAINNET_URL` | Override indexer base URL |
| `UMBRA_RELAYER_DEVNET_URL` / `UMBRA_RELAYER_MAINNET_URL` | Documented for mixer/claim paths (direct deposit uses client defaults) |

## Script

`build/darkbook/scripts/umbra-privacy-completion.ts` — Bun example: register + shield devnet USDC from `KEYPAIR_PATH` (see file header for env vars).

## Sidetrack pitch (Umbra)

- **Innovation:** Privacy completion path after DarkBook settlement, wired to real Umbra client APIs (not a stub).
- **Honest boundary:** No fake CPI from DarkBook program yet; dashboard should describe “shield after close” until an on-chain ix exists.

## Next engineering step

- New ix in `programs/darkbook` that optionally CPIs Umbra after transfer (atomic path), once specs and toolchain align.
