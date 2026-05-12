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
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { AnchorProvider, Program, BN, type Wallet } from "@coral-xyz/anchor";
import WebSocket from "ws";
import { Buffer } from "node:buffer";
import { createRequire } from "node:module";
import { ed25519 } from "@noble/curves/ed25519";

import {
  bookPda,
  computeCommitment,
  positionPda,
  userPda,
  MAGICBLOCK_DEVNET_WS_US,
  MAGICBLOCK_DEVNET_RPC_US,
} from "@darkbook/sdk";
import { submitJitoBundle } from "./jito-bundle.js";

// Encrypt FHE (dynamic import — gRPC is Node.js only, not bundled for browser)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _encryptFhe: any = null;
async function loadEncryptFhe() {
  if (_encryptFhe) return _encryptFhe;
  _encryptFhe = await import("@darkbook/sdk/encrypt-fhe");
  return _encryptFhe;
}

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
    if (tx instanceof Transaction) {
      tx.partialSign(settlerKeypair);
      return tx;
    }
    if (tx instanceof VersionedTransaction) {
      tx.sign([settlerKeypair]);
      return tx;
    }
    return tx;
  },
  signAllTransactions: async (txs) => {
    for (const tx of txs) {
      if (tx instanceof Transaction) tx.partialSign(settlerKeypair);
      else if (tx instanceof VersionedTransaction) tx.sign([settlerKeypair]);
    }
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
  c.json({ ok: true, stored: plaintextStore.size, encrypted: encryptedStore.size, claimed: claimedFills.size }),
);

// ─── Encrypt FHE store ───────────────────────────────────────────────────────

interface StoredEncryptedOrder {
  orderId: string;
  encryptedBlob: number[];   // AES-GCM ciphertext (ephemeral_pub + ciphertext+tag)
  ephemeralPrivateKey: number[]; // x25519 ephemeral private key (Stage 1 fallback)
  fheCiphertextIds: string[]; // Encrypt FHE ciphertext identifiers (Stage 2)
  owner: string;
  storedAt: number;
}

const encryptedStore = new Map<string, StoredEncryptedOrder>();

