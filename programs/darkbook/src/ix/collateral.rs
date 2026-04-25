use crate::constants::{USER_SEED, VAULT_SEED};
use crate::errors::DarkbookError;
use crate::state::{CollateralVault, Market, UserAccount};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

/// Create a UserAccount PDA for the caller.
pub fn initialize_user(ctx: Context<InitializeUser>) -> Result<()> {
    let user_acct = &mut ctx.accounts.user_account;
    user_acct.owner = ctx.accounts.owner.key();
    user_acct.market = ctx.accounts.market.key();
    user_acct.deposited_amount = 0;
    user_acct.locked_amount = 0;
    user_acct.realized_pnl = 0;
    user_acct.next_position_idx = 0;
    user_acct.bump = ctx.bumps.user_account;
    Ok(())
}

/// Transfer USDC from user's token account into the vault.
pub fn deposit_collateral(ctx: Context<DepositCollateral>, amount: u64) -> Result<()> {
    require!(!ctx.accounts.market.paused, DarkbookError::MarketPaused);
    require!(amount > 0, DarkbookError::InsufficientCollateral);

    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.vault_token_account.to_account_info(),
            authority: ctx.accounts.owner.to_account_info(),
        },
    );
    token::transfer(cpi_ctx, amount)?;

    let user_acct = &mut ctx.accounts.user_account;
    user_acct.deposited_amount = user_acct
        .deposited_amount
        .checked_add(amount)
        .ok_or(DarkbookError::Overflow)?;

    msg!("Deposited {} lamports", amount);
    Ok(())
}

/// Withdraw unlocked collateral back to user's token account.
pub fn withdraw_collateral(ctx: Context<WithdrawCollateral>, amount: u64) -> Result<()> {
    require!(!ctx.accounts.market.paused, DarkbookError::MarketPaused);

    let user_acct = &mut ctx.accounts.user_account;
    let unlocked = user_acct.unlocked_amount();
    require!(amount <= unlocked, DarkbookError::WithdrawTooLarge);

    let market_key = ctx.accounts.market.key();
    let vault_bump = ctx.accounts.vault.bump;
    let seeds = &[VAULT_SEED, market_key.as_ref(), &[vault_bump]];
    let signer = &[&seeds[..]];

    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.vault_token_account.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        },
        signer,
    );
    token::transfer(cpi_ctx, amount)?;

    user_acct.deposited_amount = user_acct
        .deposited_amount
        .checked_sub(amount)
        .ok_or(DarkbookError::Overflow)?;

    msg!("Withdrew {} lamports", amount);
    Ok(())
}

// ─── Accounts ────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeUser<'info> {
    #[account(
        init,
        payer = owner,
        space = UserAccount::LEN,
        seeds = [USER_SEED, market.key().as_ref(), owner.key().as_ref()],
        bump
    )]
    pub user_account: Account<'info, UserAccount>,

    pub market: Account<'info, Market>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositCollateral<'info> {
    #[account(
        mut,
        seeds = [USER_SEED, market.key().as_ref(), owner.key().as_ref()],
        bump = user_account.bump,
        has_one = owner,
        has_one = market,
    )]
    pub user_account: Account<'info, UserAccount>,

    pub market: Account<'info, Market>,

    #[account(
        seeds = [VAULT_SEED, market.key().as_ref()],
        bump = vault.bump,
        constraint = vault.mint == mint.key(),
    )]
    pub vault: Account<'info, CollateralVault>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = vault,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,

    pub mint: Account<'info, Mint>,
}

#[derive(Accounts)]
pub struct WithdrawCollateral<'info> {
    #[account(
        mut,
        seeds = [USER_SEED, market.key().as_ref(), owner.key().as_ref()],
        bump = user_account.bump,
        has_one = owner,
        has_one = market,
    )]
    pub user_account: Account<'info, UserAccount>,

    pub market: Account<'info, Market>,

    #[account(
        seeds = [VAULT_SEED, market.key().as_ref()],
        bump = vault.bump,
        constraint = vault.mint == mint.key(),
    )]
    pub vault: Account<'info, CollateralVault>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = vault,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = owner,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub mint: Account<'info, Mint>,
}
