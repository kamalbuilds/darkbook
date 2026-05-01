# DarkBook Dune Analytics Queries

Production-ready SQL queries for monitoring DarkBook perpetual futures trading on Solana. These queries decode Anchor event logs from the DarkBook program (`9i4Gpnt8GgrwxqwXdEyjFBsfNChis8z9jmyAbMpFVLcS`) and expose key metrics.

## Queries

### 1. Daily DarkBook Volume (`01-daily-volume.sql`)
**Metric:** Sum of notional volume per trading day (price_ticks × size_lots).
**Use:** Track aggregate daily trading activity, identify peak trading periods, detect market cycles.
**Key Fields:** fill_count, notional_volume_ticks, unique_takers, unique_makers.

Deploy:
1. Go to [dune.com/query/new](https://dune.com/query/new)
2. Copy entire query from `01-daily-volume.sql`
3. Click **Save → New Query**
4. Name: "DarkBook Daily Volume"
5. **Save as Dashboard** (set visibility to Public)

### 2. Position Liquidation Funnel (`02-liquidation-funnel.sql`)
**Metric:** PositionOpened → PositionLiquidated conversion rate by leverage band (1x-2x, 2x-5x, 5x-10x, 10x+).
**Use:** Understand liquidation risk by leverage level, identify over-leveraged cohorts.
**Key Fields:** leverage_band, positions_opened, liquidation_rate_pct, avg_liquidation_pnl.

Deploy:
1. Go to [dune.com/query/new](https://dune.com/query/new)
2. Copy entire query from `02-liquidation-funnel.sql`
3. Click **Save → New Query**
4. Name: "DarkBook Liquidation Funnel"
5. **Save as Dashboard**

### 3. Funding Rate History (`03-funding-history.sql`)
**Metric:** Daily aggregated funding rates from FundingPaid events (in basis points).
**Use:** Track funding rate trends over 180 days, identify funding spikes, understand capital costs.
**Key Fields:** avg_funding_rate_bps, peak_funding_rate_bps, total_positions_funded.

Deploy:
1. Go to [dune.com/query/new](https://dune.com/query/new)
2. Copy entire query from `03-funding-history.sql`
3. Click **Save → New Query**
4. Name: "DarkBook Funding Rate History"
5. **Save as Dashboard**

### 4. Top Traders by Realized PnL (`04-top-traders.sql`)
**Metric:** Ranked list of top 100 traders by total realized P&L from closed positions.
**Use:** Identify winning/losing traders, understand profitability distribution, benchmark trader skill.
**Key Fields:** rank, positions_closed, total_realized_pnl, win_rate_pct.

Deploy:
1. Go to [dune.com/query/new](https://dune.com/query/new)
2. Copy entire query from `04-top-traders.sql`
3. Click **Save → New Query**
4. Name: "DarkBook Top Traders by Realized PnL"
5. **Save as Dashboard**

## Embedding in Dashboards

After saving each query as a dashboard:
1. Go to [dune.com/dashboards](https://dune.com/dashboards)
2. Click **New Dashboard**
3. Name: "DarkBook Analytics"
4. Add the 4 saved queries as cards
5. **Publish** to make public
6. Share dashboard URL: `https://dune.com/your-username/darkbook-analytics`

## Event Discriminators

All queries filter events by program ID and event type. Dune's Solana schema auto-decodes Anchor events:

- **FillRecorded:** Event type `FillRecorded` (discriminator 0x59bc8a8bcf3e2cdb)
- **PositionOpened:** Event type `PositionOpened` (discriminator 0x09a1cebdf7a95872)
- **PositionLiquidated:** Event type `PositionLiquidated` (discriminator 0xcfa7e3b04bb8c14e)
- **PositionClosed:** Event type `PositionClosed` (discriminator 0x3c2bbcd64dac1d8b)
- **FundingPaid:** Event type `FundingPaid` (discriminator 0x4da41e6c47a1b1c2)

Dune Solana automatically handles event type mapping. Use `event_type = 'FillRecorded'` directly in `WHERE` clause.

## Data Retention

- Daily Volume: 90-day rolling window
- Liquidation Funnel: 90-day rolling window
- Funding Rate History: 180-day rolling window
- Top Traders: 180-day rolling window

Adjust `INTERVAL` in `WHERE` blocks to expand or shrink historical lookback.

## Performance Notes

- All queries scan `solana.events` with `program_id` filter (indexed, <10s)
- Recommended refresh: Daily for volume/liquidation, 6-hourly for funding rates
- For real-time monitoring, set dashboard auto-refresh to 1 hour

## Testing

Before deploying to production:
1. Run query on **Dune Testnet** with a small date range (1-7 days)
2. Verify event counts match block explorer logs
3. Cross-check volume calculations with on-chain transaction receipts
4. Confirm liquidation calculations against position lifecycle events

