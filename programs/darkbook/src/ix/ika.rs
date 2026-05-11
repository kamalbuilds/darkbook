//! Ika dWallet bridge for DarkBook.
//!
//! Integrates Ika's Solana pre-alpha dWallet program into DarkBook's
//! settlement flow via manual CPI (no Anchor SDK dependency).
//!
//! Flow:
//! 1. Trader creates a dWallet via Ika program
//! 2. Trader calls `register_dwallet` to transfer authority to DarkBook
//! 3. On `close_position`, optionally `approve_dwallet_withdrawal` for
//!    cross-chain payout via Ika 2PC-MPC signing
//!
//! Ref: https://solana-pre-alpha.ika.xyz/

use anchor_lang::prelude::*;

// ── Constants ──

const CPI_AUTHORITY_SEED: &[u8] = b"__ika_cpi_authority";
const DWALLET_CONFIG_SEED: &[u8] = b"ika-dwallet";
const MESSAGE_APPROVAL_SEED: &[u8] = b"ika-msg";
const IX_APPROVE_MESSAGE: u8 = 8;
const IX_TRANSFER_OWNERSHIP: u8 = 24;
const IKA_PROGRAM_ID: Pubkey = pubkey!("Fg6PaFpoGXkYsidMpWTxq8cQqU5cPqQkz6xcKozxZxHz");
const DARKBOOK_ID: Pubkey = pubkey!("3F99U2rZ2fob5NBgVTqQYqMq8whF4WUqiZXgeaYPE7yf");

// ── Instructions ──

pub fn register_dwallet(ctx: Context<RegisterDWallet>) -> Result<()> {
    ctx.accounts.config.dwallet = ctx.accounts.dwallet.key();
    ctx.accounts.config.owner = ctx.accounts.owner.key();
    ctx.accounts.config.market = ctx.accounts.market.key();

    // Transfer dWallet authority to DarkBook's CPI authority PDA.
    let cpi_auth_key = ctx.accounts.cpi_authority.key();
    let dwallet_key = ctx.accounts.dwallet.key();
    let darkbook_key = ctx.accounts.darkbook_program.key();

    let mut ix_data = Vec::with_capacity(33);
    ix_data.push(IX_TRANSFER_OWNERSHIP);
    ix_data.extend_from_slice(cpi_auth_key.as_ref());

    let accounts = vec![
        AccountMeta::new_readonly(cpi_auth_key, true),
        AccountMeta::new(dwallet_key, false),
        AccountMeta::new_readonly(darkbook_key, false),
    ];

    let ix = anchor_lang::solana_program::instruction::Instruction {
        program_id: IKA_PROGRAM_ID,
        accounts,
        data: ix_data,
    };

    let account_infos = vec![
        ctx.accounts.cpi_authority.to_account_info(),
        ctx.accounts.dwallet.to_account_info(),
        ctx.accounts.darkbook_program.to_account_info(),
        ctx.accounts.dwallet_program.to_account_info(),
    ];

    let seeds = &[CPI_AUTHORITY_SEED, &[ctx.bumps.cpi_authority]];
    anchor_lang::solana_program::program::invoke_signed(&ix, &account_infos, &[&seeds[..]])?;
    Ok(())
}

