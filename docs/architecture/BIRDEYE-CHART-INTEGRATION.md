# Birdeye Chart Integration

## Overview

Real historical OHLCV candle data from Birdeye public API, replacing hardcoded/Pyth-only chart in mark-chart.tsx.

## Implementation

### File: `dashboard/src/lib/birdeye.ts`

**fetchHistoricalPrice(pairAddress, interval, limit)**
- Calls https://public-api.birdeye.so/defi/ohlcv/pair
- Parameters: address, type (interval), limit
- Returns: Array of Candles {time, open, high, low, close, volume}
- Empty array on error (no throw)

Helper functions:
- **getLatestPrice(candles)**: Latest close price
- **calculateSMA(candles, period)**: Simple moving average

### Integration in Chart

In `dashboard/src/components/mark-chart.tsx`:
1. Load Birdeye candles on mount
2. Set historical data on candleSeries
3. Continue Pyth Lazer stream for real-time updates
4. Fallback: if Birdeye fails, chart still shows live price from Pyth

### Environment Variables

- `NEXT_PUBLIC_BIRDEYE_API_KEY`: Optional (public tier works)

### Pair Address

SOL/USDC pair address: `JUP6LkbZbjS1jKKB1QrYsV7zJjg1KwpzuJanomPeRec`

Can be made configurable in future (env var or dynamic lookup).

### Error Handling

- Network errors logged, return empty array
- 404 (pair not found) returns empty array
- Empty response returns empty array
- Chart falls back to Pyth stream only

### Test Endpoints

- **API**: https://public-api.birdeye.so/defi/ohlcv/pair
- **No auth required** for public tier
- Rate limit: ~100 req/min without key
