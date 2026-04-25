use crate::constants::{BOOK_SEED, MARKET_SEED, VAULT_SEED};
use crate::errors::DarkbookError;
use crate::state::{CollateralVault, Market, OrderBook};
use anchor_lang::prelude::*;
use anchor_spl::token::Mint;

/// Initialize a new market with its associated vault and empty order book.
pub fn initialize_market(
    ctx: Context<InitializeMarket>,
    asset_id: [u8; 8],
    oracle_feed_id: [u8; 32],
    max_leverage_bps: u16,
    taker_fee_bps: u16,
    maker_rebate_bps: u16,
    funding_interval_secs: i64,
) -> Result<()> {
    require!(max_leverage_bps > 0, DarkbookError::InvalidLeverage);

    let market = &mut ctx.accounts.market;
    market.asset_id = asset_id;
    market.oracle_feed_id = oracle_feed_id;
    market.funding_interval_secs = funding_interval_secs;
    market.max_leverage_bps = max_leverage_bps;
    market.taker_fee_bps = taker_fee_bps;
    market.maker_rebate_bps = maker_rebate_bps;
    market.last_funding_ts = Clock::get()?.unix_timestamp;
    market.realized_loss_pool = 0;
    market.paused = false;
    market.admin = ctx.accounts.admin.key();
    market.bump = ctx.bumps.market;

    let vault = &mut ctx.accounts.vault;
    vault.market = ctx.accounts.market.key();
    vault.mint = ctx.accounts.mint.key();
    vault.bump = ctx.bumps.vault;

    // Initialize the order book (zero_copy — fields default to zero)
    let mut book = ctx.accounts.order_book.load_init()?;
    let market_key = ctx.accounts.market.key();
    book.market = market_key.to_bytes();
    book.next_order_id = 1;
    book.next_fill_id = 1;
    drop(book);

    msg!("Market initialized: {:?}", asset_id);
    Ok(())
}

/// Pause or unpause a market (admin only).
pub fn set_market_paused(ctx: Context<AdminMarket>, paused: bool) -> Result<()> {
    ctx.accounts.market.paused = paused;
    Ok(())
}

// ─── Accounts ────────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(asset_id: [u8; 8])]
pub struct InitializeMarket<'info> {
    #[account(
        init,
        payer = admin,
        space = Market::LEN,
        seeds = [MARKET_SEED, &asset_id],
        bump
    )]
    pub market: Account<'info, Market>,

    #[account(
        init,
        payer = admin,
        space = CollateralVault::LEN,
        seeds = [VAULT_SEED, market.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, CollateralVault>,

    /// The SPL token mint (USDC)
    pub mint: Account<'info, Mint>,

    /// Zero-copy OrderBook PDA — allocated large enough for all buckets.
    /// Space = OrderBook::LEN. init sets discriminator; fields zeroed by OS.
    #[account(
        init,
        payer = admin,
        space = OrderBook::LEN,
        seeds = [BOOK_SEED, market.key().as_ref()],
        bump
    )]
    pub order_book: AccountLoader<'info, OrderBook>,

    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminMarket<'info> {
    #[account(mut, has_one = admin)]
    pub market: Account<'info, Market>,
    pub admin: Signer<'info>,
}