pub fn approve_dwallet_withdrawal(
    ctx: Context<ApproveDWalletWithdrawal>,
    message_digest: [u8; 32],
    user_pubkey: [u8; 32],
    signature_scheme: u16,
) -> Result<()> {
    let bump = ctx.bumps.message_approval;
    let msg_metadata = [0u8; 32];

    let mut ix_data = Vec::with_capacity(100);
    ix_data.push(IX_APPROVE_MESSAGE);
    ix_data.push(bump);
    ix_data.extend_from_slice(&message_digest);
    ix_data.extend_from_slice(&msg_metadata);
    ix_data.extend_from_slice(&user_pubkey);
    ix_data.extend_from_slice(&signature_scheme.to_le_bytes());

    let accounts = vec![
        AccountMeta::new_readonly(ctx.accounts.coordinator.key(), false),
        AccountMeta::new(ctx.accounts.message_approval.key(), false),
        AccountMeta::new_readonly(ctx.accounts.dwallet.key(), false),
        AccountMeta::new_readonly(ctx.accounts.darkbook_program.key(), false),
        AccountMeta::new_readonly(ctx.accounts.cpi_authority.key(), true),
        AccountMeta::new(ctx.accounts.payer.key(), true),
        AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
    ];

    let ix = anchor_lang::solana_program::instruction::Instruction {
        program_id: IKA_PROGRAM_ID,
        accounts,
        data: ix_data,
    };

    let account_infos = vec![
        ctx.accounts.coordinator.to_account_info(),
        ctx.accounts.message_approval.to_account_info(),
        ctx.accounts.dwallet.to_account_info(),
        ctx.accounts.darkbook_program.to_account_info(),
        ctx.accounts.cpi_authority.to_account_info(),
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.dwallet_program.to_account_info(),
    ];

    let seeds = &[CPI_AUTHORITY_SEED, &[ctx.bumps.cpi_authority]];
    anchor_lang::solana_program::program::invoke_signed(&ix, &account_infos, &[&seeds[..]])?;
    Ok(())
}

// ── Accounts ──

#[derive(Accounts)]
pub struct RegisterDWallet<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + DWalletConfig::INIT_SPACE,
        seeds = [DWALLET_CONFIG_SEED, market.key().as_ref(), owner.key().as_ref()],
        bump
    )]
    pub config: Account<'info, DWalletConfig>,

    /// CHECK: The dWallet account (owned by Ika dWallet program).
    pub dwallet: UncheckedAccount<'info>,

    pub market: Account<'info, crate::state::Market>,

    #[account(
        seeds = [crate::constants::USER_SEED, market.key().as_ref(), owner.key().as_ref()],
        bump
    )]
    pub user_account: Account<'info, crate::state::UserAccount>,

    pub owner: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,

    /// CHECK: The Ika dWallet program.
    #[account(address = IKA_PROGRAM_ID)]
    pub dwallet_program: UncheckedAccount<'info>,

    /// CHECK: DarkBook's CPI authority PDA.
    #[account(seeds = [CPI_AUTHORITY_SEED], bump)]
    pub cpi_authority: UncheckedAccount<'info>,

    /// CHECK: DarkBook program (executable).
    #[account(address = DARKBOOK_ID)]
    pub darkbook_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(message_digest: [u8; 32])]
pub struct ApproveDWalletWithdrawal<'info> {
    /// CHECK: dWallet linked to the position owner.
    pub dwallet: UncheckedAccount<'info>,

    /// CHECK: DWalletCoordinator PDA on the Ika program.
    pub coordinator: UncheckedAccount<'info>,

    /// CHECK: MessageApproval PDA (created by this instruction, owned by Ika program).
    #[account(
        init,
        payer = payer,
        space = 256,
        seeds = [MESSAGE_APPROVAL_SEED, dwallet.key().as_ref(), &message_digest],
        bump,
        owner = IKA_PROGRAM_ID,
    )]
    pub message_approval: UncheckedAccount<'info>,

    /// CHECK: The Ika dWallet program.
    #[account(address = IKA_PROGRAM_ID)]
    pub dwallet_program: UncheckedAccount<'info>,

    /// CHECK: DarkBook's CPI authority PDA.
    #[account(seeds = [CPI_AUTHORITY_SEED], bump)]
    pub cpi_authority: UncheckedAccount<'info>,

    /// CHECK: DarkBook program (executable).
    #[account(address = DARKBOOK_ID)]
    pub darkbook_program: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// ── State ──

#[account]
#[derive(InitSpace)]
pub struct DWalletConfig {
    pub dwallet: Pubkey,
    pub owner: Pubkey,
    pub market: Pubkey,
}