app.post("/encrypt-order", async (c) => {
  let body: {
    orderId: string;
    encryptedBlob: number[];
    ephemeralPrivateKey: number[];
    fheCiphertextIds: string[];
    owner: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }

  encryptedStore.set(body.orderId, {
    orderId: body.orderId,
    encryptedBlob: body.encryptedBlob,
    ephemeralPrivateKey: body.ephemeralPrivateKey,
    fheCiphertextIds: body.fheCiphertextIds ?? [],
    owner: body.owner,
    storedAt: Date.now(),
  });
  log.info({ orderId: body.orderId, owner: body.owner, fhe: body.fheCiphertextIds.length > 0 }, "Encrypted order stored");
  return c.json({ ok: true });
});

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const book = (await (program.account as any).orderBook.fetch(bookKey)) as {
      fills: FillAccount[];
    };
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

    // Try Encrypt FHE encrypted orders (Stage 2) if plaintexts missing
    if (!takerPt || !makerPt) {
      const takerEnc = encryptedStore.get(fill.takerOrderId.toString());
      const makerEnc = encryptedStore.get(fill.makerOrderId.toString());

      if (takerEnc && makerEnc) {
        // Attempt Encrypt FHE threshold decryption
        try {
          const fhe = await loadEncryptFhe();
          const settlerPrivKey = settlerKeypair.secretKey.slice(0, 32);

          // Decrypt taker order via Encrypt FHE (Stage 2) or fallback to Stage 1 ephemeral key
          let takerSalt: Uint8Array, takerSize: bigint, takerLev: number;
          let makerSalt: Uint8Array, makerSize: bigint, makerLev: number;

          if (takerEnc.fheCiphertextIds.length > 0) {
            const ctId = Uint8Array.from(takerEnc.fheCiphertextIds.map((s: string) => parseInt(s, 10)));
            const decrypted = await fhe.readEncryptCiphertext(
              ctId, new Uint8Array(0), 0n, settlerPrivKey,
              process.env.ENCRYPT_GRPC_URL,
            );
            // Parse decrypted order: salt(32) + sizeLots(8) + levyBps(2) + side(1) + priceTicks(8)
            takerSalt = decrypted.value.slice(0, 32);
            takerSize = new DataView(decrypted.value.buffer, decrypted.value.byteOffset + 32, 8).getBigUint64(0, true);
            takerLev = new DataView(decrypted.value.buffer, decrypted.value.byteOffset + 40, 2).getUint16(0, true);
            log.info({ orderId: fill.takerOrderId.toString() }, "Taker decrypted via Encrypt FHE");
          } else {
            // Stage 1 fallback: decrypt with ephemeral key
            const { decryptOrderBlob } = await import("@darkbook/sdk");
            const decrypted = await decryptOrderBlob(
              Uint8Array.from(takerEnc.encryptedBlob),
              Uint8Array.from(takerEnc.ephemeralPrivateKey),
              settlerKeypair.publicKey.toBytes(),
            );
            takerSalt = decrypted.salt;
            takerSize = decrypted.sizeLots;
            takerLev = decrypted.leverageBps;
          }

          if (makerEnc.fheCiphertextIds.length > 0) {
            const ctId = Uint8Array.from(makerEnc.fheCiphertextIds.map((s: string) => parseInt(s, 10)));
            const decrypted = await fhe.readEncryptCiphertext(
              ctId, new Uint8Array(0), 0n, settlerPrivKey,
              process.env.ENCRYPT_GRPC_URL,
            );
            makerSalt = decrypted.value.slice(0, 32);
            makerSize = new DataView(decrypted.value.buffer, decrypted.value.byteOffset + 32, 8).getBigUint64(0, true);
            makerLev = new DataView(decrypted.value.buffer, decrypted.value.byteOffset + 40, 2).getUint16(0, true);
            log.info({ orderId: fill.makerOrderId.toString() }, "Maker decrypted via Encrypt FHE");
          } else {
            const { decryptOrderBlob } = await import("@darkbook/sdk");
            const decrypted = await decryptOrderBlob(
              Uint8Array.from(makerEnc.encryptedBlob),
              Uint8Array.from(makerEnc.ephemeralPrivateKey),
              settlerKeypair.publicKey.toBytes(),
            );
            makerSalt = decrypted.salt;
            makerSize = decrypted.sizeLots;
            makerLev = decrypted.leverageBps;
          }

          // Store as plaintext for claim_fill
          const takerOwner = new PublicKey(takerEnc.owner);
          const makerOwner = new PublicKey(makerEnc.owner);
          const takerCommitment = Array.from(computeCommitment(takerSalt, takerSize, takerLev, takerOwner));
          const makerCommitment = Array.from(computeCommitment(makerSalt, makerSize, makerLev, makerOwner));

          const [takerUserAccount] = userPda(PROGRAM_ID, market, takerOwner);
          const [makerUserAccount] = userPda(PROGRAM_ID, market, makerOwner);
          const [takerPosition] = positionPda(PROGRAM_ID, market, takerOwner, 0);
          const [makerPosition] = positionPda(PROGRAM_ID, market, makerOwner, 0);

          const claimFillIx = await (program.methods as any)
            .claimFill(
              fill.fillId,
              Array.from(takerSalt),
              new BN(takerSize.toString()),
              takerLev,
              takerCommitment,
              Array.from(makerSalt),
              new BN(makerSize.toString()),
              makerLev,
              makerCommitment,
            )
            .accounts({
              settler: settlerKeypair.publicKey,
              market,
              orderBook: bookKey,
              takerUser: takerUserAccount,
              makerUser: makerUserAccount,
              takerPosition,
              makerPosition,
              systemProgram: SystemProgram.programId,
            })
            .instruction();

          const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
          const { TransactionMessage, VersionedTransaction: Vtx } = await import("@solana/web3.js");
          const messageV0 = new TransactionMessage({
            payerKey: settlerKeypair.publicKey,
            recentBlockhash: blockhash,
            instructions: [claimFillIx],
          }).compileToV0Message();
          const claimTx = new Vtx(messageV0);
          claimTx.sign([settlerKeypair]);

          const sig = await submitJitoBundle(conn, [claimTx], settlerKeypair);
          log.info({ fillId: fillIdStr, sig, fhe: true }, "claim_fill via Encrypt FHE");
          claimedFills.add(fillIdStr);
          continue;
        } catch (err) {
          log.warn({ err, fillId: fillIdStr }, "Encrypt FHE decryption failed, will retry on next ER update");
          continue;
        }
      }

      log.warn({ fillId: fillIdStr, hasTaker: !!takerPt, hasMaker: !!makerPt, hasTakerEnc: !!encryptedStore.get(fill.takerOrderId.toString()), hasMakerEnc: !!encryptedStore.get(fill.makerOrderId.toString()) }, "Missing order data");
      continue;
    }

    const taker = new PublicKey(takerPt.owner);
    const maker = new PublicKey(makerPt.owner);
    const [takerUserAccount] = userPda(PROGRAM_ID, market, taker);
    const [makerUserAccount] = userPda(PROGRAM_ID, market, maker);
    const [takerPosition] = positionPda(PROGRAM_ID, market, taker, 0);
    const [makerPosition] = positionPda(PROGRAM_ID, market, maker, 0);

    const takerSalt = Uint8Array.from(takerPt.salt);
    const makerSalt = Uint8Array.from(makerPt.salt);
    const takerCommitment = Array.from(
      computeCommitment(takerSalt, BigInt(takerPt.sizeLots), takerPt.leverageBps, taker),
    );
    const makerCommitment = Array.from(
      computeCommitment(makerSalt, BigInt(makerPt.sizeLots), makerPt.leverageBps, maker),
    );

    try {
      // Build the claim_fill instruction
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const claimFillIx = await (program.methods as any)
        .claimFill(
          fill.fillId,
          Array.from(takerSalt),
          new BN(takerPt.sizeLots),
          takerPt.leverageBps,
          takerCommitment,
          Array.from(makerSalt),
          new BN(makerPt.sizeLots),
          makerPt.leverageBps,
          makerCommitment,
        )
        .accounts({
          settler: settlerKeypair.publicKey,
          market,
          orderBook: bookKey,
          takerUser: takerUserAccount,
          makerUser: makerUserAccount,
          takerPosition,
          makerPosition,
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
