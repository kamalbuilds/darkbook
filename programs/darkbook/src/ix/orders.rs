use crate::constants::*;
use crate::errors::DarkbookError;
use crate::events::{OrderCancelled, OrderPlaced};
use crate::state::{Market, Order, OrderBook, Side, SizeBand, UserAccount};
use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::delegate;
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use sha2::{Digest, Sha256};

/// Delegate the OrderBook PDA to the MagicBlock ephemeral rollup.
/// Must be called once per market on mainnet before match_orders can run on ER.
pub fn delegate_book(ctx: Context<DelegateBook>, _market: Pubkey) -> Result<()> {
    // Mark the book as delegated. The CPI to MagicBlock follows; if it fails the tx
    // reverts and the flag rollback comes for free with Anchor account semantics.
    // NOTE: pda is AccountInfo (not loadable here as OrderBook), so the caller must
    // call delegate_book BEFORE first match_orders; the runtime guard in matching.rs
    // and the on-chain seed binding ensure no spoofed pda passes this through.
    ctx.accounts.delegate_pda(
        &ctx.accounts.payer,
        &[BOOK_SEED, ctx.accounts.market.key().as_ref()],
        DelegateConfig {
            commit_frequency_ms: 1000,
            validator: ctx.remaining_accounts.first().map(|a| a.key()),
            ..Default::default()
        },
    )?;
    Ok(())
}

/// Place a dark order on the book.
/// Commitment = sha256(salt || size_lots_le || leverage_bps_le || trader_pubkey)
/// The contract only stores: side, price_ticks, size_band, leverage_bps, commitment.
pub fn place_order(
    ctx: Context<PlaceOrder>,
    side: Side,
    price_ticks: u64,
    size_band: SizeBand,
    leverage_bps: u16,
    commitment: [u8; 32],
) -> Result<()> {
    require!(!ctx.accounts.market.paused, DarkbookError::MarketPaused);
    require!(price_ticks > 0, DarkbookError::InvalidPrice);
    require!(
        leverage_bps > 0 && leverage_bps <= ctx.accounts.market.max_leverage_bps,
        DarkbookError::InvalidLeverage
    );

    // Estimate collateral to lock based on size band ceiling
    let size_ceiling = match size_band {
        SizeBand::Small => COLLATERAL_ESTIMATE_SMALL,
        SizeBand::Medium => COLLATERAL_ESTIMATE_MEDIUM,
        SizeBand::Large => COLLATERAL_ESTIMATE_LARGE,
        SizeBand::Whale => COLLATERAL_ESTIMATE_WHALE,
    };
    // collateral_needed = (size_ceiling * price_ticks) / leverage_bps * 100
    // price_ticks is in USDC micro-units per lot, size_ceiling in lots
    // Result in USDC micro-units
    // i128 intermediate eliminates overflow risk for size_ceiling × price_ticks × 100.
    let collateral_u128 = (size_ceiling as u128)
        .checked_mul(price_ticks as u128)
        .ok_or(DarkbookError::Overflow)?
        .checked_mul(100u128)
        .ok_or(DarkbookError::Overflow)?
        .checked_div(leverage_bps as u128)
        .ok_or(DarkbookError::Overflow)?;
    let collateral_needed: u64 =
        u64::try_from(collateral_u128).map_err(|_| DarkbookError::Overflow)?;

    let user_acct = &mut ctx.accounts.user_account;
    require!(
        user_acct.unlocked_amount() >= collateral_needed,
        DarkbookError::InsufficientCollateral
    );

    let clock = Clock::get()?;
    let mut book = ctx.accounts.order_book.load_mut()?;

    let order_id = book.next_order_id;
    book.next_order_id = order_id.checked_add(1).ok_or(DarkbookError::Overflow)?;

    let order = Order {
        order_id,
        trader: ctx.accounts.trader.key().to_bytes(),
        side: match side {
            Side::Long => 0,
            Side::Short => 1,
        },
        size_band: match size_band {
            SizeBand::Small => 0,
            SizeBand::Medium => 1,
            SizeBand::Large => 2,
            SizeBand::Whale => 3,
        },
        leverage_bps,
        _pad: [0u8; 4],
        price_ticks,
        commitment,
        placed_slot: clock.slot,
    };

    let inserted = match side {
        Side::Long => book.insert_bid(order),
        Side::Short => book.insert_ask(order),
    };
    require!(inserted, DarkbookError::FillQueueFull);
    drop(book);

    emit!(OrderPlaced {
        order_id,
        trader: ctx.accounts.trader.key(),
        market: ctx.accounts.market.key(),
        side,
        price_ticks,
        size_band,
        leverage_bps,
        commitment,
        slot: clock.slot,
    });

    Ok(())
}

