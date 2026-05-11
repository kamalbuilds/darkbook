use crate::constants::{BOOK_SEED, POS_SEED, USER_SEED};
use crate::errors::DarkbookError;
use crate::events::PositionOpened;
use crate::ix::orders::compute_commitment;
use crate::state::{Market, OrderBook, Position, PositionStatus, Side, UserAccount};
use anchor_lang::prelude::*;

/// Permissionless settler: verifies both sides' commitments, then creates
/// Position PDAs for taker (long) and maker (short).
///
/// The fill stores taker+maker pubkeys. The settler supplies plaintext
/// (salt, size, leverage) for each side; the contract hashes them and
/// compares against the commitments stored in the order.
///
/// Since the order is already popped from the book (consumed by match_step),
/// the commitment must be retrieved from the Fill record which stores it
/// via the order_id. The book stores filled order commitments in the fill
/// via a lookup done here.
///
/// ARCHITECTURE NOTE: We embed taker_commitment and maker_commitment as
/// instruction parameters (32-byte arrays) rather than separate accounts.
/// The handler reconstructs them from (salt || size || leverage || trader).
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
    require!(!ctx.accounts.market.paused, DarkbookError::MarketPaused);
    // ── Load fill from committed book ────────────────────────────────────────
    let (price_ticks, taker_key, maker_key, fill_size_band) = {
        let mut book = ctx.accounts.order_book.load_mut()?;
        let idx = book.find_fill(fill_id).ok_or(DarkbookError::FillNotFound)?;
        let fill = book.fills[idx];
        require!(fill.claimed == 0, DarkbookError::FillNotFound);

        let taker_pubkey = Pubkey::from(fill.taker);
        let maker_pubkey = Pubkey::from(fill.maker);

        // Self-match dead-locks settlement (taker_pos and maker_pos PDAs collide).
        require_keys_neq!(taker_pubkey, maker_pubkey, DarkbookError::Unauthorized);

        // Bind the supplied user accounts to the on-chain fill participants.
        require_keys_eq!(
            ctx.accounts.taker_user.owner,
            taker_pubkey,
            DarkbookError::Unauthorized
        );
        require_keys_eq!(
            ctx.accounts.maker_user.owner,
            maker_pubkey,
            DarkbookError::Unauthorized
        );

        // Enforce size band ceiling on revealed sizes.
        let band_max = match fill.size_band {
            0 => crate::constants::SMALL_BAND_MAX_LOTS,
            1 => crate::constants::MEDIUM_BAND_MAX_LOTS,
            2 => crate::constants::LARGE_BAND_MAX_LOTS,
            3 => crate::constants::WHALE_BAND_MAX_LOTS,
            _ => return Err(DarkbookError::InvalidSide.into()),
        };
        require!(taker_size <= band_max, DarkbookError::InvalidLeverage);
        require!(maker_size <= band_max, DarkbookError::InvalidLeverage);

        // Verify taker commitment: sha256(salt || size_lots_le || leverage_bps_le || trader)
        let computed_taker =
            compute_commitment(&taker_salt, taker_size, taker_leverage, &taker_pubkey);
        require!(
            computed_taker == taker_commitment,
            DarkbookError::CommitmentMismatch
        );

        // Verify maker commitment
        let computed_maker =
            compute_commitment(&maker_salt, maker_size, maker_leverage, &maker_pubkey);
        require!(
            computed_maker == maker_commitment,
            DarkbookError::CommitmentMismatch
        );

        book.fills[idx].claimed = 1;
        (fill.price_ticks, taker_pubkey, maker_pubkey, fill.size_band)
    };
    let _ = fill_size_band;

    // Reveal sizes must match: a single fill represents one matched quantity.
    // Allowing taker_size != maker_size would let one side open a phantom-sized
    // position not backed by the other counterparty.
    require!(taker_size == maker_size, DarkbookError::CommitmentMismatch);

    let clock = Clock::get()?;
    let market_key = ctx.accounts.market.key();
    let cum_long = ctx.accounts.market.cum_funding_long;
    let cum_short = ctx.accounts.market.cum_funding_short;

    // Open-interest accounting: increment both sides by the matched size.
    // Required for funding rate calculations (read total_long_size/total_short_size).
    {
        let market = &mut ctx.accounts.market;
        market.total_long_size = market
            .total_long_size
            .checked_add(taker_size)
            .ok_or(DarkbookError::Overflow)?;
        market.total_short_size = market
            .total_short_size
            .checked_add(maker_size)
            .ok_or(DarkbookError::Overflow)?;
    }

    // ── Taker position (long side — bid was the aggressor) ──────────────────
    {
        let taker_collateral = compute_collateral(taker_size, price_ticks, taker_leverage)?;
        let taker_user = &mut ctx.accounts.taker_user;
        require!(
            taker_user.unlocked_amount() >= taker_collateral,
            DarkbookError::InsufficientCollateral
        );
        taker_user.locked_amount = taker_user
            .locked_amount
            .checked_add(taker_collateral)
            .ok_or(DarkbookError::Overflow)?;
        let taker_idx = taker_user.next_position_idx;
        taker_user.next_position_idx = taker_user
            .next_position_idx
            .checked_add(1)
            .ok_or(DarkbookError::Overflow)?;

        let taker_pos = &mut ctx.accounts.taker_position;
        taker_pos.owner = taker_key;
        taker_pos.market = market_key;
        taker_pos.side = Side::Long;
        taker_pos.size_lots = taker_size;
        taker_pos.entry_price_ticks = price_ticks;
        taker_pos.collateral_locked = taker_collateral;
        taker_pos.opened_ts = clock.unix_timestamp;
        taker_pos.last_funding_index = cum_long;
        taker_pos.status = PositionStatus::Open;
        taker_pos.leverage_bps = taker_leverage;
        taker_pos.position_idx = taker_idx;
        taker_pos.bump = ctx.bumps.taker_position;

        emit!(PositionOpened {
            position: taker_pos.key(),
            owner: taker_key,
            market: market_key,
            side: Side::Long,
            entry_price_ticks: price_ticks,
            size_lots: taker_size,
            collateral_locked: taker_collateral,
            leverage_bps: taker_leverage,
            slot: clock.slot,
        });
    }

    // ── Maker position (short side — ask was the passive side) ──────────────
    {
        let maker_collateral = compute_collateral(maker_size, price_ticks, maker_leverage)?;
        let maker_user = &mut ctx.accounts.maker_user;
        require!(
            maker_user.unlocked_amount() >= maker_collateral,
            DarkbookError::InsufficientCollateral
        );
        maker_user.locked_amount = maker_user
            .locked_amount
            .checked_add(maker_collateral)
            .ok_or(DarkbookError::Overflow)?;
        let maker_idx = maker_user.next_position_idx;
        maker_user.next_position_idx = maker_user
            .next_position_idx
            .checked_add(1)
            .ok_or(DarkbookError::Overflow)?;

        let maker_pos = &mut ctx.accounts.maker_position;
        maker_pos.owner = maker_key;
        maker_pos.market = market_key;
        maker_pos.side = Side::Short;
        maker_pos.size_lots = maker_size;
        maker_pos.entry_price_ticks = price_ticks;
        maker_pos.collateral_locked = maker_collateral;
        maker_pos.opened_ts = clock.unix_timestamp;
        maker_pos.last_funding_index = cum_short;
        maker_pos.status = PositionStatus::Open;
        maker_pos.leverage_bps = maker_leverage;
        maker_pos.position_idx = maker_idx;
        maker_pos.bump = ctx.bumps.maker_position;

        emit!(PositionOpened {
            position: maker_pos.key(),
            owner: maker_key,
            market: market_key,
            side: Side::Short,
            entry_price_ticks: price_ticks,
            size_lots: maker_size,
            collateral_locked: maker_collateral,
            leverage_bps: maker_leverage,
            slot: clock.slot,
        });
    }

    Ok(())
}

