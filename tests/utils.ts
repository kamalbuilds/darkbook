/**
 * utils.ts — Self-contained test utilities for DarkBook tests.
 *
 * Includes: computeCommitment (mirrors orders.rs sha256 logic),
 * OrderBook deserializer, assertion helpers.
 */
import { PublicKey } from "@solana/web3.js";
import * as crypto from "crypto";
import { BN } from "@coral-xyz/anchor";

// ─── Commitment computation ───────────────────────────────────────────────────

/**
 * Mirror of orders.rs compute_commitment.
 * commitment = sha256(salt || size_lots_le_bytes[8] || leverage_bps_le_bytes[2] || trader_pubkey[32])
 */
export function computeCommitment(
  salt: Buffer, // 32 bytes
  sizeLots: bigint,
  leverageBps: number,
  trader: PublicKey
): Buffer {
  const h = crypto.createHash("sha256");
  h.update(salt);

  const sizeLotsLE = Buffer.alloc(8);
  sizeLotsLE.writeBigUInt64LE(sizeLots);
  h.update(sizeLotsLE);

  const leverageBuf = Buffer.alloc(2);
  leverageBuf.writeUInt16LE(leverageBps);
  h.update(leverageBuf);

  h.update(trader.toBuffer());
  return h.digest();
}

/** Generate a random 32-byte salt. */
export function randomSalt(): Buffer {
  return crypto.randomBytes(32);
}

// ─── OrderBook layout constants (must match state.rs) ────────────────────────

// Order::SIZE = 8 + 32 + 1 + 1 + 2 + 4 + 8 + 32 + 8 = 96 bytes
const ORDER_SIZE = 96;

// PriceBucket::SIZE = 8 + 8 + 4 * ORDER_SIZE = 16 + 384 = 400 bytes
const PRICE_BUCKET_SIZE = 8 + 8 + 4 * ORDER_SIZE;

// Fill::SIZE = 8 + 8 + 8 + 32 + 32 + 8 + 1 + 1 + 6 + 8 = 112 bytes
const FILL_SIZE = 8 + 8 + 8 + 32 + 32 + 8 + 1 + 1 + 6 + 8;

// OrderBook header = 8 (disc) + 32 (market) + 8*8 (metadata fields) + 16 (pad) = 120
const BOOK_HEADER_SIZE = 8 + 32 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 16;

// ─── Raw account deserializers ────────────────────────────────────────────────

export interface RawOrder {
  orderId: bigint;
  trader: PublicKey;
  side: number; // 0=Long, 1=Short
  sizeBand: number; // 0=Small, 1=Medium, 2=Large, 3=Whale
  leverageBps: number;
  priceTicks: bigint;
  commitment: Buffer;
  placedSlot: bigint;
}

export interface RawFill {
  fillId: bigint;
  takerOrderId: bigint;
  makerOrderId: bigint;
  taker: PublicKey;
  maker: PublicKey;
  priceTicks: bigint;
  sizeBand: number;
  claimed: boolean;
  matchedSlot: bigint;
}

export interface RawPriceBucket {
  priceTicks: bigint;
  count: number;
  orders: RawOrder[];
}

export interface DeserializedOrderBook {
  market: PublicKey;
  nextOrderId: bigint;
  nextFillId: bigint;
  lastMatchSlot: bigint;
  bidCount: number;
  askCount: number;
  fillCount: number;
  fillHead: number;
  bids: RawPriceBucket[];
  asks: RawPriceBucket[];
  fills: RawFill[];
}

function readOrder(buf: Buffer, offset: number): RawOrder {
  const orderId = buf.readBigUInt64LE(offset);
  const trader = new PublicKey(buf.slice(offset + 8, offset + 40));
  const side = buf.readUInt8(offset + 40);
  const sizeBand = buf.readUInt8(offset + 41);
  const leverageBps = buf.readUInt16LE(offset + 42);
  // _pad [4] at offset + 44
  const priceTicks = buf.readBigUInt64LE(offset + 48);
  const commitment = buf.slice(offset + 56, offset + 88);
  const placedSlot = buf.readBigUInt64LE(offset + 88);
  return {
    orderId,
    trader,
    side,
    sizeBand,
    leverageBps,
    priceTicks,
    commitment,
    placedSlot,
  };
}

function readPriceBucket(buf: Buffer, offset: number): RawPriceBucket {
  const priceTicks = buf.readBigUInt64LE(offset);
  const count = Number(buf.readBigUInt64LE(offset + 8));
  const orders: RawOrder[] = [];
  for (let i = 0; i < 4; i++) {
    orders.push(readOrder(buf, offset + 16 + i * ORDER_SIZE));
  }
  return { priceTicks, count, orders };
}

function readFill(buf: Buffer, offset: number): RawFill {
  const fillId = buf.readBigUInt64LE(offset);
  const takerOrderId = buf.readBigUInt64LE(offset + 8);
  const makerOrderId = buf.readBigUInt64LE(offset + 16);
  const taker = new PublicKey(buf.slice(offset + 24, offset + 56));
  const maker = new PublicKey(buf.slice(offset + 56, offset + 88));
  const priceTicks = buf.readBigUInt64LE(offset + 88);
  const sizeBand = buf.readUInt8(offset + 96);
  const claimed = buf.readUInt8(offset + 97) === 1;
  // _pad [6] at offset + 98
  const matchedSlot = buf.readBigUInt64LE(offset + 104);
  return {
    fillId,
    takerOrderId,
    makerOrderId,
    taker,
    maker,
    priceTicks,
    sizeBand,
    claimed,
    matchedSlot,
  };
}

