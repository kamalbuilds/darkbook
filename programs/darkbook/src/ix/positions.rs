use crate::constants::{
    LIQUIDATION_BOUNTY_BPS, LIQUIDATION_THRESHOLD_BPS, MAX_ORACLE_AGE_SECS, POS_SEED,
    USDC_DECIMALS, USER_SEED, VAULT_SEED,
};
use crate::errors::DarkbookError;
use crate::events::{PositionClosed, PositionLiquidated};
use crate::ix::funding::accrue_funding_internal;
use crate::pyth::read_pyth_price;
use crate::state::{CollateralVault, Market, Position, PositionStatus, Side, UserAccount};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

/// Read-only mark price fetch — logs unrealized PnL. No state change.
pub fn mark_position(ctx: Context<MarkPosition>) -> Result<()> {
    let clock = Clock::get()?;
    let price_ticks = get_oracle_price(
        &ctx.accounts.price_update,
        &ctx.accounts.market,
        clock.unix_timestamp,
    )?;
    let pos = &ctx.accounts.position;
    require!(
        pos.status == PositionStatus::Open,
        DarkbookError::PositionNotOpen
    );

    let pnl = compute_pnl(pos, price_ticks)?;
    msg!(
        "Position {} mark={} ticks pnl={}",
        ctx.accounts.position.key(),
        price_ticks,
        pnl
    );
    Ok(())
}

/// Permissionless: accrues pending funding to a position.
pub fn accrue_funding(ctx: Context<AccrueFunding>) -> Result<()> {
    require!(
        ctx.accounts.position.status == PositionStatus::Open,
        DarkbookError::PositionNotOpen
    );

    let funding_delta = accrue_funding_internal(&ctx.accounts.position, &ctx.accounts.market)?;

    apply_funding_delta(
        &mut ctx.accounts.market,
        &mut ctx.accounts.user_account,
        &mut ctx.accounts.position,
        funding_delta,
    )?;

    let market = &ctx.accounts.market;
    let pos = &mut ctx.accounts.position;
    pos.last_funding_index = match pos.side {
        Side::Long => market.cum_funding_long,
        Side::Short => market.cum_funding_short,
    };

    let clock = Clock::get()?;
    let rate = match pos.side {
        Side::Long => market.cum_funding_long,
        Side::Short => market.cum_funding_short,
    };
    emit!(crate::events::FundingPaid {
        market: ctx.accounts.market.key(),
        position: ctx.accounts.position.key(),
        owner: ctx.accounts.position.owner,
        amount: funding_delta,
        funding_rate_bps: rate,
        slot: clock.slot,
    });

    Ok(())
}