pub fn compute_collateral(size_lots: u64, price_ticks: u64, leverage_bps: u16) -> Result<u64> {
    require!(leverage_bps > 0, DarkbookError::InvalidLeverage);
    // i128 intermediate eliminates overflow risk for whale × extreme price.
    let notional = (size_lots as u128)
        .checked_mul(price_ticks as u128)
        .ok_or(DarkbookError::Overflow)?;
    let collateral_u128 = notional
        .checked_mul(100)
        .ok_or(DarkbookError::Overflow)?
        .checked_div(leverage_bps as u128)
        .ok_or(DarkbookError::Overflow)?;
    u64::try_from(collateral_u128).map_err(|_| DarkbookError::Overflow.into())
}

// ─── Accounts ────────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(
    fill_id: u64,
    taker_salt: [u8; 32],
    taker_size: u64,
    taker_leverage: u16,
    taker_commitment: [u8; 32],
    maker_salt: [u8; 32],
    maker_size: u64,
    maker_leverage: u16,
    maker_commitment: [u8; 32]
)]
pub struct ClaimFill<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [BOOK_SEED, market.key().as_ref()],
        bump
    )]
    pub order_book: AccountLoader<'info, OrderBook>,

    // Taker side
    #[account(
        mut,
        seeds = [USER_SEED, market.key().as_ref(), taker_user.owner.as_ref()],
        bump = taker_user.bump,
        has_one = market,
    )]
    pub taker_user: Account<'info, UserAccount>,

    #[account(
        init,
        payer = settler,
        space = Position::LEN,
        seeds = [
            POS_SEED,
            market.key().as_ref(),
            taker_user.owner.as_ref(),
            &taker_user.next_position_idx.to_le_bytes()
        ],
        bump
    )]
    pub taker_position: Account<'info, Position>,

    // Maker side
    #[account(
        mut,
        seeds = [USER_SEED, market.key().as_ref(), maker_user.owner.as_ref()],
        bump = maker_user.bump,
        has_one = market,
    )]
    pub maker_user: Account<'info, UserAccount>,

    #[account(
        init,
        payer = settler,
        space = Position::LEN,
        seeds = [
            POS_SEED,
            market.key().as_ref(),
            maker_user.owner.as_ref(),
            &maker_user.next_position_idx.to_le_bytes()
        ],
        bump
    )]
    pub maker_position: Account<'info, Position>,

    #[account(mut)]
    pub settler: Signer<'info>,
    pub system_program: Program<'info, System>,
}
