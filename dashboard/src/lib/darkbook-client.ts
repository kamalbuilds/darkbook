"use client";

/**
 * DarkBook client.
 * Wraps on-chain interactions with the Anchor program + ER using the IDL
 * shipped with this package (darkbook-idl.json). Constructs Anchor `Program`
 * instances on demand from the user's connected wallet.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  clusterApiUrl,
  type BlockhashWithExpiryBlockHeight,
} from "@solana/web3.js";
import { AnchorProvider, BN, Program, type Idl } from "@coral-xyz/anchor";
import { sha256 } from "@noble/hashes/sha2";
import idl from "./darkbook-idl.json";
import type { OrderBookLevel, Position, Fill, MarketInfo, Side, SizeBand, PositionStatus } from "./darkbook-types";
import { pythUsdFeedIdForMarket } from "./market-assets";

// RPC selection priority: explicit env > Helius > Quicknode > public devnet.
// Lets the dashboard run against any of the three sponsor-tier RPC providers
// (Helius for the Helius sidetrack, Quicknode for the Eitherway sidetrack)
// without code changes.
const RPC =
  process.env.NEXT_PUBLIC_RPC ??
  process.env.NEXT_PUBLIC_HELIUS_RPC ??
  process.env.NEXT_PUBLIC_QUICKNODE_RPC ??
  clusterApiUrl("devnet");
const ER_WS = process.env.NEXT_PUBLIC_ER_WS ?? "wss://devnet-us.magicblock.app/";
const PYTH_WS =
  process.env.NEXT_PUBLIC_PYTH_LAZER_WS ?? "wss://pyth-lazer-0.dourolabs.app/v1/stream";
const HERMES_URL = process.env.NEXT_PUBLIC_PYTH_HERMES_URL ?? "https://hermes.pyth.network";
/** Legacy override: if set, used for SOL market only instead of bundled SOL feed id. */
const SOL_FEED_ENV = process.env.NEXT_PUBLIC_SOL_USD_FEED ?? "";

const PROGRAM_ID_STR = process.env.NEXT_PUBLIC_PROGRAM_ID ?? "11111111111111111111111111111111";

let _programId: PublicKey;
try {
  _programId = new PublicKey(PROGRAM_ID_STR);
} catch {
  _programId = PublicKey.default;
}

export const PROGRAM_ID = _programId;

/** Shared RPC connection — reused across components */
export function getConnection(): Connection {
  return new Connection(RPC, { commitment: "confirmed", wsEndpoint: ER_WS });
}

/**
 * Derive the Market PDA.
 * seeds = [b"market", asset_id_bytes]
 */
export function deriveMarketPda(assetId: string): PublicKey {
  const hash = sha256(new TextEncoder().encode(assetId));
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), hash.slice(0, 8)],
    PROGRAM_ID
  );
  return pda;
}

/**
 * Derive the OrderBook PDA.
 * seeds = [b"book", market]
 */
