use crate::constants::{BOOK_SEED, MARKET_SEED, VAULT_SEED};
use crate::errors::DarkbookError;
use crate::state::{CollateralVault, Market, OrderBook};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::account_info::{AccountInfo, MAX_PERMITTED_DATA_INCREASE};
use anchor_lang::system_program::{self as anchor_system};
use anchor_spl::token::Mint;
use bytemuck::try_from_bytes_mut;

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

    // OrderBook is ~228 KiB. Anchor `init` uses one System CPI, which breaks Solana's
    // MAX_PERMITTED_DATA_INCREASE (10 KiB) per CPI. Allocate with space 0, then grow in chunks.
    let ob: &AccountInfo = ctx.accounts.order_book.as_ref();
    require!(
        ob.data_len() == 0 && ob.lamports() == 0,
        DarkbookError::OrderBookAccountNotEmpty
    );

    let target_len = OrderBook::LEN;
    let rent = Rent::get()?;
    let lamports = rent.minimum_balance(target_len);

    let market_pk = ctx.accounts.market.key();
    let bump_seed = [ctx.bumps.order_book];
    let ob_seeds: &[&[u8]] = &[BOOK_SEED, market_pk.as_ref(), &bump_seed];
    let signer_seeds: &[&[&[u8]]] = &[ob_seeds];

    anchor_system::create_account(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            anchor_system::CreateAccount {
                from: ctx.accounts.admin.to_account_info(),
                to: ob.clone(),
            },
            signer_seeds,
        ),
        lamports,
        0,
        ctx.program_id,
    )?;

    msg!("Market initialized: {:?}", asset_id);
    Ok(())
}

/// Grow the order book PDA by up to 10 KiB. Call repeatedly (same or separate txs) until
/// `data_len() == OrderBook::LEN`, then `finalize_order_book_init`.
///
/// `chunk_index` is only used to vary transaction signatures (bankrun rejects duplicate txs);
/// it is not validated against the current size.
pub fn extend_order_book(ctx: Context<ExtendOrderBook>, _chunk_index: u32) -> Result<()> {
    let ob = ctx.accounts.order_book.as_ref();
    let cur = ob.data_len();
    if cur >= OrderBook::LEN {
        return Ok(());
    }
    let next = core::cmp::min(cur + MAX_PERMITTED_DATA_INCREASE, OrderBook::LEN);
    ob.resize(next)?;
    Ok(())
}

/// Write Anchor discriminator + default order book header (must be full `OrderBook::LEN`).
pub fn finalize_order_book_init(ctx: Context<FinalizeOrderBookInit>) -> Result<()> {
    let ob = ctx.accounts.order_book.as_ref();
    require_eq!(
        ob.data_len(),
        OrderBook::LEN,
        DarkbookError::OrderBookInitIncomplete
    );

    let market_pk = ctx.accounts.market.key();
    let mut data = ob.try_borrow_mut_data()?;
    let disc = OrderBook::DISCRIMINATOR;
    if data[..disc.len()].iter().any(|b| *b != 0) {
        return Err(error!(DarkbookError::OrderBookAlreadyFinalized));
    }

    data[..disc.len()].copy_from_slice(&disc);
    let body = &mut data[disc.len()..OrderBook::LEN];
    let book: &mut OrderBook = try_from_bytes_mut(body).map_err(|_| DarkbookError::Overflow)?;
    book.market = market_pk.to_bytes();
    book.next_order_id = 1;
    book.next_fill_id = 1;
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

    /// CHECK: PDA created at 0 bytes in initialize_market; extended via extend_order_book, finalized via finalize_order_book_init.
    #[account(
        mut,
        seeds = [BOOK_SEED, market.key().as_ref()],
        bump
    )]
    pub order_book: UncheckedAccount<'info>,

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

#[derive(Accounts)]
pub struct ExtendOrderBook<'info> {
    #[account(mut, has_one = admin)]
    pub market: Account<'info, Market>,
    pub admin: Signer<'info>,
    /// CHECK: PDA grows in extend_order_book; seeds tied to market.
    #[account(mut, seeds = [BOOK_SEED, market.key().as_ref()], bump)]
    pub order_book: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct FinalizeOrderBookInit<'info> {
    #[account(mut, has_one = admin)]
    pub market: Account<'info, Market>,
    pub admin: Signer<'info>,
    /// CHECK: zero_copy OrderBook payload written here after full size is reached.
    #[account(mut, seeds = [BOOK_SEED, market.key().as_ref()], bump)]
    pub order_book: UncheckedAccount<'info>,
}
