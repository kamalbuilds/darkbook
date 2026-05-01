/**
 * DarkBook Settler Service
 *
 * 1. Hono HTTP server on :8081 — traders POST plaintext order payloads.
 * 2. Subscribes to MagicBlock ER OrderBook account via WebSocket.
 * 3. For each unclaimed fill: verifies both plaintexts are stored, fetches
 *    Pyth oracle update, submits claim_fill on mainnet.
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import pino from "pino";
import {
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
} from "@solana/web3.js";
import { AnchorProvider, Program, BN, type Wallet } from "@coral-xyz/anchor";
import WebSocket from "ws";
import { Buffer } from "node:buffer";
import { createRequire } from "node:module";
import { ed25519 } from "@noble/curves/ed25519";

import {
  bookPda,
  fetchPythPrice,
  positionPda,
  userPda,
  SOL_USD_FEED_ID,
  MAGICBLOCK_DEVNET_WS_US,
  MAGICBLOCK_DEVNET_RPC_US,
} from "@darkbook/sdk";
import { submitJitoBundle } from "./jito-bundle.js";

// Load IDL — at runtime, @darkbook/sdk/src/idl/darkbook.json is the source of truth
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DarkbookIdl: any = require("../../../sdk/src/idl/darkbook.json");

// ─── Logger ──────────────────────────────────────────────────────────────────

const log = pino({ name: "settler", level: process.env.LOG_LEVEL ?? "info" });

// ─── Environment ─────────────────────────────────────────────────────────────

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const ER_WS_URL = process.env.ER_WS_URL ?? MAGICBLOCK_DEVNET_WS_US;
const PORT = Number(process.env.SETTLER_PORT ?? 8081);
const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID ?? "9i4Gpnt8GgrwxqwXdEyjFBsfNChis8z9jmyAbMpFVLcS",
);
const PYTH_FEED_ID = process.env.PYTH_FEED_ID ?? SOL_USD_FEED_ID;

// Settler keypair — JSON array of u8 values
const settlerSecretRaw = process.env.SETTLER_SECRET_KEY;
if (!settlerSecretRaw) {
  log.error("SETTLER_SECRET_KEY not set (JSON u8 array)");
  process.exit(1);
}
const settlerKeypair = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(settlerSecretRaw) as number[]),
);
log.info({ settler: settlerKeypair.publicKey.toBase58() }, "Settler identity");

// ─── In-memory store ──────────────────────────────────────────────────────────

interface StoredPlaintext {
  orderId: string;
  salt: number[];
  sizeLots: string;
  leverageBps: number;
  owner: string;
  storedAt: number;
}

const plaintextStore = new Map<string, StoredPlaintext>();
const claimedFills = new Set<string>();

// ─── Anchor client ────────────────────────────────────────────────────────────

const conn = new Connection(RPC_URL, "confirmed");

const anchorWallet: Wallet = {
  publicKey: settlerKeypair.publicKey,
  signTransaction: async (tx) => {
    tx.partialSign(settlerKeypair);
    return tx;
  },
  signAllTransactions: async (txs) => {
    for (const tx of txs) tx.partialSign(settlerKeypair);
    return txs;
  },
  payer: settlerKeypair,
};

const provider = new AnchorProvider(conn, anchorWallet, { commitment: "confirmed" });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const program = new Program<any>(DarkbookIdl, provider);

// ─── HTTP server ──────────────────────────────────────────────────────────────

const app = new Hono();

interface PlaintextBody {
  orderId: string;
  salt: number[];
  sizeLots: string;
  leverageBps: number;
  owner: string;
  ownerSig: string; // base64 ed25519 sig over canonical message
}

app.post("/plaintext", async (c) => {
  let body: PlaintextBody;
  try {
    body = await c.req.json<PlaintextBody>();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }

  const { orderId, salt, sizeLots, leverageBps, owner, ownerSig } = body;

  // Verify ed25519 signature: sig over "darkbook-plaintext:{orderId}:{sizeLots}:{leverageBps}"
  try {
    const msg = new TextEncoder().encode(
      `darkbook-plaintext:${orderId}:${sizeLots}:${leverageBps}`,
    );
    const ownerPkBytes = new PublicKey(owner).toBytes();
    const sigBytes = Buffer.from(ownerSig, "base64");
    const valid = ed25519.verify(sigBytes, msg, ownerPkBytes);
    if (!valid) {
      log.warn({ orderId, owner }, "Invalid ownerSig");
      return c.json({ error: "invalid signature" }, 403);
    }
  } catch (err) {
    log.warn({ err }, "Sig verification error");
    return c.json({ error: "signature error" }, 403);
  }

  plaintextStore.set(orderId, { orderId, salt, sizeLots, leverageBps, owner, storedAt: Date.now() });
  log.info({ orderId, owner }, "Plaintext stored");
  return c.json({ ok: true });
});

/** Delegated mode: no sig required. Acceptable for hackathon demo. */
app.post("/plaintext/delegated", async (c) => {
  let body: StoredPlaintext;
  try {
    body = await c.req.json<StoredPlaintext>();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }
  plaintextStore.set(body.orderId, { ...body, storedAt: Date.now() });
  log.info({ orderId: body.orderId, owner: body.owner }, "Plaintext stored (delegated)");
  return c.json({ ok: true });
});

