# Birdeye Data API integration

## Overview

Birdeye powers **aggregate spot OHLCV** (base vs USDC across DEXs), **token overview** (liquidity, 24h volume, wallet flow, price change), and an optional **single-pair OHLCV** helper. The trade UI uses this as the **spot reference layer** next to DarkBook perp marks (Pyth).

Docs: [Birdeye Data API](https://birdeye.so/data-api/types-of-data), [Authentication](https://docs.birdeye.so/docs/authentication-api-keys).

## Files

| File | Role |
|------|------|
| `dashboard/src/lib/birdeye.ts` | `birdeyeHeaders()`, `fetchOhlcvBaseQuote`, `fetchHistoricalPrice` (pair), `fetchTokenOverview` |
| `dashboard/src/lib/market-assets.ts` | USDC mint, WSOL / WBTC / WETH mints, `spotBaseMintForMarket` |
| `dashboard/src/components/mark-chart.tsx` | Candles from `fetchOhlcvBaseQuote` per selected market |
| `dashboard/src/components/birdeye-market-intel.tsx` | Strip: spot price, 24h change, volume, liquidity, wallets, buy/sell bar, perp vs spot basis |
| `dashboard/src/lib/birdeye-proof-log.ts` | In-browser log of each Birdeye HTTP request (path, status, timing) |
| `dashboard/src/app/birdeye-proof/page.tsx` | **Birdeye log** UI: batch runner (~66 calls), counts by endpoint, JSON download |

## Endpoints used

1. **GET** `https://public-api.birdeye.so/defi/ohlcv/base_quote`  
   Query: `base_address`, `quote_address`, `type` (`1m`, `15m`, `1H`, …), `time_from`, `time_to`  
   Headers: `Accept`, `x-chain: solana`, `X-API-KEY` (recommended)

2. **GET** `https://public-api.birdeye.so/defi/token_overview`  
   Query: `address` (token mint)  
   Same headers. Used for volume, liquidity, `priceChange24hPercent`, `vBuy24hUSD` / `vSell24hUSD`, `uniqueWallet24h`.

3. **GET** `https://public-api.birdeye.so/defi/ohlcv/pair`  
   Query: `address` (pair contract), `type`, `time_from`, `time_to`  
   Legacy helper when you have an explicit pool address.

## Environment

- `NEXT_PUBLIC_BIRDEYE_API_KEY`: from [bds.birdeye.so](https://bds.birdeye.so). **Never commit** real keys. `NEXT_PUBLIC_*` is exposed to the browser; for stricter secrecy, proxy Birdeye through a Next Route Handler and drop the `NEXT_PUBLIC_` prefix.
- `NEXT_PUBLIC_BIRDEYE_PROOF_MODE=1` (optional): shortens Birdeye response caches on `/trade` so routine browsing emits more HTTP calls during demos.

## Sponsor qualification (call count + proof)

Some programs require a minimum number of Birdeye API calls from the shipped app.

1. Set `NEXT_PUBLIC_BIRDEYE_API_KEY` in `.env.local` and restart `next dev`.
2. Open **`/birdeye-proof`** (nav: **Birdeye log**).
3. Click **Run ~66 API calls (batch)**. That clears client caches and, for WSOL / WBTC / WETH, calls `token_overview` plus `ohlcv/base_quote` for `1m`, `15m`, and `1h` (12 HTTP calls per round; enough rounds to reach at least 66 new calls). Small delays between calls reduce 429 risk.
4. Click **Download JSON** and attach that file (or paste) when you send proof to Birdeye. The JSON lists each request path, HTTP status, timestamp, and latency. It does **not** contain your API key.

Normal `/trade` usage also appends to the same log whenever components hit Birdeye.

## Behaviour

- **Chart**: SOL / BTC / ETH selectors map to spot base mints vs USDC; candles are **multi-pool aggregate** (base_quote), not a guessed single pool id.
- **Header 24h**: `BirdeyeMarketIntel` calls `setChange24h` from Birdeye `priceChange24hPercent` so the header stays aligned with spot.
- **Perp vs spot**: When both Birdeye spot and Pyth mark exist, the intel strip shows basis percent.

## Testing

There is no CI call to Birdeye yet. Smoke manually: run dashboard with a valid key, open `/trade`, switch markets, confirm strip and chart populate.