/// Liquidate a position whose collateral ratio < LIQUIDATION_THRESHOLD_BPS.
/// Liquidator earns 5% of remaining collateral.
pub fn liquidate_position(ctx: Context<LiquidatePosition>) -> Result<()> {
    require!(!ctx.accounts.market.paused, DarkbookError::MarketPaused);
    require!(
        ctx.accounts.position.status == PositionStatus::Open,
        DarkbookError::PositionNotOpen
    );
    // Self-liquidation forbidden — denies trader from sweeping their own bounty.
    require_keys_neq!(
        ctx.accounts.liquidator.key(),
        ctx.accounts.position.owner,
        DarkbookError::SelfLiquidation
    );
    // Zero-collateral position has no exposure → not liquidatable.
    require!(
        ctx.accounts.position.collateral_locked > 0,
        DarkbookError::PositionNotOpen
    );

    let funding_delta = accrue_funding_internal(&ctx.accounts.position, &ctx.accounts.market)?;
    apply_funding_delta(
        &mut ctx.accounts.market,
        &mut ctx.accounts.user_account,
        &mut ctx.accounts.position,
        funding_delta,
    )?;
    ctx.accounts.position.last_funding_index = match ctx.accounts.position.side {
        Side::Long => ctx.accounts.market.cum_funding_long,
        Side::Short => ctx.accounts.market.cum_funding_short,
    };

    let clock = Clock::get()?;
    let mark_price = get_oracle_price(
        &ctx.accounts.price_update,
        &ctx.accounts.market,
        clock.unix_timestamp,
    )?;
    let pnl = compute_pnl(&ctx.accounts.position, mark_price)?;

    let remaining_collateral = collateral_after_pnl(ctx.accounts.position.collateral_locked, pnl)?;

    // ratio_bps = (remaining / collateral_locked) * 10000
    let ratio_bps = if ctx.accounts.position.collateral_locked == 0 {
        0u64
    } else {
        remaining_collateral
            .checked_mul(10_000)
            .ok_or(DarkbookError::Overflow)?
            .checked_div(ctx.accounts.position.collateral_locked)
            .ok_or(DarkbookError::Overflow)?
    };

    require!(
        ratio_bps < LIQUIDATION_THRESHOLD_BPS as u64,
        DarkbookError::NotLiquidatable
    );

    let bounty = remaining_collateral
        .checked_mul(LIQUIDATION_BOUNTY_BPS as u64)
        .ok_or(DarkbookError::Overflow)?
        .checked_div(10_000)
        .ok_or(DarkbookError::Overflow)?;

    if bounty > 0 {
        let market_key = ctx.accounts.market.key();
        let vault_bump = ctx.accounts.vault.bump;
        let seeds = &[VAULT_SEED, market_key.as_ref(), &[vault_bump]];
        let signer = &[&seeds[..]];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.liquidator_token_account.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer,
        );
        token::transfer(cpi_ctx, bounty)?;
    }

    {
        let market = &mut ctx.accounts.market;
        match ctx.accounts.position.side {
            Side::Long => {
                market.total_long_size = market
                    .total_long_size
                    .checked_sub(ctx.accounts.position.size_lots)
                    .ok_or(DarkbookError::Overflow)?;
            }
            Side::Short => {
                market.total_short_size = market
                    .total_short_size
                    .checked_sub(ctx.accounts.position.size_lots)
                    .ok_or(DarkbookError::Overflow)?;
            }
        }
    }

    let pos_collateral = ctx.accounts.position.collateral_locked;
    let user = &mut ctx.accounts.user_account;
    user.locked_amount = user
        .locked_amount
        .checked_sub(pos_collateral)
        .ok_or(DarkbookError::Overflow)?;
    let realized_loss = realized_loss_from_pnl(pos_collateral, pnl)?;
    ctx.accounts.market.realized_loss_pool = ctx
        .accounts
        .market
        .realized_loss_pool
        .checked_add(realized_loss)
        .ok_or(DarkbookError::Overflow)?;
    // Cap refund at locked so net_loss can never exceed locked collateral.
    let collateral_after_bounty = remaining_collateral
        .saturating_sub(bounty)
        .min(pos_collateral);
    let net_loss = pos_collateral
        .checked_sub(collateral_after_bounty)
        .ok_or(DarkbookError::Overflow)?;
    user.deposited_amount = user
        .deposited_amount
        .checked_sub(net_loss)
        .ok_or(DarkbookError::Overflow)?;
    user.realized_pnl = user
        .realized_pnl
        .checked_add(pnl)
        .ok_or(DarkbookError::Overflow)?
        .checked_sub(i64::try_from(bounty).map_err(|_| DarkbookError::Overflow)?)
        .ok_or(DarkbookError::Overflow)?;

    let pos = &mut ctx.accounts.position;
    pos.status = PositionStatus::Liquidated;
    pos.collateral_locked = 0;

    emit!(PositionLiquidated {
        position: pos.key(),
        owner: pos.owner,
        market: ctx.accounts.market.key(),
        liquidator: ctx.accounts.liquidator.key(),
        mark_price_ticks: mark_price,
        pnl,
        bounty,
        slot: clock.slot,
    });

    Ok(())
}

