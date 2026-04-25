use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral;

pub mod constants;
pub mod encrypt_bridge;
pub mod errors;
pub mod events;
pub mod ix;
pub mod matching_engine;
pub mod pyth;
pub mod state;

use ix::*;
use state::*;

declare_id!("Doj2qb3JjcApCGtngWQePVtDAkPTT8nRCDWF5Auk3LVw");

#[ephemeral]
#[program]
pub mod darkbook {
    use super::*;

    // ── Admin ─────────────────────────────────────────────────────────────────

    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        asset_id: [u8; 8],
        oracle_feed_id: [u8; 32],
        max_leverage_bps: u16,
        taker_fee_bps: u16,
        maker_rebate_bps: u16,
        funding_interval_secs: i64,
    ) -> Result<()> {
        admin::initialize_market(
            ctx,
            asset_id,
            oracle_feed_id,
            max_leverage_bps,
            taker_fee_bps,
            maker_rebate_bps,
            funding_interval_secs,
        )
    }

    pub fn set_market_paused(ctx: Context<AdminMarket>, paused: bool) -> Result<()> {
        admin::set_market_paused(ctx, paused)
    }

    // ── Collateral ────────────────────────────────────────────────────────────

    pub fn initialize_user(ctx: Context<InitializeUser>) -> Result<()> {
        collateral::initialize_user(ctx)
    }

    pub fn deposit_collateral(ctx: Context<DepositCollateral>, amount: u64) -> Result<()> {
        collateral::deposit_collateral(ctx, amount)
    }

    pub fn withdraw_collateral(ctx: Context<WithdrawCollateral>, amount: u64) -> Result<()> {
        collateral::withdraw_collateral(ctx, amount)
    }

    // ── Orders ────────────────────────────────────────────────────────────────

    pub fn delegate_book(ctx: Context<DelegateBook>, market: Pubkey) -> Result<()> {
        orders::delegate_book(ctx, market)
    }

    pub fn place_order(
        ctx: Context<PlaceOrder>,
        side: Side,
        price_ticks: u64,
        size_band: SizeBand,
        leverage_bps: u16,
        commitment: [u8; 32],
    ) -> Result<()> {
        orders::place_order(ctx, side, price_ticks, size_band, leverage_bps, commitment)
    }

    pub fn cancel_order(
        ctx: Context<CancelOrder>,
        order_id: u64,
        salt: [u8; 32],
        size_lots: u64,
        leverage_bps: u16,
    ) -> Result<()> {
        orders::cancel_order(ctx, order_id, salt, size_lots, leverage_bps)
    }

    // ── Matching (runs on ER after delegation) ────────────────────────────────

    pub fn match_orders(ctx: Context<MatchOrders>) -> Result<()> {
        matching::match_orders(ctx)
    }

    pub fn commit_book(ctx: Context<CommitBook>) -> Result<()> {
        matching::commit_book(ctx)
    }

    pub fn commit_and_undelegate_book(ctx: Context<CommitBook>) -> Result<()> {
        matching::commit_and_undelegate_book(ctx)
    }

    // ── Settlement ────────────────────────────────────────────────────────────

    #[allow(clippy::too_many_arguments)]
    pub fn claim_fill(
        ctx: Context<ClaimFill>,
        fill_id: u64,
        taker_salt: [u8; 32],
        taker_size: u64,
        taker_leverage: u16,
        taker_commitment: [u8; 32],
        maker_salt: [u8; 32],
        maker_size: u64,
        maker_leverage: u16,
        maker_commitment: [u8; 32],
    ) -> Result<()> {
        settlement::claim_fill(
            ctx,
            fill_id,
            taker_salt,
            taker_size,
            taker_leverage,
            taker_commitment,
            maker_salt,
            maker_size,
            maker_leverage,
            maker_commitment,
        )
    }

    // ── Positions ─────────────────────────────────────────────────────────────

    pub fn mark_position(ctx: Context<MarkPosition>) -> Result<()> {
        positions::mark_position(ctx)
    }

    pub fn accrue_funding_position(ctx: Context<AccrueFunding>) -> Result<()> {
        positions::accrue_funding(ctx)
    }

    pub fn liquidate_position(ctx: Context<LiquidatePosition>) -> Result<()> {
        positions::liquidate_position(ctx)
    }

    pub fn close_position(ctx: Context<ClosePosition>) -> Result<()> {
        positions::close_position(ctx)
    }

    // ── Funding ───────────────────────────────────────────────────────────────

    pub fn update_funding(ctx: Context<UpdateFunding>) -> Result<()> {
        funding::update_funding(ctx)
    }
}