/**
 * Deserialize raw OrderBook account data (after 8-byte Anchor discriminator).
 * Used by tests to inspect the zero-copy OrderBook without going through the IDL.
 */
export function deserializeOrderBook(data: Buffer): DeserializedOrderBook {
  let offset = 8; // skip discriminator

  const market = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;

  const nextOrderId = data.readBigUInt64LE(offset);
  offset += 8;
  const nextFillId = data.readBigUInt64LE(offset);
  offset += 8;
  const lastMatchSlot = data.readBigUInt64LE(offset);
  offset += 8;
  const bidCount = Number(data.readBigUInt64LE(offset));
  offset += 8;
  const askCount = Number(data.readBigUInt64LE(offset));
  offset += 8;
  const fillCount = Number(data.readBigUInt64LE(offset));
  offset += 8;
  const fillHead = Number(data.readBigUInt64LE(offset));
  offset += 8;

  // _pad [16]
  offset += 16;

  // 64 bid buckets
  const bids: RawPriceBucket[] = [];
  for (let i = 0; i < 64; i++) {
    bids.push(readPriceBucket(data, offset));
    offset += PRICE_BUCKET_SIZE;
  }

  // 64 ask buckets
  const asks: RawPriceBucket[] = [];
  for (let i = 0; i < 64; i++) {
    asks.push(readPriceBucket(data, offset));
    offset += PRICE_BUCKET_SIZE;
  }

  // 256 fills
  const fills: RawFill[] = [];
  for (let i = 0; i < 256; i++) {
    fills.push(readFill(data, offset));
    offset += FILL_SIZE;
  }

  return {
    market,
    nextOrderId,
    nextFillId,
    lastMatchSlot,
    bidCount,
    askCount,
    fillCount,
    fillHead,
    bids,
    asks,
    fills,
  };
}

// ─── Collateral helpers ───────────────────────────────────────────────────────

/**
 * Compute exact collateral from settlement formula.
 * collateral = (size_lots * price_ticks * 100) / leverage_bps
 * (matches compute_collateral in settlement.rs)
 */
export function computeCollateral(
  sizeLots: bigint,
  priceTicks: bigint,
  leverageBps: number
): bigint {
  return (sizeLots * priceTicks * BigInt(100)) / BigInt(leverageBps);
}

/**
 * Compute collateral lock estimate from place_order.
 * Uses size band ceiling instead of exact size.
 */
export function computeCollateralEstimate(
  sizeBand: "Small" | "Medium" | "Large" | "Whale",
  priceTicks: bigint,
  leverageBps: number
): bigint {
  const ceilings: Record<string, bigint> = {
    Small: BigInt(10),
    Medium: BigInt(100),
    Large: BigInt(1000),
    Whale: BigInt(10000),
  };
  const ceiling = ceilings[sizeBand];
  return (ceiling * priceTicks * BigInt(100)) / BigInt(leverageBps);
}

// ─── Unrealized PnL ───────────────────────────────────────────────────────────

/**
 * Compute unrealized PnL for a position.
 * Long: (markPrice - entryPrice) * sizeLots
 * Short: (entryPrice - markPrice) * sizeLots
 */
export function unrealizedPnl(
  side: "Long" | "Short",
  entryPriceTicks: bigint,
  markPriceTicks: bigint,
  sizeLots: bigint
): bigint {
  if (side === "Long") {
    return (markPriceTicks - entryPriceTicks) * sizeLots;
  } else {
    return (entryPriceTicks - markPriceTicks) * sizeLots;
  }
}

// ─── Assertion helpers ────────────────────────────────────────────────────────

/** Assert that a transaction fails with a specific Anchor error code. */
export async function expectError(
  fn: () => Promise<any>,
  expectedCode: string | number
): Promise<void> {
  let threw = false;
  try {
    await fn();
  } catch (e: any) {
    threw = true;
    const msg = e?.message || e?.toString() || "";
    // Anchor error codes show as "Error Code: <name>" or numeric
    const codeMatch =
      msg.includes(String(expectedCode)) ||
      msg.toLowerCase().includes(String(expectedCode).toLowerCase());
    if (!codeMatch) {
      throw new Error(
        `Expected error containing "${expectedCode}" but got: ${msg.slice(0, 200)}`
      );
    }
  }
  if (!threw) {
    throw new Error(`Expected transaction to fail with "${expectedCode}" but it succeeded`);
  }
}

/** Convert USDC human amount to micro-units. */
export function usdcAmount(humanAmount: number): bigint {
  return BigInt(Math.round(humanAmount * 1_000_000));
}

/** Convert price in dollars to price_ticks (micro-USDC per lot). */
export function dollarsToPriceTicks(priceUsd: number): bigint {
  // 1 lot = 1 unit, price in USDC with 6 decimals
  return BigInt(Math.round(priceUsd * 1_000_000));
}
