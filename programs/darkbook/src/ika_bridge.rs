//! Ika dWallet bridge — CPI implementation.
//! Account types and instruction dispatch are in `ix/ika.rs`.
//! Ref: https://solana-pre-alpha.ika.xyz/

use anchor_lang::prelude::*;

const CPI_AUTHORITY_SEED: &[u8] = b"__ika_cpi_authority";
const IKA_PROGRAM_ID: Pubkey = pubkey!("Fg6PaFpoGXkYsidMpWTxq8cQqU5cPqQkz6xcKozxZxHz");
const IX_APPROVE_MESSAGE: u8 = 8;
const IX_TRANSFER_OWNERSHIP: u8 = 24;

/// Transfer dWallet authority to DarkBook's CPI authority PDA.
pub fn register_dwallet<'info>(ctx: Context<'_, '_, 'info, 'info, super::ix::ika::RegisterDWallet<'info>>) -> Result<()> {
    ctx.accounts.config.dwallet = ctx.accounts.dwallet.key();
    ctx.accounts.config.owner = ctx.accounts.owner.key();
    ctx.accounts.config.market = ctx.accounts.market.key();

    let cpi_authority_key = ctx.accounts.cpi_authority.key();
    let dwallet_key = ctx.accounts.dwallet.key();
    let darkbook_key = ctx.accounts.darkbook_program.key();
    let ika_program_key = ctx.accounts.dwallet_program.key();

    let mut ix_data = Vec::with_capacity(33);
    ix_data.push(IX_TRANSFER_OWNERSHIP);
    ix_data.extend_from_slice(cpi_authority_key.as_ref());

    let metas = vec![
        AccountMeta::new_readonly(cpi_authority_key, true),
        AccountMeta::new(dwallet_key, false),
        AccountMeta::new_readonly(darkbook_key, false),
    ];

    let ix = anchor_lang::solana_program::instruction::Instruction {
        program_id: IKA_PROGRAM_ID,
        accounts: metas,
        data: ix_data,
    };

    let infos = vec![
        ctx.accounts.cpi_authority.to_account_info(),
        ctx.accounts.dwallet.to_account_info(),
        ctx.accounts.darkbook_program.to_account_info(),
        ctx.accounts.dwallet_program.to_account_info(),
    ];

    let seeds = &[CPI_AUTHORITY_SEED, &[ctx.bumps.cpi_authority]];
    anchor_lang::solana_program::program::invoke_signed(&ix, &infos, &[&seeds[..]])?;
    Ok(())
}

/// Approve a withdrawal message for Ika signing.
pub fn approve_dwallet_withdrawal<'info>(
    ctx: Context<'_, '_, 'info, 'info, super::ix::ika::ApproveDWalletWithdrawal<'info>>,
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

    let coordinator_key = ctx.accounts.coordinator.key();
    let msg_approval_key = ctx.accounts.message_approval.key();
    let dwallet_key = ctx.accounts.dwallet.key();
    let darkbook_key = ctx.accounts.darkbook_program.key();
    let cpi_auth_key = ctx.accounts.cpi_authority.key();
    let payer_key = ctx.accounts.payer.key();
    let system_prog_key = ctx.accounts.system_program.key();

    let metas = vec![
        AccountMeta::new_readonly(coordinator_key, false),
        AccountMeta::new(msg_approval_key, false),
        AccountMeta::new_readonly(dwallet_key, false),
        AccountMeta::new_readonly(darkbook_key, false),
        AccountMeta::new_readonly(cpi_auth_key, true),
        AccountMeta::new(payer_key, true),
        AccountMeta::new_readonly(system_prog_key, false),
    ];

    let ix = anchor_lang::solana_program::instruction::Instruction {
        program_id: IKA_PROGRAM_ID,
        accounts: metas,
        data: ix_data,
    };

    let infos = vec![
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
    anchor_lang::solana_program::program::invoke_signed(&ix, &infos, &[&seeds[..]])?;
    Ok(())
}