app.get("/health", (c) =>
  c.json({ ok: true, stored: plaintextStore.size, claimed: claimedFills.size }),
);

// ─── Fill processor ──────────────────────────────────────────────────────────

interface FillAccount {
  fillId: BN;
  takerOrderId: BN;
  makerOrderId: BN;
  taker: PublicKey;
  maker: PublicKey;
  priceTicks: BN;
  matchedSlot: BN;
  claimed: boolean;
}

async function processFills(market: PublicKey): Promise<void> {
  const [bookKey] = bookPda(PROGRAM_ID, market);

  let fills: FillAccount[];
  try {
    const book = await program.account.orderBook.fetch(bookKey) as { fills: FillAccount[] };
    fills = book.fills;
  } catch (err) {
    log.error({ err, market: market.toBase58() }, "Failed to fetch OrderBook");
    return;
  }

  for (const fill of fills) {
    if (fill.claimed) continue;
    const fillIdStr = fill.fillId.toString();
    if (claimedFills.has(fillIdStr)) continue;

    const takerPt = plaintextStore.get(fill.takerOrderId.toString());
    const makerPt = plaintextStore.get(fill.makerOrderId.toString());

    if (!takerPt || !makerPt) {
      log.warn({ fillId: fillIdStr, hasTaker: !!takerPt, hasMaker: !!makerPt }, "Missing plaintexts");
      continue;
    }

    let oracleUpdate: Uint8Array;
    try {
      const px = await fetchPythPrice(PYTH_FEED_ID);
      oracleUpdate = px.updateData;
    } catch (err) {
      log.error({ err }, "Pyth fetch failed");
      continue;
    }

    const taker = new PublicKey(takerPt.owner);
    const maker = new PublicKey(makerPt.owner);
    const [takerUserAccount] = userPda(PROGRAM_ID, market, taker);
    const [makerUserAccount] = userPda(PROGRAM_ID, market, maker);
    const [takerPosition] = positionPda(PROGRAM_ID, market, taker, 0);
    const [makerPosition] = positionPda(PROGRAM_ID, market, maker, 0);

    try {
      // Build the claim_fill instruction
      const claimFillIx = await program.methods
        .claimFill(
          fill.fillId,
          takerPt.salt,
          new BN(takerPt.sizeLots),
          takerPt.leverageBps,
          makerPt.salt,
          new BN(makerPt.sizeLots),
          makerPt.leverageBps,
          Buffer.from(oracleUpdate),
        )
        .accounts({
          settler: settlerKeypair.publicKey,
          market,
          orderBook: bookKey,
          takerUserAccount,
          makerUserAccount,
          takerPosition,
          makerPosition,
          instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      // Build transaction
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
      const messageV0 = new (await import("@solana/web3.js")).TransactionMessage({
        payerKey: settlerKeypair.publicKey,
        recentBlockhash: blockhash,
        instructions: [claimFillIx],
      }).compileToV0Message();

      const claimTx = new (await import("@solana/web3.js")).VersionedTransaction(messageV0);
      claimTx.sign([settlerKeypair]);

      // Submit via Jito bundle (with fallback to direct RPC)
      const sig = await submitJitoBundle(conn, [claimTx], settlerKeypair);

      log.info({ fillId: fillIdStr, sig }, "claim_fill submitted via Jito bundle");
      claimedFills.add(fillIdStr);
    } catch (err) {
      log.error({ err, fillId: fillIdStr }, "claim_fill failed");
    }
  }
}

// ─── ER WebSocket subscription ────────────────────────────────────────────────

function subscribeToErBook(market: PublicKey): void {
  const wsUrl = ER_WS_URL.startsWith("wss://") || ER_WS_URL.startsWith("ws://")
    ? ER_WS_URL
    : ER_WS_URL.replace(/^https?:\/\//, "wss://");

  const ws = new WebSocket(wsUrl);

  ws.on("open", () => {
    const [bookKey] = bookPda(PROGRAM_ID, market);
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "accountSubscribe",
        params: [bookKey.toBase58(), { encoding: "base64", commitment: "processed" }],
      }),
    );
    log.info({ book: bookKey.toBase58() }, "Subscribed to ER OrderBook");
  });

  ws.on("message", (raw: Buffer | string) => {
    try {
      const msg = JSON.parse(raw.toString()) as { method?: string };
      if (msg.method === "accountNotification") {
        void processFills(market).catch((e: unknown) =>
          log.error({ err: e }, "processFills error"),
        );
      }
    } catch {
      // ignore parse errors on non-JSON frames
    }
  });

  ws.on("error", (err: Error) => log.error({ err }, "ER WS error"));
  ws.on("close", () => {
    log.warn("ER WS closed, reconnecting in 3s");
    setTimeout(() => subscribeToErBook(market), 3000);
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const marketEnv = process.env.MARKET_PUBKEY;
  if (!marketEnv) {
    log.error("MARKET_PUBKEY env var not set");
    process.exit(1);
  }
  const market = new PublicKey(marketEnv);

  serve({ fetch: app.fetch, port: PORT }, () => {
    log.info({ port: PORT }, "Settler HTTP server started");
  });

  subscribeToErBook(market);

  const shutdown = (): void => {
    log.info("Shutdown signal received, exiting");
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err: unknown) => {
  log.error({ err }, "Fatal error");
  process.exit(1);
});