/// Trader-initiated close at mark price. Settles PnL.
pub fn close_position(ctx: Context<ClosePosition>) -> Result<()> {
    require!(!ctx.accounts.market.paused, DarkbookError::MarketPaused);
    let pos = &ctx.accounts.position;
    require!(
        pos.status == PositionStatus::Open,
        DarkbookError::PositionNotOpen
    );
    require!(
        pos.owner == ctx.accounts.owner.key(),
        DarkbookError::Unauthorized
    );

    let clock = Clock::get()?;
    let mark_price = get_oracle_price(
        &ctx.accounts.price_update,
        &ctx.accounts.market,
        clock.unix_timestamp,
    )?;
    let pnl = compute_pnl(pos, mark_price)?;

    {
        let market = &mut ctx.accounts.market;
        match ctx.accounts.position.side {
            Side::Long => {
                market.total_long_size = market
                    .total_long_size
                    .checked_sub(ctx.accounts.position.size_lots)
                    .ok_or(DarkbookError::Overflow)?;
            }
            Side::Short => {
                market.total_short_size = market
                    .total_short_size
                    .checked_sub(ctx.accounts.position.size_lots)
                    .ok_or(DarkbookError::Overflow)?;
            }
        }
    }

    let pos_collateral = ctx.accounts.position.collateral_locked;
    let user = &mut ctx.accounts.user_account;
    user.locked_amount = user
        .locked_amount
        .checked_sub(pos_collateral)
        .ok_or(DarkbookError::Overflow)?;
    if pnl >= 0 {
        let profit = pnl as u64;
        require!(
            ctx.accounts.market.realized_loss_pool >= profit,
            DarkbookError::InsufficientCollateral
        );
        ctx.accounts.market.realized_loss_pool = ctx
            .accounts
            .market
            .realized_loss_pool
            .checked_sub(profit)
            .ok_or(DarkbookError::Overflow)?;
        user.deposited_amount = user
            .deposited_amount
            .checked_add(profit)
            .ok_or(DarkbookError::Overflow)?;
    } else {
        let loss = (-pnl) as u64;
        user.deposited_amount = user
            .deposited_amount
            .checked_sub(loss)
            .ok_or(DarkbookError::Overflow)?;
        ctx.accounts.market.realized_loss_pool = ctx
            .accounts
            .market
            .realized_loss_pool
            .checked_add(loss)
            .ok_or(DarkbookError::Overflow)?;
    }
    user.realized_pnl = user
        .realized_pnl
        .checked_add(pnl)
        .ok_or(DarkbookError::Overflow)?;

    let pos = &mut ctx.accounts.position;
    pos.status = PositionStatus::Closed;
    pos.collateral_locked = 0;

    emit!(PositionClosed {
        position: pos.key(),
        owner: pos.owner,
        market: ctx.accounts.market.key(),
        exit_price_ticks: mark_price,
        pnl,
        status: PositionStatus::Closed,
        slot: clock.slot,
    });

    Ok(())
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Fetch Pyth oracle price and convert to price_ticks (USDC micro-units per lot).
pub fn get_oracle_price(
    price_account: &AccountInfo,
    market: &Account<Market>,
    clock_unix_timestamp: i64,
) -> Result<u64> {
    let data = read_pyth_price(
        price_account,
        &market.oracle_feed_id,
        MAX_ORACLE_AGE_SECS,
        clock_unix_timestamp,
    )?;

    // Convert Pyth price to USDC micro-units (6 decimals).
    // Pyth price: price.price * 10^(price.exponent)  (in USD)
    // We want: ticks = price_usd * 10^USDC_DECIMALS
    // So: ticks = price.price * 10^(USDC_DECIMALS + exponent)
    let exp = data.exponent; // typically -8 for USD feeds
    let price_ticks = if exp >= 0 {
        let shift = (USDC_DECIMALS as i32 + exp) as u32;
        (data.price as u64).saturating_mul(10u64.pow(shift))
    } else {
        let neg_exp = (-exp) as u32;
        if USDC_DECIMALS >= neg_exp {
            (data.price as u64).saturating_mul(10u64.pow(USDC_DECIMALS - neg_exp))
        } else {
            let divisor = 10u64.pow(neg_exp - USDC_DECIMALS);
            (data.price as u64).checked_div(divisor).unwrap_or(0)
        }
    };

    Ok(price_ticks)
}

/// Compute unrealized PnL for a position at given mark price (signed, USDC micro-units).
pub fn compute_pnl(pos: &Position, mark_price_ticks: u64) -> Result<i64> {
    let entry = i64::try_from(pos.entry_price_ticks).map_err(|_| DarkbookError::Overflow)?;
    let mark = i64::try_from(mark_price_ticks).map_err(|_| DarkbookError::Overflow)?;
    let size = i64::try_from(pos.size_lots).map_err(|_| DarkbookError::Overflow)?;

    let pnl = match pos.side {
        Side::Long => mark
            .checked_sub(entry)
            .ok_or(DarkbookError::Overflow)?
            .checked_mul(size)
            .ok_or(DarkbookError::Overflow)?,
        Side::Short => entry
            .checked_sub(mark)
            .ok_or(DarkbookError::Overflow)?
            .checked_mul(size)
            .ok_or(DarkbookError::Overflow)?,
    };
    Ok(pnl)
}

fn apply_funding_delta(
    market: &mut Market,
    user: &mut UserAccount,
    position: &mut Position,
    funding_delta: i64,
) -> Result<()> {
    if funding_delta > 0 {
        let debit = u64::try_from(funding_delta).map_err(|_| DarkbookError::Overflow)?;
        position.collateral_locked = position
            .collateral_locked
            .checked_sub(debit)
            .ok_or(DarkbookError::Overflow)?;
        user.locked_amount = user
            .locked_amount
            .checked_sub(debit)
            .ok_or(DarkbookError::Overflow)?;
        user.deposited_amount = user
            .deposited_amount
            .checked_sub(debit)
            .ok_or(DarkbookError::Overflow)?;
        market.realized_loss_pool = market
            .realized_loss_pool
            .checked_add(debit)
            .ok_or(DarkbookError::Overflow)?;
    } else if funding_delta < 0 {
        let credit = u64::try_from(funding_delta.checked_neg().ok_or(DarkbookError::Overflow)?)
            .map_err(|_| DarkbookError::Overflow)?;
        require!(
            market.realized_loss_pool >= credit,
            DarkbookError::InsufficientCollateral
        );
        market.realized_loss_pool = market
            .realized_loss_pool
            .checked_sub(credit)
            .ok_or(DarkbookError::Overflow)?;
        position.collateral_locked = position
            .collateral_locked
            .checked_add(credit)
            .ok_or(DarkbookError::Overflow)?;
        user.locked_amount = user
            .locked_amount
            .checked_add(credit)
            .ok_or(DarkbookError::Overflow)?;
        user.deposited_amount = user
            .deposited_amount
            .checked_add(credit)
            .ok_or(DarkbookError::Overflow)?;
    }

    Ok(())
}

fn collateral_after_pnl(collateral_locked: u64, pnl: i64) -> Result<u64> {
    if pnl >= 0 {
        collateral_locked
            .checked_add(u64::try_from(pnl).map_err(|_| DarkbookError::Overflow)?)
            .ok_or(DarkbookError::Overflow.into())
    } else {
        let loss = u64::try_from(pnl.checked_neg().ok_or(DarkbookError::Overflow)?)
            .map_err(|_| DarkbookError::Overflow)?;
        if loss >= collateral_locked {
            Ok(0)
        } else {
            collateral_locked
                .checked_sub(loss)
                .ok_or(DarkbookError::Overflow.into())
        }
    }
}

fn realized_loss_from_pnl(collateral_locked: u64, pnl: i64) -> Result<u64> {
    if pnl >= 0 {
        Ok(0)
    } else {
        let loss = u64::try_from(pnl.checked_neg().ok_or(DarkbookError::Overflow)?)
            .map_err(|_| DarkbookError::Overflow)?;
        Ok(loss.min(collateral_locked))
    }
}

// ─── Accounts ────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct MarkPosition<'info> {
    pub market: Account<'info, Market>,
    pub position: Account<'info, Position>,
    /// CHECK: Pyth PriceUpdateV2 account — discriminator and feed_id verified in handler
    pub price_update: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct AccrueFunding<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,

    #[account(mut, has_one = market)]
    pub position: Account<'info, Position>,

    #[account(
        mut,
        seeds = [USER_SEED, market.key().as_ref(), position.owner.as_ref()],
        bump = user_account.bump,
        has_one = market,
    )]
    pub user_account: Account<'info, UserAccount>,
}

