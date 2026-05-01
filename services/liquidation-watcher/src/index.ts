/**
 * DarkBook Liquidation Watcher
 *
 * 1. Connects to Pyth Lazer WebSocket for real-time SOL/USD price ticks.
 * 2. On each price tick, fetches all open Position accounts via getProgramAccounts.
 * 3. For each position, computes mark loss and collateral ratio.
 * 4. If collateral_ratio < 1.2, fetches Pyth oracle update and submits
 *    liquidate_position on mainnet.
 * 5. Collects the liquidator bounty (5% of remaining collateral).
 */

import pino from "pino";
import {
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import { AnchorProvider, Program, BN, type Wallet } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Buffer } from "node:buffer";
import { createRequire } from "node:module";

import {
  PythLazerStream,
  fetchPythPrice,
  userPda,
  vaultPda,
  SOL_USD_FEED_ID,
  type LazerPriceUpdate,
} from "@darkbook/sdk";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DarkbookIdl: any = require("../../../sdk/src/idl/darkbook.json");

// ─── Logger ──────────────────────────────────────────────────────────────────

const log = pino({ name: "liquidation-watcher", level: process.env.LOG_LEVEL ?? "info" });

// ─── Config ───────────────────────────────────────────────────────────────────

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID ?? "9i4Gpnt8GgrwxqwXdEyjFBsfNChis8z9jmyAbMpFVLcS",
);
const PYTH_FEED_ID = process.env.PYTH_FEED_ID ?? SOL_USD_FEED_ID;
const PYTH_LAZER_TOKEN = process.env.PYTH_LAZER_TOKEN ?? "";
const USDC_MINT = new PublicKey(
  process.env.USDC_MINT ?? "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr",
);

/** Liquidation threshold: 1.2 → 120% collateral ratio = 12_000 bps */
const LIQUIDATION_THRESHOLD_BPS = 12_000n;

// Liquidator keypair
const liquidatorSecretRaw = process.env.LIQUIDATOR_SECRET_KEY;
if (!liquidatorSecretRaw) {
  log.error("LIQUIDATOR_SECRET_KEY not set (JSON u8 array)");
  process.exit(1);
}
const liquidatorKeypair = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(liquidatorSecretRaw) as number[]),
);
log.info({ liquidator: liquidatorKeypair.publicKey.toBase58() }, "Liquidator identity");

// ─── Anchor client ────────────────────────────────────────────────────────────

const conn = new Connection(RPC_URL, "confirmed");
const anchorWallet: Wallet = {
  publicKey: liquidatorKeypair.publicKey,
  signTransaction: async (tx) => {
    tx.partialSign(liquidatorKeypair);
    return tx;
  },
  signAllTransactions: async (txs) => {
    for (const tx of txs) tx.partialSign(liquidatorKeypair);
    return txs;
  },
  payer: liquidatorKeypair,
};
const provider = new AnchorProvider(conn, anchorWallet, { commitment: "confirmed" });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const program = new Program<any>(DarkbookIdl, provider);

// ─── Position account shape ───────────────────────────────────────────────────

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

// Rate-limit: track last liquidation attempt per position to avoid hammering
const lastAttempt = new Map<string, number>();
const ATTEMPT_COOLDOWN_MS = 5_000;

// ─── Liquidation logic ────────────────────────────────────────────────────────

/**
 * Computes the mark pnl and collateral ratio for a position given oracle price.
 *
 * collateral_ratio = collateral_locked / abs(unrealized_loss)
 * A position is liquidatable when ratio < 1.2 AND position is in loss.
 */
function computeMarkRisk(pos: PositionAccount, markPrice: bigint): {
  unrealizedPnl: bigint;
  collateralRatioBps: bigint;
  liquidatable: boolean;
} {
  const isLong = "long" in pos.side;
  const entry = BigInt(pos.entryPriceTicks.toString());
  const size = BigInt(pos.sizeLots.toString());
  const collateral = BigInt(pos.collateralLocked.toString());

  // PnL = size * (mark - entry) for long; size * (entry - mark) for short
  const priceDiff = isLong ? markPrice - entry : entry - markPrice;
  const unrealizedPnl = size * priceDiff;

  if (unrealizedPnl >= 0n) {
    // Position is profitable — never liquidatable
    return { unrealizedPnl, collateralRatioBps: 999_999n, liquidatable: false };
  }

  const loss = -unrealizedPnl;
  if (loss >= collateral) {
    // Fully underwater
    return { unrealizedPnl, collateralRatioBps: 0n, liquidatable: true };
  }

  // Remaining collateral = collateral - loss
  // Ratio = collateral / loss (expressed in bps: *10_000)
  const ratioBps = (collateral * 10_000n) / loss;
  const liquidatable = ratioBps < LIQUIDATION_THRESHOLD_BPS;
  return { unrealizedPnl, collateralRatioBps: ratioBps, liquidatable };
}