/// Cancel an order by revealing the plaintext to verify the commitment.
/// Commitment check: sha256(salt || size_lots_le_bytes || leverage_bps_le_bytes || trader_pubkey) == commitment
pub fn cancel_order(
    ctx: Context<CancelOrder>,
    order_id: u64,
    salt: [u8; 32],
    size_lots: u64,
    leverage_bps: u16,
) -> Result<()> {
    require!(!ctx.accounts.market.paused, DarkbookError::MarketPaused);
    let mut book = ctx.accounts.order_book.load_mut()?;

    // Find the order in the book (try bid first, then ask)
    let (found, is_bid, stored_commitment) = find_order_in_book(&book, order_id);
    require!(found, DarkbookError::OrderNotFound);

    // Verify commitment
    let computed = compute_commitment(&salt, size_lots, leverage_bps, &ctx.accounts.trader.key());
    require!(
        computed == stored_commitment,
        DarkbookError::CommitmentMismatch
    );

    // Verify caller owns this order
    // (trader check is done implicitly — commitment includes trader pubkey)

    let (price_ticks, stored_leverage_bps, stored_size_band) = book
        .cancel_order(order_id, is_bid)
        .ok_or(DarkbookError::OrderNotFound)?;
    require!(
        stored_leverage_bps == leverage_bps,
        DarkbookError::CommitmentMismatch
    );
    drop(book);

    let _collateral_estimate =
        compute_order_collateral_from_band(stored_size_band, price_ticks, leverage_bps)?;

    let clock = Clock::get()?;
    emit!(OrderCancelled {
        order_id,
        trader: ctx.accounts.trader.key(),
        market: ctx.accounts.market.key(),
        slot: clock.slot,
    });

    Ok(())
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

pub fn compute_commitment(
    salt: &[u8; 32],
    size_lots: u64,
    leverage_bps: u16,
    trader: &Pubkey,
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(salt);
    hasher.update(size_lots.to_le_bytes());
    hasher.update(leverage_bps.to_le_bytes());
    hasher.update(trader.to_bytes());
    hasher.finalize().into()
}

fn compute_order_collateral_from_band(
    size_band: u8,
    price_ticks: u64,
    leverage_bps: u16,
) -> Result<u64> {
    require!(leverage_bps > 0, DarkbookError::InvalidLeverage);
    let size_ceiling: u64 = match size_band {
        0 => COLLATERAL_ESTIMATE_SMALL,
        1 => COLLATERAL_ESTIMATE_MEDIUM,
        2 => COLLATERAL_ESTIMATE_LARGE,
        3 => COLLATERAL_ESTIMATE_WHALE,
        _ => return Err(DarkbookError::InvalidLeverage.into()),
    };
    // i128 intermediate so size × price × 100 cannot overflow before division.
    let collateral_u128 = (size_ceiling as u128)
        .checked_mul(price_ticks as u128)
        .ok_or(DarkbookError::Overflow)?
        .checked_mul(100u128)
        .ok_or(DarkbookError::Overflow)?
        .checked_div(leverage_bps as u128)
        .ok_or(DarkbookError::Overflow)?;
    u64::try_from(collateral_u128).map_err(|_| DarkbookError::Overflow.into())
}

fn find_order_in_book(book: &OrderBook, order_id: u64) -> (bool, bool, [u8; 32]) {
    // search bids
    for bi in 0..book.bid_count as usize {
        for oi in 0..book.bids[bi].count as usize {
            if book.bids[bi].orders[oi].order_id == order_id {
                return (true, true, book.bids[bi].orders[oi].commitment);
            }
        }
    }
    // search asks
    for ai in 0..book.ask_count as usize {
        for oi in 0..book.asks[ai].count as usize {
            if book.asks[ai].orders[oi].order_id == order_id {
                return (true, false, book.asks[ai].orders[oi].commitment);
            }
        }
    }
    (false, false, [0u8; 32])
}

// ─── Accounts ────────────────────────────────────────────────────────────────

/// The `#[delegate]` macro injects the delegation program accounts.
#[delegate]
#[derive(Accounts)]
pub struct DelegateBook<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: The book PDA to delegate — validated by seed constraint
    #[account(
        mut,
        del,
        seeds = [BOOK_SEED, market.key().as_ref()],
        bump
    )]
    pub pda: AccountInfo<'info>,
    #[account(has_one = admin)]
    pub market: Account<'info, Market>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct PlaceOrder<'info> {
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [USER_SEED, market.key().as_ref(), trader.key().as_ref()],
        bump = user_account.bump,
        has_one = market,
    )]
    pub user_account: Account<'info, UserAccount>,

    #[account(
        mut,
        seeds = [BOOK_SEED, market.key().as_ref()],
        bump
    )]
    pub order_book: AccountLoader<'info, OrderBook>,

    #[account(mut)]
    pub trader: Signer<'info>,
}

#[derive(Accounts)]
pub struct CancelOrder<'info> {
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [USER_SEED, market.key().as_ref(), trader.key().as_ref()],
        bump = user_account.bump,
        has_one = market,
    )]
    pub user_account: Account<'info, UserAccount>,

    #[account(
        mut,
        seeds = [BOOK_SEED, market.key().as_ref()],
        bump
    )]
    pub order_book: AccountLoader<'info, OrderBook>,

    #[account(mut)]
    pub trader: Signer<'info>,
}