export function deriveOrderBookPda(market: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("book"), market.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

/**
 * Derive UserAccount PDA.
 * seeds = [b"user", market, owner]
 */
export function deriveUserAccountPda(market: PublicKey, owner: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("user"), market.toBuffer(), owner.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

/**
 * Derive Position PDA.
 * seeds = [b"pos", market, owner, idx_le]
 */
export function derivePositionPda(market: PublicKey, owner: PublicKey, idx: number): PublicKey {
  const idxBuf = new Uint8Array(8);
  const view = new DataView(idxBuf.buffer);
  view.setBigUint64(0, BigInt(idx), true);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pos"), market.toBuffer(), owner.toBuffer(), Buffer.from(idxBuf)],
    PROGRAM_ID
  );
  return pda;
}

/** Read-only Anchor Program instance (no wallet needed for fetches). */
function getReadOnlyProgram(): Program {
  const conn = getConnection();
  const provider = new AnchorProvider(
    conn,
    { publicKey: PublicKey.default, signTransaction: undefined as never, signAllTransactions: undefined as never },
    AnchorProvider.defaultOptions(),
  );
  return new Program(idl as Idl, provider);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAccountNs = { fetch: (addr: PublicKey) => Promise<any>; all: (filters?: any[]) => Promise<any[]> };
function positionNs(): AnyAccountNs { return (getReadOnlyProgram().account as any).position; }
function marketNs(): AnyAccountNs { return (getReadOnlyProgram().account as any).market; }

/** Decode a deserialized Position account into the dashboard Position type. */
function decodePosition(pubkey: PublicKey, a: Record<string, unknown>): Position {
  const status = a.status as Record<string, unknown>;
  const statusStr: PositionStatus = status.open !== undefined ? "Open" : status.closed !== undefined ? "Closed" : "Liquidated";
  const side = (a.side as Record<string, unknown>).long !== undefined ? "Long" : "Short";
  return {
    pubkey: pubkey.toBase58(),
    owner: (a.owner as PublicKey).toBase58(),
    market: (a.market as PublicKey).toBase58(),
    side: side as Side,
    size_lots: Number(a.sizeLots),
    entry_price_ticks: Number(a.entryPriceTicks),
    collateral_locked: Number(a.collateralLocked),
    opened_ts: Number(a.openedTs),
    last_funding_index: Number(a.lastFundingIndex),
    status: statusStr,
    leverage: Number(a.leverageBps),
  };
}

// --- OrderBook raw layout constants (repr(C), bytemuck) ---
// Order: 96 bytes. PriceBucket: 16 header + 4*96 = 400 bytes.
const ORDER_SIZE = 96;
const BUCKET_HEADER = 16; // price_ticks(8) + count(8)
const ORDERS_PER_BUCKET = 4;
const BUCKET_SIZE = BUCKET_HEADER + ORDERS_PER_BUCKET * ORDER_SIZE;
const LEVELS_PER_SIDE = 256;
// OrderBook header: 32(market) + 7*8(counters) + 1(is_delegated) + 15(pad) = 104
// OrderBook header: disc(8) + market(32) + 8*u64(64) + is_delegated(1) + pad(15) = 120
const BOOK_HEADER = 8 + 32 + 8 * 8 + 1 + 15;
const BIDS_OFFSET = BOOK_HEADER;
const ASKS_OFFSET = BIDS_OFFSET + LEVELS_PER_SIDE * BUCKET_SIZE;
const FILLS_OFFSET = ASKS_OFFSET + LEVELS_PER_SIDE * BUCKET_SIZE;
const FILL_SIZE = 112;
const FILL_QUEUE_CAP = 256;

const SIZE_BAND_MAP: SizeBand[] = ["Small", "Medium", "Large", "Whale"];

/** Browser-safe u64 LE read from any Uint8Array/Buffer. */
function readU64LE(buf: Uint8Array, off: number): number {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return Number(dv.getBigUint64(off, true));
}

function parseBuckets(data: Uint8Array, offset: number, count: number): OrderBookLevel[] {
  const levels: OrderBookLevel[] = [];
  for (let i = 0; i < LEVELS_PER_SIDE && levels.length < count; i++) {
    const bOff = offset + i * BUCKET_SIZE;
    const priceTicks = readU64LE(data, bOff);
    const bucketCount = readU64LE(data, bOff + 8);
    if (priceTicks === 0 || bucketCount === 0) continue;
    for (let j = 0; j < ORDERS_PER_BUCKET; j++) {
      const oOff = bOff + BUCKET_HEADER + j * ORDER_SIZE;
      const orderId = readU64LE(data, oOff);
      if (orderId === 0) continue;
      const side: Side = data[oOff + 40] === 0 ? "Long" : "Short";
      const sizeBand = SIZE_BAND_MAP[data[oOff + 41]] ?? "Small";
      levels.push({
        price_ticks: readU64LE(data, oOff + 48),
        size_band: sizeBand,
        side,
        order_count: 1,
      });
    }
  }
  return levels;
}

/**
 * Fetch order book levels from the on-chain OrderBook account.
 */
export async function fetchOrderBook(market: PublicKey): Promise<OrderBookLevel[]> {
  try {
    const conn = getConnection();
    const bookPda = deriveOrderBookPda(market);
    const info = await conn.getAccountInfo(bookPda);
    if (!info || !info.data || info.data.length < BOOK_HEADER) return [];

    const data = info.data as Uint8Array;
    // bid_count is at offset 8(disc) + 32(market) + 4*8(skip first 4 counters) = 72
    const bidCount = readU64LE(data, 8 + 32 + 4 * 8);
    const askCount = readU64LE(data, 8 + 32 + 5 * 8);

    const bids = parseBuckets(data, BIDS_OFFSET, bidCount);
    const asks = parseBuckets(data, ASKS_OFFSET, askCount);
    return [...bids, ...asks];
  } catch (error) {
    console.error("[fetchOrderBook] error:", error);
    return [];
  }
}

/**
 * Fetch all positions for a wallet, filtering by status (Closed or Liquidated).
 * Uses getProgramAccounts with Position discriminator + owner filter.
 */
export async function fetchClosedPositions(
  market: PublicKey,
  owner: PublicKey
): Promise<Position[]> {
  try {
    const accounts = await positionNs().all([
      { memcmp: { offset: 8, bytes: owner.toBase58() } },
      { memcmp: { offset: 8 + 32, bytes: market.toBase58() } },
    ]);
    return accounts
      .filter((a: { account: { status: { closed?: object; liquidated?: object } } }) =>
        a.account.status.closed !== undefined || a.account.status.liquidated !== undefined
      )
      .map((a: { publicKey: PublicKey; account: Record<string, unknown> }) => decodePosition(a.publicKey, a.account));
  } catch (error) {
    console.error("[fetchClosedPositions] error:", error);
    return [];
  }
}

/**
 * Fetch all closed positions across all owners for leaderboard aggregation.
 */
export async function fetchAllClosedPositions(market: PublicKey): Promise<Position[]> {
  try {
    const accounts = await positionNs().all([
      { memcmp: { offset: 8 + 32, bytes: market.toBase58() } },
    ]);
    return accounts
      .filter((a: { account: { status: { closed?: object; liquidated?: object } } }) =>
        a.account.status.closed !== undefined || a.account.status.liquidated !== undefined
      )
      .map((a: { publicKey: PublicKey; account: Record<string, unknown> }) => decodePosition(a.publicKey, a.account));
  } catch (error) {
    console.error("[fetchAllClosedPositions] error:", error);
    return [];
  }
}

/**
 * Fetch open positions for a wallet.
 * Scans position PDAs at indices 0..limit until account not found.
 */
export async function fetchPositions(
  market: PublicKey,
  owner: PublicKey,
  limit = 20
): Promise<Position[]> {
  try {
    const ns = positionNs();
    const results: Position[] = [];
    for (let i = 0; i < limit; i++) {
      const pda = derivePositionPda(market, owner, i);
      try {
        const acc = await ns.fetch(pda);
        if (acc) results.push(decodePosition(pda, acc as Record<string, unknown>));
      } catch {
        break; // account doesn't exist, stop scanning
      }
    }
    return results;
  } catch (error) {
    console.error("[fetchPositions] error:", error);
    return [];
  }
}

/**
 * Fetch recent fills from the OrderBook fills ring buffer.
 */
export async function fetchRecentFills(market: PublicKey, limit = 20): Promise<Fill[]> {
  try {
    const conn = getConnection();
    const bookPda = deriveOrderBookPda(market);
    const info = await conn.getAccountInfo(bookPda);
    if (!info || !info.data || info.data.length < FILLS_OFFSET) return [];

    const data = info.data as Uint8Array;
    const fillCount = readU64LE(data, 8 + 32 + 6 * 8);
    const fillHead = readU64LE(data, 8 + 32 + 7 * 8);
    if (fillCount === 0) return [];

    const fills: Fill[] = [];
    const n = Math.min(fillCount, limit, FILL_QUEUE_CAP);
    for (let i = 0; i < n; i++) {
      // Read backwards from head
      const idx = (fillHead - 1 - i + FILL_QUEUE_CAP) % FILL_QUEUE_CAP;
      const fOff = FILLS_OFFSET + idx * FILL_SIZE;
      const fillId = readU64LE(data, fOff);
      if (fillId === 0) continue;
      const priceTicks = readU64LE(data, fOff + 40 + 32); // after fill_id(8)+taker_order_id(8)+maker_order_id(8)+taker(32)+maker(32) = offset 88... 
      // repr(C) layout: fill_id(8), taker_order_id(8), maker_order_id(8), taker(32), maker(32), price_ticks(8), size_band(1), claimed(1), _pad(6), matched_slot(8)
      const priceOff = fOff + 8 + 8 + 8 + 32 + 32; // = fOff + 88
      const price = readU64LE(data, priceOff);
      const sizeBand = SIZE_BAND_MAP[data[priceOff + 8]] ?? "Small";
      const matchedSlot = readU64LE(data, priceOff + 8 + 1 + 1 + 6);
      fills.push({
        fill_id: fillId.toString(),
        taker_order_id: readU64LE(data, fOff + 8).toString(),
        maker_order_id: readU64LE(data, fOff + 16).toString(),
        taker: new PublicKey(data.slice(fOff + 24, fOff + 56)).toBase58(),
        maker: new PublicKey(data.slice(fOff + 56, fOff + 88)).toBase58(),
        price_ticks: price,
        size_band: sizeBand,
        matched_slot: matchedSlot,
        claimed: data[priceOff + 9] === 1,
      });
    }
    return fills;
  } catch (error) {
    console.error("[fetchRecentFills] error:", error);
    return [];
  }
}

/**
 * Fetch market info from on-chain Market account.
 */
export async function fetchMarketInfo(assetId: string): Promise<MarketInfo | null> {
  try {
    const marketPda = deriveMarketPda(assetId);
    const acc = await marketNs().fetch(marketPda);
    if (!acc) return null;
    const a = acc as Record<string, unknown>;
    return {
      asset_id: assetId,
      oracle_feed_id: Buffer.from(a.oracleFeedId as number[]).toString("hex"),
      funding_interval_secs: Number(a.fundingIntervalSecs),
      max_leverage_bps: Number(a.maxLeverageBps),
      taker_fee_bps: Number(a.takerFeeBps),
      maker_rebate_bps: Number(a.makerRebateBps),
      total_long_size: Number(a.totalLongSize),
      total_short_size: Number(a.totalShortSize),
      last_funding_ts: Number(a.lastFundingTs),
      mark_price: null,
      index_price: null,
      paused: a.paused as boolean,
    };
  } catch (error) {
    console.error("[fetchMarketInfo] error:", error);
    return null;
  }
}

function hermesFeedId(marketId: string): string {
  if (marketId === "SOL" && SOL_FEED_ENV) return SOL_FEED_ENV;
  return pythUsdFeedIdForMarket(marketId);
}

/** Pull latest USD price from Hermes (works in the browser without a Lazer token). */
async function fetchHermesUsdPrice(feedId: string): Promise<number | null> {
  const url = `${HERMES_URL}/v2/updates/price/latest?ids[]=${feedId}&encoding=hex`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const json = (await resp.json()) as {
    parsed?: Array<{
      price: { price: string; expo: number };
    }>;
  };
  const p = json.parsed?.[0]?.price;
  if (!p?.price) return null;
  const raw = Number(p.price);
  if (!Number.isFinite(raw)) return null;
  const usd = raw * 10 ** p.expo;
  return Number.isFinite(usd) ? usd : null;
}

/**
 * Subscribe to mark price (USD) for the selected perp reference market.
 *
 * Primary path: Hermes REST polling (no API key, stable in the browser).
 * Optional: Pyth Lazer WebSocket when `NEXT_PUBLIC_PYTH_LAZER_TOKEN` is set for lower latency.
 */
export function subscribeMarkPrice(
  onPrice: (price: number) => void,
  marketId: string = "SOL",
): () => void {
  if (typeof window === "undefined") return () => {};

  const feedId = hermesFeedId(marketId);
  const lazerToken = process.env.NEXT_PUBLIC_PYTH_LAZER_TOKEN ?? "";

  let closed = false;
  let ws: WebSocket | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const poll = async () => {
    if (closed) return;
    const p = await fetchHermesUsdPrice(feedId);
    if (!closed && p != null) onPrice(p);
  };

  void poll();
  pollTimer = setInterval(poll, 5000);

  const connectWs = () => {
    if (!lazerToken || closed) return;
    try {
      ws = new WebSocket(PYTH_WS);
      ws.onopen = () => {
        if (!ws || closed) return;
        ws.send(
          JSON.stringify({
            type: "subscribe",
            channel: "lazer",
            feeds: [{ feedId }],
            token: lazerToken,
          }),
        );
      };
      ws.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data as string);
          if (data?.price) {
            onPrice(Number(data.price) / 1e8);
          } else if (data?.priceInUsd) {
            onPrice(Number(data.priceInUsd));
          }
        } catch {
          // binary frame or non-JSON
        }
      };
      ws.onerror = () => {};
      ws.onclose = () => {
        if (!closed) setTimeout(connectWs, 4000);
      };
    } catch {
      // ignore
    }
  };

  connectWs();

  return () => {
    closed = true;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (ws) {
      ws.close();
      ws = null;
    }
  };
}

