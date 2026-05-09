# Metrics Integration Notes

The shared metrics module lives at `services/metrics.ts`. Each service needs
two changes: import the helpers, and call `startMetricsServer` at startup.

---

## Shared module: `services/metrics.ts`

All metric objects are exported as named singletons. Node.js default metrics
(heap, GC, event-loop lag) are collected automatically. There is no need to
create a Hono route — `startMetricsServer` starts an independent HTTP server
on the configured port.

---

## Per-service integration

### `services/settler/src/index.ts`

```ts
// Add near the top-level imports:
import {
  fillsClaimed,
  erFinalityLag,
  ordersPlaced,
  matchesPerSec,
  startMetricsServer,
} from '../../metrics.ts'

// Call once, after env vars are loaded:
startMetricsServer(Number(process.env.SETTLER_PORT ?? 8081))

// Where a fill is claimed:
fillsClaimed.inc()

// When an ER → mainnet round-trip completes (startMs = Date.now() before submit):
erFinalityLag.observe(Date.now() - startMs)

// When an OrderPlaced event arrives:
ordersPlaced.labels({
  side: order.side,                            // 'long' | 'short'
  size_band: notionalToBand(order.notionalUsd) // 'xs'|'sm'|'md'|'lg'
}).inc()

// Update match rate in the heartbeat loop (every 1s):
matchesPerSec.set(windowedMatchCount / 60)
```

---

### `services/er-broadcaster/src/index.ts`

```ts
import {
  erFinalityLag,
  startMetricsServer,
} from '../../metrics.ts'

startMetricsServer(Number(process.env.ER_BROADCASTER_PORT ?? 8082))

// After each ER commitment confirmed on mainnet:
erFinalityLag.observe(Date.now() - txSubmittedAt)
```

---

### `services/liquidation-watcher/src/index.ts`

```ts
import {
  positionsLiquidated,
  openPositions,
  pythStaleness,
  startMetricsServer,
} from '../../metrics.ts'

startMetricsServer(Number(process.env.LIQUIDATION_WATCHER_PORT ?? 8083))

// When a liquidation tx is confirmed:
positionsLiquidated.inc()

// Each polling cycle, update open position count:
openPositions.set(positionAccountList.length)

// Each time a Pyth Lazer message arrives:
pythStaleness.set(Date.now() / 1000 - pythMsg.publishTime)
```

---

### `services/funding-cron/src/index.ts`

```ts
import {
  fundingRate,
  pythStaleness,
  startMetricsServer,
} from '../../metrics.ts'

startMetricsServer(Number(process.env.FUNDING_CRON_PORT ?? 8084))

// After applying funding, record the rate for each market:
fundingRate.labels({ market: 'SOL-PERP' }).set(currentFundingRateDecimal)

// Track Pyth freshness in the cron loop too:
pythStaleness.set(Date.now() / 1000 - latestPythPrice.publishTime)
```

---

## Helper: notional to size band

```ts
function notionalToBand(usd: number): string {
  if (usd < 100)    return 'xs'
  if (usd < 1_000)  return 'sm'
  if (usd < 10_000) return 'md'
  return 'lg'
}
```

---

## Ports (from `.env.example`)

| Service             | Port |
|---------------------|------|
| settler             | 8081 |
| er-broadcaster      | 8082 |
| liquidation-watcher | 8083 |
| funding-cron        | 8084 |

All services expose `/metrics` (Prometheus text format) and `/healthz` on
their respective ports.

---

## Prometheus scrape config

`monitoring/prometheus.yml` already points at `host.docker.internal:<port>`
for each service. When running services locally and Prometheus inside Docker,
`host.docker.internal` resolves to the macOS host automatically. On Linux,
add `--add-host=host.docker.internal:host-gateway` to the Prometheus service
in `docker-compose.yml`.
