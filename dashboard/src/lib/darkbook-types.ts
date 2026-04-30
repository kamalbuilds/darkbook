/**
 * Shared types for DarkBook dashboard.
 * These mirror the Rust on-chain types from ARCHITECTURE.md.
 * When the real @darkbook/sdk is built and published, import from there instead.
 */

export type Side = "Long" | "Short";

export type SizeBand = "Small" | "Medium" | "Large" | "Whale";

export type PositionStatus = "Open" | "Liquidated" | "Closed";

export interface Order {
  order_id: string;
  trader: string;
  side: Side;
  price_ticks: number;
  size_band: SizeBand;
  leverage_bps: number;
  commitment: Uint8Array;
  placed_slot: number;
}

export interface Fill {
  fill_id: string;
  taker_order_id: string;
  maker_order_id: string;
  taker: string;
  maker: string;
  price_ticks: number;
  size_band: SizeBand;
  matched_slot: number;
  claimed: boolean;
}

export interface Position {
  pubkey: string;
  owner: string;
  market: string;
  side: Side;
  size_lots: number;
  entry_price_ticks: number;
  collateral_locked: number;
  opened_ts: number;
  last_funding_index: number;
  status: PositionStatus;
  unrealized_pnl?: number;
  liq_price_ticks?: number;
  leverage: number;
}

export interface MarketInfo {
  asset_id: string;
  oracle_feed_id: string;
  funding_interval_secs: number;
  max_leverage_bps: number;
  taker_fee_bps: number;
  maker_rebate_bps: number;
  total_long_size: number;
  total_short_size: number;
  last_funding_ts: number;
  mark_price: number | null;
  index_price: number | null;
  paused: boolean;
}

export interface OrderBookLevel {
  price_ticks: number;
  size_band: SizeBand;
  side: Side;
  order_count: number;
}

export interface ClosedPositionRecord {
  pubkey: string;
  owner: string;
  side: Side;
  size_lots: number;
  entry_price_ticks: number;
  exit_price_ticks: number;
  realized_pnl: number;
  funding_paid: number;
  opened_ts: number;
  closed_ts: number;
  status: PositionStatus;
}

export interface LeaderboardEntry {
  rank: number;
  trader: string;
  realized_pnl: number;
  trade_count: number;
  win_rate: number;
}
