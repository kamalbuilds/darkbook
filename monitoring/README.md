# DarkBook Monitoring Stack

Prometheus + Grafana live ops dashboard for DarkBook perpetuals DEX.

## Quick start

```bash
cd monitoring
docker-compose up -d
```

Grafana: http://localhost:3001 (admin / admin)
Prometheus: http://localhost:9090

The DarkBook Live Ops dashboard loads automatically on first boot.

## What you see

| Panel | Metric |
|-------|--------|
| Service health | `up` per scrape job - green/red |
| Order rate by side | `darkbook_orders_placed_total` rate, split long/short |
| Fill rate | `darkbook_fills_claimed_total` per minute |
| Match rate | `darkbook_matches_per_second` (60s window) |
| Settlement latency p50/p95/p99 | `darkbook_er_finality_lag_ms` histogram |
| ER finality heatmap | same histogram, log-scale heatmap view |
| Open positions | `darkbook_open_positions` gauge |
| Liquidations/hour | `darkbook_positions_liquidated_total` rate |
| Pyth staleness | `darkbook_pyth_staleness_seconds` - red threshold at 5s |
| Funding rate | `darkbook_funding_rate` per market |

## Prerequisites

Services must be running and exposing `/metrics`:

| Service | Port |
|---------|------|
| settler | 8081 |
| er-broadcaster | 8082 |
| liquidation-watcher | 8083 |
| funding-cron | 8084 |

See `INTEGRATION-NOTES.md` for the exact lines to add to each service.

## Screenshots

_[Add screenshots here for the hackathon submission deck]_

Dashboard at startup with all services healthy:

![dashboard placeholder](../deck/monitoring-screenshot.png)

## Architecture

```
Services (local)          Docker network
  :8081 /metrics  ──────> Prometheus :9090 ──> Grafana :3001
  :8082 /metrics  ──────>
  :8083 /metrics  ──────>
  :8084 /metrics  ──────>
```

Prometheus scrapes every 10-15 seconds. Grafana auto-refreshes every 10 seconds.
Data retention: 7 days.

## Stopping

```bash
docker-compose down
# or to also wipe stored metrics:
docker-compose down -v
```
