use crate::state::{PositionStatus, Side, SizeBand};
use anchor_lang::prelude::*;

#[event]
pub struct OrderPlaced {
    pub order_id: u64,
    pub trader: Pubkey,
    pub market: Pubkey,
    pub side: Side,
    pub price_ticks: u64,
    pub size_band: SizeBand,
    pub leverage_bps: u16,
    pub commitment: [u8; 32],
    pub slot: u64,
}

#[event]
pub struct OrderCancelled {
    pub order_id: u64,
    pub trader: Pubkey,
    pub market: Pubkey,
    pub slot: u64,
}

#[event]
pub struct FillRecorded {
    pub fill_id: u64,
    pub taker_order_id: u64,
    pub maker_order_id: u64,
    pub taker: Pubkey,
    pub maker: Pubkey,
    pub price_ticks: u64,
    pub size_band: SizeBand,
    pub slot: u64,
}

#[event]
pub struct PositionOpened {
    pub position: Pubkey,
    pub owner: Pubkey,
    pub market: Pubkey,
    pub side: Side,
    pub entry_price_ticks: u64,
    pub size_lots: u64,
    pub collateral_locked: u64,
    pub leverage_bps: u16,
    pub slot: u64,
}

#[event]
pub struct PositionLiquidated {
    pub position: Pubkey,
    pub owner: Pubkey,
    pub market: Pubkey,
    pub liquidator: Pubkey,
    pub mark_price_ticks: u64,
    pub pnl: i64,
    pub bounty: u64,
    pub slot: u64,
}

#[event]
pub struct PositionClosed {
    pub position: Pubkey,
    pub owner: Pubkey,
    pub market: Pubkey,
    pub exit_price_ticks: u64,
    pub pnl: i64,
    pub status: PositionStatus,
    pub slot: u64,
}

#[event]
pub struct FundingPaid {
    pub market: Pubkey,
    pub position: Pubkey,
    pub owner: Pubkey,
    pub amount: i64,
    pub funding_rate_bps: i64,
    pub slot: u64,
}
