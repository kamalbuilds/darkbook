# DarkBook Faucet Service

HTTP faucet that gives devnet demo users 1 SOL + 1000 DBUSDC in one click.

## Endpoints

| Method | Path      | Description |
|--------|-----------|-------------|
| POST   | /faucet   | Body: `{ "wallet": "<base58>" }`. Airdrop 1 SOL + transfer 1000 DBUSDC. |
| GET    | /health   | Returns faucet SOL and USDC balances. |

Rate limit: 1 request per wallet per 5 minutes (in-memory, resets on restart).

## Setup

1. Run the one-time mint setup (from repo root):
   ```bash
   bun run scripts/setup-test-usdc.ts
   ```
   This generates `.faucet-authority.json` and prints the mint address.

2. Copy the printed values into `.env`:
   ```
   USDC_DEVNET_MINT=<printed mint address>
   FAUCET_AUTHORITY_KEYPAIR=./.faucet-authority.json
   FAUCET_PORT=8083
   ```

3. Start the service:
   ```bash
   cd services/faucet
   bun install
   bun run src/index.ts
   ```

4. Test it:
   ```bash
   curl -X POST http://localhost:8083/faucet \
     -H 'Content-Type: application/json' \
     -d '{"wallet":"<your-devnet-wallet>"}'

   curl http://localhost:8083/health
   ```

## Deploy on Railway

1. Create a new Railway project and connect your GitHub repo.
2. Set the root directory to `services/faucet`.
3. Set these environment variables in Railway dashboard:
   - `RPC_URL` - Devnet RPC (e.g. `https://api.devnet.solana.com` or a private RPC)
   - `USDC_DEVNET_MINT` - Mint address from setup script
   - `FAUCET_AUTHORITY_KEYPAIR` - **Do not use a file path in Railway.** Instead set `FAUCET_AUTHORITY_JSON` to the raw JSON array from `.faucet-authority.json` and update `src/index.ts` to read from env.
   - `FAUCET_PORT` - `8083`
   - `LOG_LEVEL` - `info`
4. Railway auto-detects the Dockerfile and deploys.
5. Copy the Railway public URL into `NEXT_PUBLIC_FAUCET_URL` in the dashboard env.

## Deploy on Fly.io

```bash
cd services/faucet
fly launch --name darkbook-faucet --dockerfile Dockerfile
fly secrets set RPC_URL="https://api.devnet.solana.com"
fly secrets set USDC_DEVNET_MINT="<mint address>"
fly secrets set FAUCET_AUTHORITY_JSON='<paste contents of .faucet-authority.json>'
fly deploy
```

For Fly.io, update `loadFaucetKeypair()` in `src/index.ts` to read `FAUCET_AUTHORITY_JSON` env var as a fallback when the file does not exist:

```ts
// After file-not-found check, try env var:
const raw = JSON.parse(
  process.env.FAUCET_AUTHORITY_JSON ?? fs.readFileSync(resolved, "utf-8")
) as number[];
```

## Refilling the faucet

If the faucet USDC vault runs low, mint more from the faucet authority:
```bash
spl-token mint <USDC_DEVNET_MINT> 50000000 <faucet-token-account> \
  --owner .faucet-authority.json
```

If the faucet SOL pool runs low (only needed if devnet airdrop is permanently broken):
```bash
solana transfer <faucet-pubkey> 5 --url devnet
```
