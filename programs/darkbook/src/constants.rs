pub const MARKET_SEED: &[u8] = b"market";
pub const VAULT_SEED: &[u8] = b"vault";
pub const USER_SEED: &[u8] = b"user";
pub const BOOK_SEED: &[u8] = b"book";
pub const POS_SEED: &[u8] = b"pos";

pub const USDC_DECIMALS: u32 = 6;
/// 200x max leverage (20000 bps = 200x)
pub const MAX_LEVERAGE_BPS: u16 = 20_000;
/// Position is liquidatable when collateral_ratio < 1.2 (12000 bps out of 10000)
pub const LIQUIDATION_THRESHOLD_BPS: u32 = 12_000;
/// Liquidator reward: 5% of remaining collateral
pub const LIQUIDATION_BOUNTY_BPS: u32 = 500;
/// Max fills stored in OrderBook at once
pub const FILL_QUEUE_CAP: usize = 256;
/// Max fills produced per match_orders call (CU budget)
pub const FILLS_PER_MATCH: usize = 32;
/// Max funding rate per interval in bps (20% per interval max)
pub const MAX_FUNDING_BPS_PER_INTERVAL: i64 = 2_000;

/// Oracle price must be no older than 60 seconds
pub const MAX_ORACLE_AGE_SECS: u64 = 60;

/// Approximate lot sizes for each size band ceiling (in lots).
/// Whale band capped at 1M lots so size × price × 100 stays well below u64::MAX
/// for any realistic price (max u64 ≈ 1.8e19; 1e6 lots × 1e10 ticks × 100 = 1e18).
pub const SMALL_BAND_MAX_LOTS: u64 = 10;
pub const MEDIUM_BAND_MAX_LOTS: u64 = 100;
pub const LARGE_BAND_MAX_LOTS: u64 = 1_000;
pub const WHALE_BAND_MAX_LOTS: u64 = 1_000_000;

/// Price ticks per lot for collateral estimation (conservative upper bound per band)
/// Actual revealed at settlement.
pub const COLLATERAL_ESTIMATE_SMALL: u64 = 10;
pub const COLLATERAL_ESTIMATE_MEDIUM: u64 = 100;
pub const COLLATERAL_ESTIMATE_LARGE: u64 = 1_000;
pub const COLLATERAL_ESTIMATE_WHALE: u64 = 10_000;
