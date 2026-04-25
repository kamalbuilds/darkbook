/// Minimal Pyth Receiver PriceUpdateV2 deserialization.
///
/// Supports both Pyth pull oracle and Pyth Lazer sub-ms feeds.
/// Both write PriceUpdateV2 account format on-chain via their respective Solana receivers.
///
/// Avoids importing pyth-solana-receiver-sdk which conflicts with anchor 0.32
/// due to its transitive dependency on anchor-lang 1.x + block-buffer 0.12
/// (requires Rust edition2024, not available in Solana platform-tools 1.48).
///
/// Layout source: https://github.com/pyth-network/pyth-crosschain/blob/main/target_chains/solana/sdk/js/pyth_solana_receiver/src/pythSolanaReceiver.ts
/// and pyth-solana-receiver-sdk/src/price_update.rs (commit pinned to 0.6.1 tag).
///
/// PriceUpdateV2 layout (after 8-byte Anchor discriminator):
///   write_authority: Pubkey    (32 bytes)
///   verification_level: u8    (1 byte, 0=partial, 1=full)
///   price_message: PriceFeedMessage
///     feed_id: [u8; 32]
///     price: i64
///     conf: u64
///     exponent: i32
///     publish_time: i64       (unix seconds)
///     prev_publish_time: i64
///     ema_price: i64
///     ema_conf: u64
///   posted_slot: u64          (8 bytes)
///
/// Pyth Lazer Info:
/// - Docs: https://docs.pyth.network/lazer/getting-started
/// - Feeds update every ~200ms with sub-millisecond latency
/// - Prices are signed by Pyth oracle committee
/// - Solana receiver writes PriceUpdateV2 format (same as pull oracle)
use anchor_lang::prelude::*;

/// 8-byte Anchor discriminator for PriceUpdateV2 account.
/// sha256("account:PriceUpdateV2")[..8]
pub const PRICE_UPDATE_V2_DISCRIMINATOR: [u8; 8] = [196, 23, 216, 5, 242, 233, 122, 184];

pub struct PriceData {
    pub feed_id: [u8; 32],
    pub price: i64,
    pub conf: u64,
    pub exponent: i32,
    pub publish_time: i64,
}

/// Parse a Pyth PriceUpdateV2 account and extract price data.
/// Returns error if discriminator mismatch, feed_id mismatch, or price is stale.
pub fn read_pyth_price(
    account_info: &AccountInfo,
    expected_feed_id: &[u8; 32],
    max_age_secs: u64,
    clock_unix_timestamp: i64,
) -> Result<PriceData> {
    let data = account_info.try_borrow_data()?;
    require!(
        data.len() >= 8 + 32 + 1 + 32 + 8 + 8 + 4 + 8 + 8 + 8 + 8,
        crate::errors::DarkbookError::OracleStale
    );

    // Verify discriminator
    require!(
        &data[0..8] == PRICE_UPDATE_V2_DISCRIMINATOR,
        crate::errors::DarkbookError::OracleStale
    );

    let mut offset = 8usize;

    // skip write_authority (32 bytes)
    offset += 32;
    // skip verification_level (1 byte)
    offset += 1;

    // PriceFeedMessage
    let feed_id: [u8; 32] = data[offset..offset + 32].try_into().unwrap();
    require!(
        &feed_id == expected_feed_id,
        crate::errors::DarkbookError::OracleStale
    );
    offset += 32;

    let price = i64::from_le_bytes(data[offset..offset + 8].try_into().unwrap());
    offset += 8;
    let conf = u64::from_le_bytes(data[offset..offset + 8].try_into().unwrap());
    offset += 8;
    let exponent = i32::from_le_bytes(data[offset..offset + 4].try_into().unwrap());
    offset += 4;
    let publish_time = i64::from_le_bytes(data[offset..offset + 8].try_into().unwrap());
    offset += 8;

    // Reject prices published in the future (>5s clock skew tolerance).
    require!(
        publish_time <= clock_unix_timestamp.saturating_add(5),
        crate::errors::DarkbookError::OracleFuture
    );
    let age = clock_unix_timestamp.saturating_sub(publish_time).max(0) as u64;
    require!(
        age <= max_age_secs,
        crate::errors::DarkbookError::OracleStale
    );

    // Price must be positive — prevents `as u64` cast turning negatives into u64::MAX.
    require!(price > 0, crate::errors::DarkbookError::InvalidOraclePrice);
    // Exponent clamp prevents wild scaling that breaks PnL math.
    require!(
        exponent >= -20 && exponent <= 20,
        crate::errors::DarkbookError::InvalidOraclePrice
    );

    Ok(PriceData {
        feed_id,
        price,
        conf,
        exponent,
        publish_time,
    })
}

/// Parse a Pyth Lazer PriceUpdateV2 account (same format as pull oracle).
/// Pyth Lazer relayer writes to the same PriceUpdateV2 account format,
/// so this is identical to read_pyth_price from an on-chain perspective.
/// The difference is off-chain: Lazer updates via sub-ms WebSocket, not REST polling.
///
/// Usage:
/// ```ignore
/// let lazer_price = read_pyth_lazer_price(
///     &price_update_account,
///     &expected_feed_id,
///     max_age_secs,
///     clock.unix_timestamp,
/// )?;
/// ```
pub fn read_pyth_lazer_price(
    account_info: &AccountInfo,
    expected_feed_id: &[u8; 32],
    max_age_secs: u64,
    clock_unix_timestamp: i64,
) -> Result<PriceData> {
    // Lazer prices use the same PriceUpdateV2 format as pull oracle.
    // The Lazer relayer writes to Pyth receiver program, which emits the same account format.
    read_pyth_price(account_info, expected_feed_id, max_age_secs, clock_unix_timestamp)
}
