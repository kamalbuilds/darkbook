use crate::constants::MAX_FUNDING_BPS_PER_INTERVAL;
use crate::errors::DarkbookError;
use crate::ix::positions::get_oracle_price;
use crate::state::{Market, Position, Side};
use anchor_lang::prelude::*;

/// Update cumulative funding indexes based on open interest imbalance.
///
/// funding_rate_bps = ((long_size - short_size) / total_size) * MAX_FUNDING_BPS_PER_INTERVAL
/// Positive: longs pay shorts. Negative: shorts pay longs.
pub fn update_funding(ctx: Context<UpdateFunding>) -> Result<()> {
    let clock = Clock::get()?;

    let (scaled_rate_bps, cum_funding_long, cum_funding_short) = {
        let market = &mut ctx.accounts.market;
        let elapsed = clock
            .unix_timestamp
            .checked_sub(market.last_funding_ts)
            .ok_or(DarkbookError::Overflow)?;
        require!(
            elapsed >= market.funding_interval_secs,
            DarkbookError::FundingIntervalNotElapsed
        );
        require!(
            market.funding_interval_secs > 0,
            DarkbookError::FundingIntervalNotElapsed
        );
        let intervals = elapsed
            .checked_div(market.funding_interval_secs)
            .ok_or(DarkbookError::Overflow)?;
        require!(intervals > 0, DarkbookError::FundingIntervalNotElapsed);

        let long_size = market.total_long_size as i64;
        let short_size = market.total_short_size as i64;
        let total_size = long_size
            .checked_add(short_size)
            .ok_or(DarkbookError::Overflow)?;

        let funding_rate_bps = if total_size == 0 {
            0i64
        } else {
            let raw = long_size
                .checked_sub(short_size)
                .ok_or(DarkbookError::Overflow)?
                .checked_mul(MAX_FUNDING_BPS_PER_INTERVAL)
                .ok_or(DarkbookError::Overflow)?
                .checked_div(total_size)
                .ok_or(DarkbookError::Overflow)?;
            raw.clamp(-MAX_FUNDING_BPS_PER_INTERVAL, MAX_FUNDING_BPS_PER_INTERVAL)
        };
        let scaled_rate_bps = funding_rate_bps
            .checked_mul(intervals)
            .ok_or(DarkbookError::Overflow)?;

        // Longs pay when funding_rate > 0
        market.cum_funding_long = market
            .cum_funding_long
            .checked_add(scaled_rate_bps)
            .ok_or(DarkbookError::Overflow)?;
        // Shorts receive when funding_rate > 0
        market.cum_funding_short = market
            .cum_funding_short
            .checked_sub(scaled_rate_bps)
            .ok_or(DarkbookError::Overflow)?;
        market.last_funding_ts = market
            .last_funding_ts
            .checked_add(
                intervals
                    .checked_mul(market.funding_interval_secs)
                    .ok_or(DarkbookError::Overflow)?,
            )
            .ok_or(DarkbookError::Overflow)?;
        (
            scaled_rate_bps,
            market.cum_funding_long,
            market.cum_funding_short,
        )
    };

    // Fetch oracle price for rate anchoring. Propagate the error — silently
    // returning 0 distorts every downstream PnL calc using the funding index.
    let _price = get_oracle_price(
        &ctx.accounts.price_update,
        &ctx.accounts.market,
        clock.unix_timestamp,
    )?;

    msg!(
        "Funding updated: rate={} bps cum_long={} cum_short={}",
        scaled_rate_bps,
        cum_funding_long,
        cum_funding_short
    );

    Ok(())
}

/// Compute pending funding payment for a position (signed USDC micro-units).
/// Positive = position owes to market (debit). Negative = position earns (credit).
///
/// Uses i128 intermediate to prevent i64 overflow for large positions × long-lived
/// cumulative funding indexes (notional up to ~1e15, cum_delta up to ~1e6 bps,
/// product would overflow i64 ~9.2e18 over years of accrual).
pub fn accrue_funding_internal(position: &Position, market: &Market) -> Result<i64> {
    let notional_u64 = position
        .size_lots
        .checked_mul(position.entry_price_ticks)
        .ok_or(DarkbookError::Overflow)?;
    let notional = notional_u64 as i128;

    let cum_market = match position.side {
        Side::Long => market.cum_funding_long,
        Side::Short => market.cum_funding_short,
    };
    let cum_delta = (cum_market as i128)
        .checked_sub(position.last_funding_index as i128)
        .ok_or(DarkbookError::Overflow)?;

    let product = cum_delta
        .checked_mul(notional)
        .ok_or(DarkbookError::Overflow)?;
    let scaled = product
        .checked_div(10_000)
        .ok_or(DarkbookError::Overflow)?;

    let funding_delta = i64::try_from(scaled).map_err(|_| DarkbookError::Overflow)?;
    Ok(funding_delta)
}

// ─── Accounts ────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct UpdateFunding<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    /// CHECK: Pyth PriceUpdateV2 account — verified in handler via read_pyth_price
    pub price_update: AccountInfo<'info>,
    pub clock: Sysvar<'info, Clock>,
}