async function checkAndLiquidate(markPrice: bigint): Promise<void> {
  let positions: Array<{ publicKey: PublicKey; account: PositionAccount }>;
  try {
    // Filter: Position discriminator (8 bytes) + trader(32) + market(32) + side(1) +
    // sizeLots(8) + entryPriceTicks(8) + collateralLocked(8) + openedTs(8) +
    // lastFundingIndex(8) + status at offset 113 == 0 (Open)
    const STATUS_OFFSET = 113;
    positions = await program.account.position.all([
      {
        memcmp: {
          offset: STATUS_OFFSET,
          bytes: "11", // base58("0x00") = "11" = Open variant
        },
      },
    ]) as Array<{ publicKey: PublicKey; account: PositionAccount }>;
  } catch (err) {
    log.error({ err }, "Failed to fetch positions");
    return;
  }

  log.debug({ count: positions.length }, "Open positions fetched");

  for (const { publicKey: posPk, account: pos } of positions) {
    const { liquidatable, collateralRatioBps } = computeMarkRisk(pos, markPrice);
    if (!liquidatable) continue;

    const posKey = posPk.toBase58();
    const now = Date.now();
    const lastTry = lastAttempt.get(posKey) ?? 0;
    if (now - lastTry < ATTEMPT_COOLDOWN_MS) continue;
    lastAttempt.set(posKey, now);

    log.info({ position: posKey, collateralRatioBps: collateralRatioBps.toString() }, "Liquidating position");

    let oracleUpdate: Uint8Array;
    try {
      const px = await fetchPythPrice(PYTH_FEED_ID);
      oracleUpdate = px.updateData;
    } catch (err) {
      log.error({ err }, "Pyth fetch failed for liquidation");
      continue;
    }

    const [userAccount] = userPda(PROGRAM_ID, pos.market, pos.trader);
    const [vaultKey] = vaultPda(PROGRAM_ID, pos.market);
    const vaultTokenAccount = getAssociatedTokenAddressSync(USDC_MINT, vaultKey, true);
    const liquidatorTokenAccount = getAssociatedTokenAddressSync(
      USDC_MINT,
      liquidatorKeypair.publicKey,
    );

    try {
      const sig = await program.methods
        .liquidatePosition(Buffer.from(oracleUpdate))
        .accounts({
          liquidator: liquidatorKeypair.publicKey,
          market: pos.market,
          position: posPk,
          userAccount,
          vault: vaultKey,
          vaultTokenAccount,
          liquidatorTokenAccount,
          instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([liquidatorKeypair])
        .rpc();

      log.info({ position: posKey, sig }, "Position liquidated");
    } catch (err) {
      log.error({ err, position: posKey }, "Liquidation tx failed");
    }
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log.info("Liquidation watcher starting");

  // Prefer real Pyth Lazer WS; fall back to polling Hermes REST every 2s
  if (PYTH_LAZER_TOKEN) {
    log.info("Using Pyth Lazer WS stream");
    const stream = new PythLazerStream({
      token: PYTH_LAZER_TOKEN,
      feedIds: [PYTH_FEED_ID],
      rateMs: 1000,
    });

    stream.on("price", (update: LazerPriceUpdate) => {
      void checkAndLiquidate(update.price).catch((e: unknown) =>
        log.error({ err: e }, "checkAndLiquidate error"),
      );
    });

    stream.on("error", (err: Error) => log.error({ err }, "Lazer stream error"));
    stream.connect();
  } else {
    log.warn("PYTH_LAZER_TOKEN not set — falling back to Hermes REST poll (2s interval)");
    const poll = async (): Promise<void> => {
      try {
        const px = await fetchPythPrice(PYTH_FEED_ID);
        await checkAndLiquidate(px.price);
      } catch (err) {
        log.error({ err }, "Poll iteration error");
      }
      setTimeout(() => void poll(), 2_000);
    };
    void poll();
  }

  const shutdown = (): void => {
    log.info("Shutdown signal received");
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err: unknown) => {
  log.error({ err }, "Fatal error");
  process.exit(1);
});
