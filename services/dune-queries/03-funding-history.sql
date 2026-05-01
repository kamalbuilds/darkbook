-- DarkBook Funding Rate History Query
-- Metric: Daily aggregated funding rates from FundingPaid events
-- Use: Track funding rate trends over time, identify funding spikes, understand capital costs
--
-- Event: FundingPaid
-- Fields: market, position, owner, amount, funding_rate_bps, slot
-- Discriminator: 0x4da41e6c47a1b1c2
--
-- Production-ready Dune query for Solana blockchain.

WITH funding_events AS (
  -- Decode FundingPaid events from the DarkBook program
  SELECT
    block_time,
    DATE_TRUNC('day', block_time) as funding_day,
    tx_id,
    CAST(get_json_object(parsed_json, '$.market') AS VARCHAR) as market,
    CAST(get_json_object(parsed_json, '$.position') AS VARCHAR) as position,
    CAST(get_json_object(parsed_json, '$.owner') AS VARCHAR) as owner,
    CAST(get_json_object(parsed_json, '$.amount') AS INT256) as funding_amount,
    CAST(get_json_object(parsed_json, '$.funding_rate_bps') AS INT256) as funding_rate_bps,
    CAST(get_json_object(parsed_json, '$.slot') AS UINT256) as slot
  FROM solana.events
  WHERE
    program_id = '9i4Gpnt8GgrwxqwXdEyjFBsfNChis8z9jmyAbMpFVLcS'
    AND event_type = 'FundingPaid'
    AND block_time >= CURRENT_DATE - INTERVAL '180' day
),
daily_funding AS (
  -- Aggregate funding metrics per day per market
  SELECT
    funding_day,
    market,
    COUNT(DISTINCT position) as positions_funded,
    COUNT(DISTINCT owner) as unique_traders_funded,
    AVG(CAST(funding_rate_bps AS DOUBLE)) as avg_funding_rate_bps,
    MIN(CAST(funding_rate_bps AS DOUBLE)) as min_funding_rate_bps,
    MAX(CAST(funding_rate_bps AS DOUBLE)) as max_funding_rate_bps,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY CAST(funding_rate_bps AS DOUBLE)) as median_funding_rate_bps,
    SUM(funding_amount) as net_funding_paid,
    SUM(CASE WHEN funding_amount > 0 THEN funding_amount ELSE 0 END) as positive_funding,
    SUM(CASE WHEN funding_amount < 0 THEN ABS(funding_amount) ELSE 0 END) as negative_funding,
    COUNT(*) as total_funding_events
  FROM funding_events
  GROUP BY funding_day, market
),
market_daily_summary AS (
  -- Additional market-wide aggregations
  SELECT
    funding_day,
    COUNT(DISTINCT market) as markets_active,
    SUM(positions_funded) as total_positions_funded,
    SUM(unique_traders_funded) as total_unique_traders,
    AVG(avg_funding_rate_bps) as avg_rate_across_markets,
    MAX(max_funding_rate_bps) as peak_funding_rate_bps,
    MIN(min_funding_rate_bps) as floor_funding_rate_bps
  FROM daily_funding
  GROUP BY funding_day
)
SELECT
  funding_day,
  markets_active,
  total_positions_funded,
  total_unique_traders,
  ROUND(avg_rate_across_markets, 2) as avg_funding_rate_bps,
  ROUND(peak_funding_rate_bps, 2) as peak_funding_rate_bps,
  ROUND(floor_funding_rate_bps, 2) as floor_funding_rate_bps,
  ROUND(avg_rate_across_markets / 10000.0, 4) as avg_funding_rate_pct_per_day
FROM market_daily_summary
ORDER BY funding_day DESC;
