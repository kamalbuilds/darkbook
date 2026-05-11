use anchor_lang::prelude::*;

#[error_code]
pub enum DarkbookError {
    #[msg("Leverage exceeds market maximum")]
    InvalidLeverage,
    #[msg("Insufficient unlocked collateral")]
    InsufficientCollateral,
    #[msg("Order not found in book")]
    OrderNotFound,
    #[msg("Commitment hash does not match revealed plaintext")]
    CommitmentMismatch,
    #[msg("Oracle price is stale")]
    OracleStale,
    #[msg("OrderBook is not delegated to ephemeral rollup")]
    BookNotDelegated,
    #[msg("Position does not meet liquidation threshold")]
    NotLiquidatable,
    #[msg("Market is paused")]
    MarketPaused,
    #[msg("Fill not found or already claimed")]
    FillNotFound,
    #[msg("Invalid side for this operation")]
    InvalidSide,
    #[msg("Fill queue is full")]
    FillQueueFull,
    #[msg("Funding interval not elapsed")]
    FundingIntervalNotElapsed,
    #[msg("Position is not open")]
    PositionNotOpen,
    #[msg("Unauthorized: caller is not the position owner")]
    Unauthorized,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Price ticks cannot be zero")]
    InvalidPrice,
    #[msg("Withdraw amount exceeds unlocked balance")]
    WithdrawTooLarge,
    #[msg("Self-match: trader cannot match own orders")]
    SelfMatch,
    #[msg("Liquidator cannot equal position owner")]
    SelfLiquidation,
    #[msg("Oracle price is non-positive")]
    InvalidOraclePrice,
    #[msg("Oracle publish_time is in the future")]
    OracleFuture,
    #[msg("OrderBook already delegated to ER")]
    AlreadyDelegated,
    #[msg("Counterparty profit pool is empty")]
    InsufficientPool,
    #[msg("Order book PDA is already initialized")]
    OrderBookAccountNotEmpty,
    #[msg("Order book data is not full size yet")]
    OrderBookInitIncomplete,
    #[msg("Order book already finalized")]
    OrderBookAlreadyFinalized,
}
