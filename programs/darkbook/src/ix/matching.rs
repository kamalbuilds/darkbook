use crate::constants::BOOK_SEED;
use crate::errors::DarkbookError;
use crate::events::FillRecorded;
use crate::matching_engine::match_step;
use crate::state::SizeBand;
use crate::state::{Market, OrderBook};
use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::commit;
use ephemeral_rollups_sdk::ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder};

/// Permissionless cranker — runs on the ER after delegation.
/// Matches up to FILLS_PER_MATCH bids against asks per call.
pub fn match_orders(ctx: Context<MatchOrders>) -> Result<()> {
    require!(!ctx.accounts.market.paused, DarkbookError::MarketPaused);
    let clock = Clock::get()?;
    let mut book = ctx.accounts.order_book.load_mut()?;
    require!(book.is_delegated == 1, DarkbookError::BookNotDelegated);
    let filled = match_step(&mut *book, clock.slot)?;

    if filled > 0 {
        book.last_match_slot = clock.slot;
        // Emit events for each fill produced in this batch
        let first_fill_id = book
            .next_fill_id
            .checked_sub(filled as u64)
            .ok_or(DarkbookError::Overflow)?;
        for id_offset in 0..filled as u64 {
            let target_fill_id = first_fill_id
                .checked_add(id_offset)
                .ok_or(DarkbookError::Overflow)?;
            let idx = book
                .find_fill(target_fill_id)
                .ok_or(DarkbookError::FillNotFound)?;
            let f = &book.fills[idx];
            let size_band = match f.size_band {
                0 => SizeBand::Small,
                1 => SizeBand::Medium,
                2 => SizeBand::Large,
                _ => SizeBand::Whale,
            };
            emit!(FillRecorded {
                fill_id: f.fill_id,
                taker_order_id: f.taker_order_id,
                maker_order_id: f.maker_order_id,
                taker: Pubkey::from(f.taker),
                maker: Pubkey::from(f.maker),
                price_ticks: f.price_ticks,
                size_band,
                slot: f.matched_slot,
            });
        }
        drop(book);
        // Serialize the account so the ER state is flushed before any commit
        ctx.accounts.order_book.exit(&crate::ID)?;
    }

    msg!("Matched {} fills", filled);
    Ok(())
}

/// Manual commit: push the current OrderBook state to mainnet.
pub fn commit_book(ctx: Context<CommitBook>) -> Result<()> {
    ctx.accounts.order_book.exit(&crate::ID)?;
    MagicIntentBundleBuilder::new(
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit(&[ctx.accounts.order_book.to_account_info()])
    .build_and_invoke()?;
    Ok(())
}

/// Commit + undelegate: return the OrderBook back to mainnet after matching session.
pub fn commit_and_undelegate_book(ctx: Context<CommitBook>) -> Result<()> {
    {
        let mut book = ctx.accounts.order_book.load_mut()?;
        book.is_delegated = 0;
    }
    ctx.accounts.order_book.exit(&crate::ID)?;
    MagicIntentBundleBuilder::new(
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&[ctx.accounts.order_book.to_account_info()])
    .build_and_invoke()?;
    Ok(())
}

// ─── Accounts ────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct MatchOrders<'info> {
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [BOOK_SEED, market.key().as_ref()],
        bump
    )]
    pub order_book: AccountLoader<'info, OrderBook>,
}

/// The `#[commit]` macro injects magic_context and magic_program accounts.
#[commit]
#[derive(Accounts)]
pub struct CommitBook<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [BOOK_SEED, market.key().as_ref()],
        bump
    )]
    pub order_book: AccountLoader<'info, OrderBook>,

    #[account(has_one = admin)]
    pub market: Account<'info, Market>,
    pub admin: Signer<'info>,
}

// Suppress dead_code warning for fill_count variable
#[allow(dead_code)]
const _: () = {
    let _x: usize = 0;
};