#[derive(Accounts)]
pub struct LiquidatePosition<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [POS_SEED, market.key().as_ref(), position.owner.as_ref(), &position.position_idx.to_le_bytes()],
        bump = position.bump,
        has_one = market,
    )]
    pub position: Account<'info, Position>,

    #[account(
        mut,
        seeds = [USER_SEED, market.key().as_ref(), position.owner.as_ref()],
        bump = user_account.bump,
        has_one = market,
    )]
    pub user_account: Account<'info, UserAccount>,

    /// CHECK: Pyth PriceUpdateV2 account — verified in handler
    pub price_update: AccountInfo<'info>,

    #[account(
        seeds = [VAULT_SEED, market.key().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, CollateralVault>,

    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub liquidator_token_account: Account<'info, TokenAccount>,

    pub liquidator: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClosePosition<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [POS_SEED, market.key().as_ref(), position.owner.as_ref(), &position.position_idx.to_le_bytes()],
        bump = position.bump,
        has_one = market,
    )]
    pub position: Account<'info, Position>,

    #[account(
        mut,
        seeds = [USER_SEED, market.key().as_ref(), owner.key().as_ref()],
        bump = user_account.bump,
        has_one = owner,
        has_one = market,
    )]
    pub user_account: Account<'info, UserAccount>,

    /// CHECK: Pyth PriceUpdateV2 account — verified in handler
    pub price_update: AccountInfo<'info>,

    pub owner: Signer<'info>,
}
