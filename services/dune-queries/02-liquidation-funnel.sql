-- DarkBook Liquidation Funnel Query
-- Metric: PositionOpened → PositionLiquidated conversion rate by leverage band
-- Use: Understand liquidation risk by leverage level and identify over-leveraged users
--
-- Events:
--   PositionOpened: position, owner, market, side, entry_price_ticks, size_lots, leverage_bps
--   PositionLiquidated: position, owner, pnl, bounty, liquidator
-- Discriminators:
--   PositionOpened: 0x09a1cebdf7a95872
--   PositionLiquidated: 0xcfa7e3b04bb8c14e
--
-- Production-ready Dune query for Solana blockchain.

WITH position_opens AS (
  -- Extract PositionOpened events
  SELECT
    block_time,
    DATE_TRUNC('day', block_time) as open_day,
    CAST(get_json_object(parsed_json, '$.position') AS VARCHAR) as position,
    CAST(get_json_object(parsed_json, '$.owner') AS VARCHAR) as owner,
    CAST(get_json_object(parsed_json, '$.market') AS VARCHAR) as market,
    CAST(get_json_object(parsed_json, '$.leverage_bps') AS UINT256) as leverage_bps,
    CAST(get_json_object(parsed_json, '$.size_lots') AS UINT256) as size_lots,
    CAST(get_json_object(parsed_json, '$.entry_price_ticks') AS UINT256) as entry_price_ticks,
    CASE
      WHEN CAST(get_json_object(parsed_json, '$.leverage_bps') AS UINT256) <= 200 THEN '1x-2x'
      WHEN CAST(get_json_object(parsed_json, '$.leverage_bps') AS UINT256) <= 500 THEN '2x-5x'
      WHEN CAST(get_json_object(parsed_json, '$.leverage_bps') AS UINT256) <= 1000 THEN '5x-10x'
      ELSE '10x+'
    END as leverage_band
  FROM solana.events
  WHERE
    program_id = '9i4Gpnt8GgrwxqwXdEyjFBsfNChis8z9jmyAbMpFVLcS'
    AND event_type = 'PositionOpened'
    AND block_time >= CURRENT_DATE - INTERVAL '90' day
),
position_liquidations AS (
  -- Extract PositionLiquidated events
  SELECT
    block_time,
    DATE_TRUNC('day', block_time) as liquidation_day,
    CAST(get_json_object(parsed_json, '$.position') AS VARCHAR) as position,
    CAST(get_json_object(parsed_json, '$.owner') AS VARCHAR) as owner,
    CAST(get_json_object(parsed_json, '$.pnl') AS INT256) as pnl,
    CAST(get_json_object(parsed_json, '$.bounty') AS UINT256) as bounty,
    CAST(get_json_object(parsed_json, '$.liquidator') AS VARCHAR) as liquidator
  FROM solana.events
  WHERE
    program_id = '9i4Gpnt8GgrwxqwXdEyjFBsfNChis8z9jmyAbMpFVLcS'
    AND event_type = 'PositionLiquidated'
    AND block_time >= CURRENT_DATE - INTERVAL '90' day
),
funnel_data AS (
  -- Join opens with liquidations to measure funnel
  SELECT
    po.leverage_band,
    COUNT(DISTINCT po.position) as positions_opened,
    COUNT(DISTINCT pl.position) as positions_liquidated,
    COUNT(DISTINCT pl.owner) as unique_liquidated_owners,
    ROUND(100.0 * COUNT(DISTINCT pl.position) / COUNT(DISTINCT po.position), 2) as liquidation_rate_pct,
    AVG(CAST(pl.pnl AS DOUBLE)) as avg_liquidation_pnl,
    SUM(pl.bounty) as total_liquidation_bounties,
    MIN(po.open_day) as first_opening,
    MAX(pl.liquidation_day) as last_liquidation
  FROM position_opens po
  LEFT JOIN position_liquidations pl
    ON po.position = pl.position
    AND pl.block_time > po.block_time
  GROUP BY po.leverage_band
)
SELECT
  leverage_band,
  positions_opened,
  positions_liquidated,
  unique_liquidated_owners,
  liquidation_rate_pct,
  ROUND(avg_liquidation_pnl / POWER(10, 6), 2) as avg_liquidation_pnl_millions,
  total_liquidation_bounties,
  first_opening,
  last_liquidation
FROM funnel_data
ORDER BY liquidation_rate_pct DESC;
