-- DarkBook Daily Volume Query
-- Metric: Sum of notional volume per day from FillRecorded events
-- Denominator: size_band (treated as size_lots) * price_ticks
-- Use: Track daily trading activity and identify peak trading periods
--
-- Event: FillRecorded
-- Fields: fill_id, taker_order_id, maker_order_id, taker, maker, price_ticks, size_band, slot
-- Discriminator: sha256("event:FillRecorded")[..8] = 0x59bc8a8bcf3e2cdb
--
-- Production-ready Dune query for Solana blockchain.

WITH fill_events AS (
  -- Decode FillRecorded events from the DarkBook program
  SELECT
    block_time,
    DATE_TRUNC('day', block_time) as trading_day,
    tx_id,
    instruction_index,
    -- AnchorProgramEvent discriminator for FillRecorded: 0x59bc8a8bcf3e2cdb
    CAST(get_json_object(parsed_json, '$.fill_id') AS UINT256) as fill_id,
    CAST(get_json_object(parsed_json, '$.taker_order_id') AS UINT256) as taker_order_id,
    CAST(get_json_object(parsed_json, '$.maker_order_id') AS UINT256) as maker_order_id,
    CAST(get_json_object(parsed_json, '$.price_ticks') AS UINT256) as price_ticks,
    CAST(get_json_object(parsed_json, '$.size_band') AS UINT256) as size_lots,
    CAST(get_json_object(parsed_json, '$.slot') AS UINT256) as slot,
    get_json_object(parsed_json, '$.taker') as taker,
    get_json_object(parsed_json, '$.maker') as maker
  FROM solana.events
  WHERE
    program_id = '9i4Gpnt8GgrwxqwXdEyjFBsfNChis8z9jmyAbMpFVLcS'
    AND event_type = 'FillRecorded'
    AND block_time >= CURRENT_DATE - INTERVAL '90' day
),
daily_volume AS (
  -- Aggregate notional volume per trading day
  SELECT
    trading_day,
    COUNT(DISTINCT fill_id) as fill_count,
    SUM(price_ticks * size_lots) as notional_volume_ticks,
    SUM(CASE WHEN size_lots > 0 THEN 1 ELSE 0 END) as fills_with_nonzero_size,
    MIN(block_time) as first_trade_time,
    MAX(block_time) as last_trade_time,
    COUNT(DISTINCT taker) as unique_takers,
    COUNT(DISTINCT maker) as unique_makers
  FROM fill_events
  GROUP BY trading_day
)
SELECT
  trading_day,
  fill_count,
  notional_volume_ticks,
  ROUND(notional_volume_ticks / POWER(10, 6), 2) as volume_millions,
  fills_with_nonzero_size,
  unique_takers,
  unique_makers,
  first_trade_time,
  last_trade_time
FROM daily_volume
ORDER BY trading_day DESC;