/**
 * Generate a commitment for an order.
 * commitment = sha256(salt || size_lots_le || leverage_bps_le || trader_pubkey)
 *
 * Uses Web Crypto API. Returns { commitment, salt } where both are hex strings.
 */
export async function generateCommitment(
  sizeLots: number,
  leverageBps: number,
  traderPubkey: PublicKey
): Promise<{ commitment: Uint8Array; salt: Uint8Array }> {
  const salt = crypto.getRandomValues(new Uint8Array(32));

  const sizeLotsBytes = new Uint8Array(8);
  new DataView(sizeLotsBytes.buffer).setBigUint64(0, BigInt(sizeLots), true);

  const leverageBytes = new Uint8Array(2);
  new DataView(leverageBytes.buffer).setUint16(0, leverageBps, true);

  const payload = new Uint8Array([
    ...salt,
    ...sizeLotsBytes,
    ...leverageBytes,
    ...traderPubkey.toBytes(),
  ]);

  const hashBuffer = await crypto.subtle.digest("SHA-256", payload);
  const commitment = new Uint8Array(hashBuffer);

  return { commitment, salt };
}

/**
 * Build a real placeOrder transaction against the deployed Anchor program.
 *
 * Caller signs + sends. Returns the unsigned tx + the blockhash used so the
 * caller can pass `lastValidBlockHeight` to `confirmTransaction` without a
 * second RPC roundtrip.
 *
 * Throws if the program isn't deployed (PROGRAM_ID == default) — surfacing
 * a real configuration error instead of silently faking a placement.
 */
