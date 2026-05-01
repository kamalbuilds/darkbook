/**
 * DarkBook shared Prometheus metrics module.
 *
 * Each off-chain service imports this file and calls `startMetricsServer(port)`
 * to expose /metrics on the given port. The registry is a singleton so all
 * metrics are collected in one place.
 *
 * Usage:
 *   import { registry, fillsClaimed, startMetricsServer } from '../metrics.ts'
 *   startMetricsServer(Number(process.env.SETTLER_PORT ?? 8081))
 *   fillsClaimed.inc()
 */

import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from 'prom-client'
import { createServer } from 'node:http'

// ─── Singleton registry ───────────────────────────────────────────────────────
export const registry = new Registry()

// Collect Node.js default metrics (event loop lag, GC, heap, etc.)
collectDefaultMetrics({ register: registry })

// ─── Business metrics ─────────────────────────────────────────────────────────

/** Total fills claimed by the settler service. */
export const fillsClaimed = new Counter({
  name: 'darkbook_fills_claimed_total',
  help: 'Fills claimed by settler',
  registers: [registry],
})

/** Total positions liquidated by the liquidation-watcher service. */
export const positionsLiquidated = new Counter({
  name: 'darkbook_positions_liquidated_total',
  help: 'Positions liquidated',
  registers: [registry],
})

/**
 * Histogram of ER→mainnet finality lag in milliseconds.
 * Measured from the moment a tx is submitted to the ER until
 * confirmation arrives on the base chain (Solana devnet / mainnet).
 */
export const erFinalityLag = new Histogram({
  name: 'darkbook_er_finality_lag_ms',
  help: 'ER → mainnet finality lag in milliseconds',
  buckets: [50, 100, 250, 500, 1000, 2500, 5000],
  registers: [registry],
})

/**
 * Current age of the latest Pyth Lazer price feed in seconds.
 * Set this every time a new Pyth message is received:
 *   pythStaleness.set(Date.now() / 1000 - pythMsg.publishTime)
 */
export const pythStaleness = new Gauge({
  name: 'darkbook_pyth_staleness_seconds',
  help: 'Latest Pyth feed age in seconds',
  registers: [registry],
})

/**
 * Total OrderPlaced events observed, broken down by side and size_band.
 * side: 'long' | 'short'
 * size_band: 'xs'(<100) | 'sm'(100-1k) | 'md'(1k-10k) | 'lg'(>10k) (in USD notional)
 */
export const ordersPlaced = new Counter({
  name: 'darkbook_orders_placed_total',
  help: 'OrderPlaced events seen',
  labelNames: ['side', 'size_band'] as const,
  registers: [registry],
})

/**
 * Windowed match rate (matches per second, updated over a 60-second rolling window).
 * The funding-cron or settler service should recompute and call .set() each heartbeat.
 */
export const matchesPerSec = new Gauge({
  name: 'darkbook_matches_per_second',
  help: 'Match rate windowed 60s',
  registers: [registry],
})

/** Current number of open positions tracked by the liquidation-watcher. */
export const openPositions = new Gauge({
  name: 'darkbook_open_positions',
  help: 'Number of open positions currently tracked',
  registers: [registry],
})

/**
 * Current funding rate per market.
 * labelNames: ['market'] — e.g. 'SOL-PERP', 'BTC-PERP'
 * Value is a decimal fraction (e.g. 0.0001 = 0.01% per 8h epoch).
 */
export const fundingRate = new Gauge({
  name: 'darkbook_funding_rate',
  help: 'Current funding rate per market (decimal fraction)',
  labelNames: ['market'] as const,
  registers: [registry],
})

// ─── HTTP server ──────────────────────────────────────────────────────────────

/**
 * Start a minimal HTTP server that serves Prometheus metrics on /metrics.
 * Call this once at service startup.
 *
 * @param port - The port to listen on (from env var *_PORT).
 */
export function startMetricsServer(port: number): void {
  const server = createServer(async (req, res) => {
    if (req.url === '/metrics') {
      try {
        const metrics = await registry.metrics()
        res.writeHead(200, { 'Content-Type': registry.contentType })
        res.end(metrics)
      } catch (err) {
        res.writeHead(500)
        res.end(String(err))
      }
    } else if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('ok')
    } else {
      res.writeHead(404)
      res.end()
    }
  })

  server.listen(port, () => {
    console.log(`[metrics] Prometheus endpoint: http://0.0.0.0:${port}/metrics`)
  })
}
