# Pyth Lazer Sub-Millisecond Integration

## Overview

DarkBook now uses **Pyth Lazer** for sub-millisecond oracle price feeds instead of (or alongside) Pyth pull oracle via Hermes REST.

Pyth Lazer delivers signed price updates via WebSocket at 200ms intervals with microsecond-level latency, enabling ultra-fast liquidation detection and mark price updates.

- Docs: https://docs.pyth.network/lazer/getting-started
- Access form: https://tally.so/r/nP2lG5

## Architecture

### Off-Chain (Services)

**er-broadcaster service** (`services/er-broadcaster/src/index.ts`):
- Connects to Pyth Lazer WebSocket endpoint via `PythLazerStream` class
- Subscribes to SOL/USD and BTC/USD feed IDs
- Receives JSON price updates with exponent and timestamp
- Scales prices to 6 decimals (micro-USDC)
- Broadcasts to dashboard clients via WebSocket as `{ type: "mark", price, ts, source: "lazer" }`

**Fallback**: If PYTH_LAZER_TOKEN is missing or Lazer connection fails, falls back to Hermes REST polling (2s interval).

### On-Chain (Programs)

**programs/darkbook/src/pyth.rs**:
- `read_pyth_price()` — reads PriceUpdateV2 account (works for both pull oracle and Lazer)
- `read_pyth_lazer_price()` — alias for clarity (same implementation)
- Pyth Lazer relayer writes to the same PriceUpdateV2 format as pull oracle
- No additional on-chain code needed; both sources write the same account structure

The Pyth Lazer relayer broadcasts signed prices to Solana via an off-chain oracle network, which writes to the on-chain PriceUpdateV2 account. DarkBook reads from that account without knowing the data source.

## Setup

### 1. Get a Pyth Lazer Token

1. Visit https://tally.so/r/nP2lG5 (Pyth Lazer access form)
2. Submit request with your use case
3. Receive a bearer token (valid for up to 90 days with 2FA enabled)

### 2. Set Environment Variables

```bash
# In .env or deploy config:
PYTH_LAZER_TOKEN=<token_from_form>
SOL_USD_FEED_HEX=0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d
```

Example `.env`:
```
PYTH_LAZER_TOKEN=<your-token>
SOL_USD_FEED_HEX=0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d
ER_BROADCASTER_PORT=8082
MARKET_PUBKEY=<market-pubkey>
```

### 3. Start the Service

```bash
cd services/er-broadcaster
bun install
bun run start
```

Monitor logs for:
```
[INFO] Starting Pyth Lazer sub-ms WebSocket stream
[INFO] Pyth Lazer stream connected successfully
```

Or if token is missing:
```
[WARN] PYTH_LAZER_TOKEN not configured — using Hermes REST polling
```

## Endpoints

Pyth Lazer provides redundant WebSocket endpoints (auto-selected):
- `wss://pyth-lazer-0.dourolabs.app/v1/stream`
- `wss://pyth-lazer-1.dourolabs.app/v1/stream`
- `wss://pyth-lazer-2.dourolabs.app/v1/stream`

Authentication: `Authorization: Bearer <token>`

## Feed IDs (Devnet)

- SOL/USD: `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d`
- BTC/USD: `0xf9c0172ba10dfa4d19088d94f5bf61d3b54d5bd7483a322a982e1373ee8ea31b`

Full list: https://docs.pyth.network/price-feeds/price-feed-ids

## Price Update Format

### On-Chain (PriceUpdateV2)

Relay writes:
```
[discriminator(8)] [authority(32)] [level(1)] [feed_id(32)] [price(8)] [conf(8)] [exponent(4)] [publish_time(8)] ...
```

Read via `read_pyth_price()` in Rust.

### Off-Chain (WebSocket)

Broadcaster receives JSON:
```json
{
  "timestampUs": 1715000000000000,
  "priceFeeds": [
    {
      "priceFeedId": "0xef0d8b...",
      "price": {
        "price": "200000000",
        "expo": -8
      }
    }
  ]
}
```

Scaled to 6 decimals: `price * 10^(6 + expo)` = micro-USDC.

## Fallback Behavior

If Lazer is unavailable:
1. Connection error → exponential backoff retry (up to 10 attempts)
2. After 5s of failures → fall back to Hermes REST polling (2s interval)
3. Log level: WARN

This ensures the service never goes down — it degrades gracefully to 2s polling.

## Testing

```bash
# Test Lazer connection (requires token)
cd services/er-broadcaster
bun run start

# Check dashboard broadcasts
wscat -c ws://localhost:8082
# Should see { "type": "mark", "price": "...", "ts": ..., "source": "lazer" }

# Test with fake token (should error gracefully and fall back to Hermes)
PYTH_LAZER_TOKEN=invalid bun run start
```

## Debugging

Enable debug logging:
```bash
LOG_LEVEL=debug bun run start
```

Watch for:
- `[DEBUG] Lazer price update` — price received and broadcast
- `[WARN] Reconnecting in Xms` — connection dropped, retrying
- `[ERROR] Max reconnect attempts reached` — Lazer unavailable, check token

## Migration from Hermes Pull

No on-chain migration needed. Both Hermes pull and Lazer write PriceUpdateV2 accounts.

To switch from pull to Lazer:
1. Obtain token from access form
2. Set `PYTH_LAZER_TOKEN` env var
3. Restart er-broadcaster — it auto-detects and switches

To use both (price feed diversity):
- Subscribe to multiple feeds in PythLazerStream
- Aggregate prices in business logic

## Performance

- Lazer latency: < 1ms
- Update frequency: ~200ms (fixed_rate channel)
- Broadcaster overhead: < 5ms
- Dashboard broadcast latency: < 50ms

Total mark price update latency: ~50-100ms (sub-second).

## Security

- Token is **never logged or exposed** (env var only)
- Bearer token sent only to official Pyth endpoints
- Token expires after 90 days; renew via form
- Fallback to Hermes (public) if Lazer unavailable

## Related Files

- `sdk/src/pyth.ts` — PythLazerStream WebSocket client
- `services/er-broadcaster/src/index.ts` — broadcaster service
- `programs/darkbook/src/pyth.rs` — on-chain price reader
- `.env.example` — configuration template