export async function buildPlaceOrderTx(opts: {
  connection: Connection;
  trader: PublicKey;
  market: PublicKey;
  side: Side;
  priceTicks: bigint;
  sizeBand: SizeBand;
  leverageBps: number;
  commitment: Uint8Array;
}): Promise<{ tx: Transaction; blockhash: BlockhashWithExpiryBlockHeight }> {
  if (PROGRAM_ID.equals(PublicKey.default)) {
    throw new Error(
      "PROGRAM_ID env var not set. Set NEXT_PUBLIC_PROGRAM_ID after running scripts/deploy-devnet.sh.",
    );
  }

  const provider = new AnchorProvider(
    opts.connection,
    // The actual signing happens at the caller — we only need a wallet shape
    // for AnchorProvider to construct the program instance.
    { publicKey: opts.trader, signTransaction: undefined as never, signAllTransactions: undefined as never },
    AnchorProvider.defaultOptions(),
  );
  // Anchor 0.32: programId comes from idl.address. The loaded IDL shape is
  // generic so we pass it through `as Idl`.
  const program = new Program(idl as Idl, provider);

  const userAccount = deriveUserAccountPda(opts.market, opts.trader);
  const orderBook = deriveOrderBookPda(opts.market);

  // Auto-initialize user account if it doesn't exist yet
  const userInfo = await opts.connection.getAccountInfo(userAccount);
  let initIx: unknown | null = null;
  if (!userInfo) {
    initIx = await (program.methods as unknown as {
      initializeUser: () => { accounts: (a: Record<string, PublicKey>) => { instruction: () => Promise<unknown> } };
    })
      .initializeUser()
      .accounts({
        owner: opts.trader,
        market: opts.market,
        userAccount,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  // Anchor enum variants serialize as `{ variant: {} }`.
  const sideArg = opts.side === "Long" ? { long: {} } : { short: {} };
  const bandArg = (() => {
    switch (opts.sizeBand) {
      case "Small": return { small: {} };
      case "Medium": return { medium: {} };
      case "Large": return { large: {} };
      case "Whale": return { whale: {} };
    }
  })();

  // Build the instruction via Anchor's typed builder.
  // Fall back to a manual instruction if Anchor Program init failed.
  const ix = await (program.methods as unknown as {
    placeOrder: (...a: unknown[]) => { accounts: (a: Record<string, PublicKey>) => { instruction: () => Promise<unknown> } };
  })
    .placeOrder(
      sideArg,
      new BN(opts.priceTicks.toString()),
      bandArg,
      opts.leverageBps,
      Array.from(opts.commitment),
    )
    .accounts({
      trader: opts.trader,
      market: opts.market,
      userAccount,
      orderBook,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const blockhash = await opts.connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({
    feePayer: opts.trader,
    blockhash: blockhash.blockhash,
    lastValidBlockHeight: blockhash.lastValidBlockHeight,
  });
  if (initIx) tx.add(initIx as never);
  tx.add(ix as never);
  return { tx, blockhash };
}

/**
 * Build a closePosition transaction.
 * Returns unsigned tx + blockhash for caller to sign and send.
 *
 * @param priceUpdateAccount - Pyth PriceUpdateV2 account pubkey used as oracle at close.
 */
export async function buildClosePositionTx(opts: {
  connection: Connection;
  owner: PublicKey;
  market: PublicKey;
  positionPda: PublicKey;
  priceUpdateAccount: PublicKey;
}): Promise<{ tx: Transaction; blockhash: BlockhashWithExpiryBlockHeight }> {
  if (PROGRAM_ID.equals(PublicKey.default)) {
    throw new Error(
      "PROGRAM_ID env var not set. Set NEXT_PUBLIC_PROGRAM_ID after running scripts/deploy-devnet.sh.",
    );
  }

  const provider = new AnchorProvider(
    opts.connection,
    { publicKey: opts.owner, signTransaction: undefined as never, signAllTransactions: undefined as never },
    AnchorProvider.defaultOptions(),
  );
  const program = new Program(idl as Idl, provider);

  const userAccount = deriveUserAccountPda(opts.market, opts.owner);

  const ix = await (program.methods as unknown as {
    closePosition: () => { accounts: (a: Record<string, PublicKey>) => { instruction: () => Promise<unknown> } };
  })
    .closePosition()
    .accounts({
      market: opts.market,
      position: opts.positionPda,
      userAccount,
      priceUpdate: opts.priceUpdateAccount,
      owner: opts.owner,
    })
    .instruction();

  const blockhash = await opts.connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({
    feePayer: opts.owner,
    blockhash: blockhash.blockhash,
    lastValidBlockHeight: blockhash.lastValidBlockHeight,
  });
  tx.add(ix as never);
  return { tx, blockhash };
}
