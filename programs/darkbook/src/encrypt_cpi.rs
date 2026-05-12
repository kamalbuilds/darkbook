//! Encrypt FHE bridge for DarkBook.
//!
//! Manual CPI to Encrypt program (devnet: 4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8)
//! Avoids `encrypt-anchor` crate dependency (requires Anchor 1.0).
//! Encrypt gRPC: https://pre-alpha-dev-1.encrypt.ika-network.net:443
//!
//! Ref: https://docs.encrypt.xyz/

use anchor_lang::prelude::*;

/// Encrypt program ID (Solana devnet pre-alpha).
const ENCRYPT_PROGRAM_ID: Pubkey = pubkey!("4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8");

/// Encrypt instruction discriminators (must match Encrypt program).
const ENCRYPT_IX_EXECUTE_GRAPH: u8 = 0;
const ENCRYPT_IX_CREATE_INPUT: u8 = 1;
const ENCRYPT_IX_REQUEST_DECRYPTION: u8 = 2;

/// Request threshold decryption of a ciphertext via Encrypt CPI.
///
/// This wraps the Encrypt program's `request_decryption` instruction.
/// The Encrypt network decrypts the ciphertext using threshold FHE and
/// writes the plaintext to the output account.
///
/// Pre-alpha note: decryption returns mock plaintext. Real threshold
/// decryption will be available at mainnet.
pub fn request_encrypt_decryption<'info>(
    ciphertext: &AccountInfo<'info>,
    output: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    requestor: &Pubkey,
    bump: u8,
) -> Result<()> {
    let mut ix_data = Vec::with_capacity(34);
    ix_data.push(ENCRYPT_IX_REQUEST_DECRYPTION);
    ix_data.push(bump);
    ix_data.extend_from_slice(requestor.as_ref());

    let accounts = vec![
        AccountMeta::new(ciphertext.key(), false),
        AccountMeta::new(output.key(), false),
        AccountMeta::new_readonly(authority.key(), true),
        AccountMeta::new(payer.key(), true),
        AccountMeta::new_readonly(system_program.key(), false),
    ];

    let ix = anchor_lang::solana_program::instruction::Instruction {
        program_id: ENCRYPT_PROGRAM_ID,
        accounts,
        data: ix_data,
    };

    let account_infos = vec![
        ciphertext.clone(),
        output.clone(),
        authority.clone(),
        payer.clone(),
        system_program.clone(),
    ];

    let seed_bytes = b"encrypt-decrypt".as_ref();
    let bump_slice = &[bump];
    let seeds: &[&[u8]] = &[seed_bytes, bump_slice];
    anchor_lang::solana_program::program::invoke_signed(&ix, &account_infos, &[seeds])?;
    Ok(())
}

/// Execute an FHE computation graph via Encrypt CPI.
///
/// Submits a pre-built computation graph (serialized FHE operations)
/// and creates output ciphertext accounts.
pub fn execute_encrypt_graph<'info>(
    graph_account: &AccountInfo<'info>,
    inputs: &[AccountInfo<'info>],
    outputs: &[AccountInfo<'info>],
    authority: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
) -> Result<()> {
    let input_count = inputs.len() as u8;
    let output_count = outputs.len() as u8;

    // IX data: [discriminator, input_count, output_count, ...graph_data from account]
    // Minimal: just discriminator + counts for stub
    let mut ix_data = Vec::with_capacity(3);
    ix_data.push(ENCRYPT_IX_EXECUTE_GRAPH);
    ix_data.push(input_count);
    ix_data.push(output_count);

    let mut metas = vec![
        AccountMeta::new_readonly(graph_account.key(), false),
        AccountMeta::new_readonly(authority.key(), true),
        AccountMeta::new(payer.key(), true),
        AccountMeta::new_readonly(system_program.key(), false),
    ];
    for input in inputs {
        metas.push(AccountMeta::new_readonly(input.key(), false));
    }
    for output in outputs {
        metas.push(AccountMeta::new(output.key(), false));
    }

    let ix = anchor_lang::solana_program::instruction::Instruction {
        program_id: ENCRYPT_PROGRAM_ID,
        accounts: metas,
        data: ix_data,
    };

    let mut account_infos = vec![
        graph_account.clone(),
        authority.clone(),
        payer.clone(),
        system_program.clone(),
    ];
    for input in inputs { account_infos.push(input.clone()); }
    for output in outputs { account_infos.push(output.clone()); }

    anchor_lang::solana_program::program::invoke(&ix, &account_infos)?;
    Ok(())
}
