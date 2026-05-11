import type { PublicKey } from "@solana/web3.js";

export enum Side {
  Long = 0,
  Short = 1,
}

export enum SizeBand {
  Small = 0,
  Medium = 1,
  Large = 2,
  Whale = 3,
}

export enum PositionStatus {
  Open = 0,
  Liquidated = 1,
  Closed = 2,
}

/** Off-chain plaintext revealed at settlement. */
export interface OrderPayload {
  /** 32-byte random salt used in commitment. */
  salt: Uint8Array;
  /** Exact position size in lots (u64). */
  sizeLots: bigint;
  /** Leverage in BPS (100 = 1x, 1000 = 10x). */
  leverageBps: number;
}

/** On-chain Order as stored in the OrderBook PDA. */
export interface Order {
  orderId: bigint;
  trader: PublicKey;
  side: Side;
  /** Price in micro-USDC per lot. */
  priceTicks: bigint;
  sizeBand: SizeBand;
  leverageBps: number;
  /** sha256(salt || sizeLots_le8 || leverageBps_le2 || trader_bytes) */
  commitment: Uint8Array;
  placedSlot: bigint;
}

/** Fill record produced after matching; stored in OrderBook PDA. */
export interface Fill {
  fillId: bigint;
  takerOrderId: bigint;
  makerOrderId: bigint;
  taker: PublicKey;
  maker: PublicKey;
  priceTicks: bigint;
  sizeBand: SizeBand;
  matchedSlot: bigint;
  claimed: boolean;
}

/** On-chain Position account. */
export interface Position {
  owner: PublicKey;
  market: PublicKey;
  side: Side;
  sizeLots: bigint;
  entryPriceTicks: bigint;
  collateralLocked: bigint;
  openedTs: bigint;
  lastFundingIndex: bigint;
  status: PositionStatus;
  positionIdx: number;
}

/** On-chain Market account state. */
export interface MarketState {
  assetId: Uint8Array;
  oracleFeedId: Uint8Array;
  fundingIntervalSecs: bigint;
  maxLeverageBps: number;
  takerFeeBps: number;
  makerRebateBps: number;
  totalLongSize: bigint;
  totalShortSize: bigint;
  lastFundingTs: bigint;
  cumFundingLong: bigint;
  cumFundingShort: bigint;
  paused: boolean;
}

/** On-chain UserAccount state. */
export interface UserAccountState {
  owner: PublicKey;
  market: PublicKey;
  depositedAmount: bigint;
  lockedAmount: bigint;
  realizedPnl: bigint;
}

/** Snapshot of the order book returned by fetchOrderBook. */
export interface OrderBookSnapshot {
  bids: Order[];
  asks: Order[];
  fills: Fill[];
}

/** Result of markPosition — computed off-chain from oracle price. */
export interface MarkResult {
  unrealizedPnl: bigint;
  markPrice: bigint;
}

/** DarkbookClient constructor options. */
export interface DarkbookClientOptions {
  /** Solana mainnet/devnet connection for base-layer instructions. */
  connection: import("@solana/web3.js").Connection;
  /** MagicBlock ER connection for match_orders / commit instructions. */
  erConnection: import("@solana/web3.js").Connection;
  /** Signing wallet (must implement Wallet from @coral-xyz/anchor). */
  wallet: import("@coral-xyz/anchor").Wallet;
  /** The darkbook program ID. */
  programId: import("@solana/web3.js").PublicKey;
}
