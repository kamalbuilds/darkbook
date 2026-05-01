/**
 * DarkBook Funding Cron
 *
 * Runs as a one-shot process (exit 0 on success) suitable for Vercel Cron.
 * Schedule: every 8 hours (vercel.json: "0 *\/8 * * *")
 *
 * Steps:
 *  1. Call update_funding(market, oracleUpdate) for each configured market.
 *  2. Page through all open Position accounts.
 *  3. Call accrue_funding(position) for each, batched to avoid timeouts.
 */

import pino from "pino";
import {
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import { AnchorProvider, Program, BN, type Wallet } from "@coral-xyz/anchor";
import { Buffer } from "node:buffer";
import { createRequire } from "node:module";

import {
  fetchPythPrice,
  userPda,
  SOL_USD_FEED_ID,
} from "@darkbook/sdk";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DarkbookIdl: any = require("../../../sdk/src/idl/darkbook.json");

// ─── Logger ──────────────────────────────────────────────────────────────────

const log = pino({ name: "funding-cron", level: process.env.LOG_LEVEL ?? "info" });

// ─── Config ───────────────────────────────────────────────────────────────────

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID ?? "9i4Gpnt8GgrwxqwXdEyjFBsfNChis8z9jmyAbMpFVLcS",
);
const PYTH_FEED_ID = process.env.PYTH_FEED_ID ?? SOL_USD_FEED_ID;

// Markets to process — comma-separated pubkeys
const MARKETS_RAW = process.env.MARKET_PUBKEYS ?? "";
const markets: PublicKey[] = MARKETS_RAW
  ? MARKETS_RAW.split(",").map((s) => new PublicKey(s.trim()))
  : [];

/** Max accrue_funding calls per batch to stay within rate limits */
const BATCH_SIZE = 20;

// Cranker keypair
const crankerSecretRaw = process.env.CRANKER_SECRET_KEY;
if (!crankerSecretRaw) {
  log.error("CRANKER_SECRET_KEY not set (JSON u8 array)");
  process.exit(1);
}
const crankerKeypair = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(crankerSecretRaw) as number[]),
);
log.info({ cranker: crankerKeypair.publicKey.toBase58() }, "Cranker identity");

// ─── Anchor client ────────────────────────────────────────────────────────────

const conn = new Connection(RPC_URL, "confirmed");
const anchorWallet: Wallet = {
  publicKey: crankerKeypair.publicKey,
  signTransaction: async (tx) => {
    tx.partialSign(crankerKeypair);
    return tx;
  },
  signAllTransactions: async (txs) => {
    for (const tx of txs) tx.partialSign(crankerKeypair);
    return txs;
  },
  payer: crankerKeypair,
};
const provider = new AnchorProvider(conn, anchorWallet, { commitment: "confirmed" });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const program = new Program<any>(DarkbookIdl, provider);

// ─── Position type ────────────────────────────────────────────────────────────

interface PositionAccount {
  trader: PublicKey;
  market: PublicKey;
  side: { long?: Record<string, never>; short?: Record<string, never> };
  sizeLots: BN;
  entryPriceTicks: BN;
  collateralLocked: BN;
  openedTs: BN;
  lastFundingIndex: BN;
  status: { open?: Record<string, never>; liquidated?: Record<string, never>; closed?: Record<string, never> };
  positionIdx: number;
  bump: number;
}

// ─── Funding update logic ─────────────────────────────────────────────────────

async function runFundingCycle(): Promise<void> {
  if (markets.length === 0) {
    log.warn("No MARKET_PUBKEYS configured — nothing to do");
    return;
  }

  // Fetch oracle once (reuse for all markets in this cycle)
  log.info("Fetching Pyth price update");
  const px = await fetchPythPrice(PYTH_FEED_ID);
  const oracleUpdate = Buffer.from(px.updateData);
  log.info({ price: px.price.toString(), publishTime: px.publishTime }, "Oracle price");

  for (const market of markets) {
    log.info({ market: market.toBase58() }, "Running update_funding");

    try {
      const sig = await program.methods
        .updateFunding(oracleUpdate)
        .accounts({
          cranker: crankerKeypair.publicKey,
          market,
          instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .signers([crankerKeypair])
        .rpc();
      log.info({ market: market.toBase58(), sig }, "update_funding submitted");
    } catch (err) {
      log.error({ err, market: market.toBase58() }, "update_funding failed — skipping accrue for this market");
      continue;
    }

    // Fetch all open positions for this market
    let positions: Array<{ publicKey: PublicKey; account: PositionAccount }>;
    try {
      const STATUS_OFFSET = 113; // discriminator(8)+trader(32)+market(32)+side(1)+...
      positions = (await program.account.position.all([
        {
          memcmp: {
            offset: STATUS_OFFSET,
            bytes: "11", // base58 of 0x00 = Open
          },
        },
      ])) as Array<{ publicKey: PublicKey; account: PositionAccount }>;
    } catch (err) {
      log.error({ err, market: market.toBase58() }, "Failed to fetch open positions");
      continue;
    }

    // Filter to positions belonging to this market
    const marketPositions = positions.filter((p) =>
      p.account.market.equals(market),
    );
    log.info({ market: market.toBase58(), count: marketPositions.length }, "Open positions to accrue");

    // Process in batches
    for (let i = 0; i < marketPositions.length; i += BATCH_SIZE) {
      const batch = marketPositions.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(
        batch.map(async ({ publicKey: posPk, account: pos }) => {
          const [userAccount] = userPda(PROGRAM_ID, market, pos.trader);
          try {
            const sig = await program.methods
              .accrueFunding()
              .accounts({
                cranker: crankerKeypair.publicKey,
                market,
                position: posPk,
                userAccount,
              })
              .signers([crankerKeypair])
              .rpc();
            log.debug({ position: posPk.toBase58(), sig }, "accrue_funding submitted");
          } catch (err) {
            log.warn({ err, position: posPk.toBase58() }, "accrue_funding failed (non-fatal)");
          }
        }),
      );
      log.info({ market: market.toBase58(), processed: Math.min(i + BATCH_SIZE, marketPositions.length) }, "Batch complete");
    }
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log.info("Funding cron starting");

  const loopMode = process.env.LOOP_MODE === "true";

  if (loopMode) {
    // Long-running daemon mode — loop every 8h
    const INTERVAL_MS = 8 * 60 * 60 * 1000;
    const runLoop = async (): Promise<void> => {
      try {
        await runFundingCycle();
      } catch (err) {
        log.error({ err }, "Funding cycle error");
      }
      setTimeout(() => void runLoop(), INTERVAL_MS);
    };
    await runLoop();

    const shutdown = (): void => {
      log.info("Shutdown signal received");
      process.exit(0);
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  } else {
    // One-shot mode (default — for Vercel Cron or manual trigger)
    try {
      await runFundingCycle();
      log.info("Funding cron complete");
      process.exit(0);
    } catch (err) {
      log.error({ err }, "Funding cron failed");
      process.exit(1);
    }
  }
}

main().catch((err: unknown) => {
  log.error({ err }, "Fatal error");
  process.exit(1);
});
