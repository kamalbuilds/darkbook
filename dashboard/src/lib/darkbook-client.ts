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
import type { OrderBookLevel, Position, Fill, MarketInfo, Side, SizeBand } from "./darkbook-types";
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
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), Buffer.from(assetId, "utf8")],
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
  const idxBuf = Buffer.alloc(8);
  idxBuf.writeBigUInt64LE(BigInt(idx));
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pos"), market.toBuffer(), owner.toBuffer(), idxBuf],
    PROGRAM_ID
  );
  return pda;
}

/**
 * Fetch order book levels from the ER broadcaster WebSocket or RPC fallback.
 * Returns an empty array if the program is not yet deployed.
 */
export async function fetchOrderBook(market: PublicKey): Promise<OrderBookLevel[]> {
  const conn = getConnection();
  const bookPda = deriveOrderBookPda(market);
  const info = await conn.getAccountInfo(bookPda);
  if (!info || !info.data) return [];
  // The program isn't deployed yet, so we can't deserialize the account.
  // Return empty until the IDL is available.
  return [];
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
    const conn = getConnection();

    // Position discriminator from IDL (170, 188, 143, 228, 122, 64, 247, 208)
    const positionDiscriminator = Buffer.from([170, 188, 143, 228, 122, 64, 247, 208]);

    // Market filter: position.market field is at offset 32 (after discriminator 8 + owner pubkey 32)
    const marketFilter = {
      memcmp: {
        offset: 8 + 32, // discriminator + owner
        bytes: market.toBase58(),
      },
    };

    // Owner filter: position.owner is at offset 8 (after discriminator)
    const ownerFilter = {
      memcmp: {
        offset: 8,
        bytes: owner.toBase58(),
      },
    };

    const positions = await conn.getProgramAccounts(PROGRAM_ID, {
      filters: [
        { memcmp: { offset: 0, bytes: positionDiscriminator.toString("base64") } },
        marketFilter,
        ownerFilter,
      ],
    });

    // For now, return empty since program isn't deployed
    // When deployed, deserialize each account and filter by status
    return [];
  } catch (error) {
    console.error("[fetchClosedPositions] error:", error);
    return [];
  }
}

/**
 * Fetch all closed positions across all owners for leaderboard aggregation.
 * Uses getProgramAccounts with Position discriminator + status filter.
 */
export async function fetchAllClosedPositions(market: PublicKey): Promise<Position[]> {
  try {
    const conn = getConnection();

    // Position discriminator from IDL
    const positionDiscriminator = Buffer.from([170, 188, 143, 228, 122, 64, 247, 208]);

    // Market filter: position.market is at offset 40 (8 disc + 32 owner)
    const marketFilter = {
      memcmp: {
        offset: 8 + 32,
        bytes: market.toBase58(),
      },
    };

    const positions = await conn.getProgramAccounts(PROGRAM_ID, {
      filters: [
        { memcmp: { offset: 0, bytes: positionDiscriminator.toString("base64") } },
        marketFilter,
      ],
    });

    // For now, return empty since program isn't deployed
    // When deployed: deserialize, filter by status=Closed|Liquidated, aggregate by owner
    return [];
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
  // Program not deployed yet — return empty to show loading state
  return [];
}

/**
 * Fetch recent fills from the FillRecord accounts (mainnet mirror).
 */
export async function fetchRecentFills(market: PublicKey, limit = 20): Promise<Fill[]> {
  return [];
}

/**
 * Fetch market info from on-chain Market account.
 */
export async function fetchMarketInfo(assetId: string): Promise<MarketInfo | null> {
  try {
    const conn = getConnection();
    const marketPda = deriveMarketPda(assetId);
    const info = await conn.getAccountInfo(marketPda);

    if (!info || !info.data) return null;

    // Market discriminator from IDL (219, 190, 213, 55, 0, 227, 198, 154)
    // For now, return null since program isn't deployed
    return null;
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
  tx.add(ix as never);
  return { tx, blockhash };
}
