-- DarkBook Top Traders by Realized PnL Query
-- Metric: Sum of realized P&L from PositionClosed events, ranked by trader
-- Use: Identify winning and losing traders, understand trader distribution, benchmark profitability
--
-- Event: PositionClosed
-- Fields: position, owner, market, exit_price_ticks, pnl, status, slot
-- Discriminator: 0x3c2bbcd64dac1d8b
--
-- Production-ready Dune query for Solana blockchain.

WITH position_closes AS (
  -- Extract PositionClosed events from the DarkBook program
  SELECT
    block_time,
    DATE_TRUNC('day', block_time) as close_day,
    tx_id,
    CAST(get_json_object(parsed_json, '$.position') AS VARCHAR) as position,
    CAST(get_json_object(parsed_json, '$.owner') AS VARCHAR) as owner,
    CAST(get_json_object(parsed_json, '$.market') AS VARCHAR) as market,
    CAST(get_json_object(parsed_json, '$.exit_price_ticks') AS UINT256) as exit_price_ticks,
    CAST(get_json_object(parsed_json, '$.pnl') AS INT256) as pnl,
    CAST(get_json_object(parsed_json, '$.status') AS VARCHAR) as position_status,
    CAST(get_json_object(parsed_json, '$.slot') AS UINT256) as slot
  FROM solana.events
  WHERE
    program_id = '9i4Gpnt8GgrwxqwXdEyjFBsfNChis8z9jmyAbMpFVLcS'
    AND event_type = 'PositionClosed'
    AND block_time >= CURRENT_DATE - INTERVAL '180' day
),
trader_pnl AS (
  -- Aggregate P&L per trader
  SELECT
    owner,
    COUNT(DISTINCT position) as positions_closed,
    SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as winning_positions,
    SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as losing_positions,
    SUM(CASE WHEN pnl = 0 THEN 1 ELSE 0 END) as breakeven_positions,
    SUM(pnl) as total_realized_pnl,
    AVG(CAST(pnl AS DOUBLE)) as avg_pnl_per_position,
    MAX(pnl) as best_trade_pnl,
    MIN(pnl) as worst_trade_pnl,
    COUNT(DISTINCT market) as markets_traded,
    MIN(block_time) as first_close,
    MAX(block_time) as last_close,
    ROUND(100.0 * SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) / COUNT(*), 1) as win_rate_pct
  FROM position_closes
  GROUP BY owner
),
ranked_traders AS (
  -- Rank traders by realized P&L
  SELECT
    ROW_NUMBER() OVER (ORDER BY total_realized_pnl DESC) as rank,
    owner,
    positions_closed,
    winning_positions,
    losing_positions,
    breakeven_positions,
    total_realized_pnl,
    avg_pnl_per_position,
    best_trade_pnl,
    worst_trade_pnl,
    markets_traded,
    win_rate_pct,
    first_close,
    last_close
  FROM trader_pnl
)
SELECT
  rank,
  SUBSTRING(owner, 1, 8) || '...' as owner_display,
  owner as owner_full,
  positions_closed,
  winning_positions,
  losing_positions,
  breakeven_positions,
  ROUND(total_realized_pnl / POWER(10, 6), 2) as total_realized_pnl_millions,
  ROUND(avg_pnl_per_position / POWER(10, 6), 4) as avg_pnl_per_position_millions,
  ROUND(best_trade_pnl / POWER(10, 6), 2) as best_trade_pnl_millions,
  ROUND(worst_trade_pnl / POWER(10, 6), 2) as worst_trade_pnl_millions,
  markets_traded,
  win_rate_pct,
  first_close,
  last_close
FROM ranked_traders
WHERE rank <= 100
ORDER BY rank ASC;
