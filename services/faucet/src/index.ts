/**
 * DarkBook Faucet Service
 *
 * POST /faucet   { wallet: "<base58>" } → airdrop 1 SOL + transfer 1000 DBUSDC
 * GET  /health   → { status, faucetSolBalance, usdcBalance }
 *
 * Rate limit: 1 request per wallet per 5 minutes (in-memory).
 * Port: FAUCET_PORT (default 8083)
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import pino from "pino";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  createTransferInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import fs from "node:fs";
import path from "node:path";

// ─── Logger ───────────────────────────────────────────────────────────────────

const log = pino({ name: "faucet", level: process.env.LOG_LEVEL ?? "info" });

// ─── Config ───────────────────────────────────────────────────────────────────

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const PORT = Number(process.env.FAUCET_PORT ?? 8083);
const USDC_MINT_ADDRESS = process.env.USDC_DEVNET_MINT;

// Amount to distribute per request
const SOL_AIRDROP_AMOUNT = 1 * LAMPORTS_PER_SOL; // 1 SOL
const USDC_AMOUNT = BigInt(1_000) * BigInt(1_000_000); // 1000 USDC (6 decimals)

// Rate limit window: 5 minutes
const RATE_LIMIT_MS = 5 * 60 * 1000;

if (!USDC_MINT_ADDRESS) {
  log.error("USDC_DEVNET_MINT env var not set. Run scripts/setup-test-usdc.ts first.");
  process.exit(1);
}

// ─── Load faucet authority keypair ────────────────────────────────────────────

function loadFaucetKeypair(): Keypair {
  const keypairPath = process.env.FAUCET_AUTHORITY_KEYPAIR ?? "./.faucet-authority.json";
  const resolved = path.resolve(process.cwd(), keypairPath);

  if (!fs.existsSync(resolved)) {
    log.error(
      { path: resolved },
      "Faucet authority keypair file not found. Run scripts/setup-test-usdc.ts first.",
    );
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(resolved, "utf-8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

const faucetKeypair = loadFaucetKeypair();
const usdcMint = new PublicKey(USDC_MINT_ADDRESS);
const connection = new Connection(RPC_URL, "confirmed");

log.info(
  { pubkey: faucetKeypair.publicKey.toBase58(), mint: usdcMint.toBase58(), port: PORT },
  "Faucet service initialised",
);

// ─── In-memory rate limiter ───────────────────────────────────────────────────

// wallet address -> timestamp of last successful request
const rateLimitMap = new Map<string, number>();

function isRateLimited(wallet: string): { limited: boolean; retryAfterMs: number } {
  const last = rateLimitMap.get(wallet);
  if (last === undefined) return { limited: false, retryAfterMs: 0 };
  const elapsed = Date.now() - last;
  if (elapsed >= RATE_LIMIT_MS) return { limited: false, retryAfterMs: 0 };
  return { limited: true, retryAfterMs: RATE_LIMIT_MS - elapsed };
}

// ─── Solana helpers ───────────────────────────────────────────────────────────

async function airdropSol(destination: PublicKey): Promise<string> {
  try {
    const sig = await connection.requestAirdrop(destination, SOL_AIRDROP_AMOUNT);
    const latestBlockhash = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: sig, ...latestBlockhash }, "confirmed");
    log.info({ destination: destination.toBase58(), sig }, "SOL airdrop confirmed");
    return sig;
  } catch (err) {
    // Devnet airdrop rate-limited: fall back to transferring SOL from faucet pool
    log.warn({ err }, "Devnet airdrop failed, falling back to faucet SOL transfer");
    return transferSolFromFaucet(destination);
  }
}

async function transferSolFromFaucet(destination: PublicKey): Promise<string> {
  const faucetBalance = await connection.getBalance(faucetKeypair.publicKey);
  // Keep at least 0.1 SOL in the faucet for rent + gas
  const reserve = 0.1 * LAMPORTS_PER_SOL;
  if (faucetBalance < SOL_AIRDROP_AMOUNT + reserve) {
    throw new Error(
      `Faucet SOL pool too low (${faucetBalance / LAMPORTS_PER_SOL} SOL). Refill .faucet-authority.json wallet.`,
    );
  }

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: faucetKeypair.publicKey,
      toPubkey: destination,
      lamports: SOL_AIRDROP_AMOUNT,
    }),
  );
  const sig = await connection.sendTransaction(tx, [faucetKeypair]);
  const latestBlockhash = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: sig, ...latestBlockhash }, "confirmed");
  log.info({ destination: destination.toBase58(), sig }, "SOL transfer from faucet confirmed");
  return sig;
}

async function transferUsdc(destination: PublicKey): Promise<string> {
  const faucetAta = getAssociatedTokenAddressSync(
    usdcMint,
    faucetKeypair.publicKey,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  // Ensure destination ATA exists (create if not — faucet pays)
  const destAta = await getOrCreateAssociatedTokenAccount(
    connection,
    faucetKeypair,
    usdcMint,
    destination,
    false,
    "confirmed",
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const tx = new Transaction().add(
    createTransferInstruction(
      faucetAta,
      destAta.address,
      faucetKeypair.publicKey,
      USDC_AMOUNT,
      [],
      TOKEN_PROGRAM_ID,
    ),
  );

  const sig = await connection.sendTransaction(tx, [faucetKeypair]);
  const latestBlockhash = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: sig, ...latestBlockhash }, "confirmed");
  log.info({ destination: destination.toBase58(), sig }, "USDC transfer confirmed");
  return sig;
}

// ─── Hono app ─────────────────────────────────────────────────────────────────

const app = new Hono();

// Open CORS for dashboard
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

// ── GET /health ───────────────────────────────────────────────────────────────
app.get("/health", async (c) => {
  try {
    const [solLamports, faucetAta] = await Promise.all([
      connection.getBalance(faucetKeypair.publicKey),
      (async () => {
        try {
          const ata = getAssociatedTokenAddressSync(
            usdcMint,
            faucetKeypair.publicKey,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID,
          );
          return await getAccount(connection, ata, "confirmed", TOKEN_PROGRAM_ID);
        } catch {
          return null;
        }
      })(),
    ]);

    const usdcBalance = faucetAta ? Number(faucetAta.amount) / 1_000_000 : 0;

    return c.json({
      status: "ok",
      faucetPubkey: faucetKeypair.publicKey.toBase58(),
      usdcMint: usdcMint.toBase58(),
      faucetSolBalance: solLamports / LAMPORTS_PER_SOL,
      usdcBalance,
    });
  } catch (err) {
    log.error({ err }, "Health check failed");
    return c.json({ status: "error", error: String(err) }, 500);
  }
});

// ── POST /faucet ──────────────────────────────────────────────────────────────
app.post("/faucet", async (c) => {
  let body: { wallet?: string };
  try {
    body = await c.req.json<{ wallet?: string }>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const walletStr = body.wallet?.trim();
  if (!walletStr) {
    return c.json({ error: "Missing required field: wallet" }, 400);
  }

  // Validate base58 pubkey
  let destination: PublicKey;
  try {
    destination = new PublicKey(walletStr);
  } catch {
    return c.json({ error: "Invalid wallet address" }, 400);
  }

  // Rate limit check
  const { limited, retryAfterMs } = isRateLimited(walletStr);
  if (limited) {
    const retryAfterSec = Math.ceil(retryAfterMs / 1000);
    return c.json(
      {
        error: "Rate limited. You can request again after the retry window.",
        retryAfterSeconds: retryAfterSec,
      },
      429,
      { "Retry-After": String(retryAfterSec) },
    );
  }

  // Mark as started before awaiting (prevent concurrent hammering)
  rateLimitMap.set(walletStr, Date.now());

  try {
    log.info({ wallet: walletStr }, "Processing faucet request");

    // Run SOL airdrop and USDC transfer concurrently where possible
    const [solSig, usdcSig] = await Promise.all([
      airdropSol(destination),
      transferUsdc(destination),
    ]);

    log.info({ wallet: walletStr, solSig, usdcSig }, "Faucet request completed");

    return c.json({
      success: true,
      wallet: walletStr,
      distributed: {
        sol: 1,
        usdc: 1000,
      },
      signatures: {
        sol: solSig,
        usdc: usdcSig,
      },
      message: "1 SOL + 1000 DBUSDC sent. Funds may take a few seconds to appear.",
    });
  } catch (err) {
    // If both fail, release the rate limit so user can retry
    rateLimitMap.delete(walletStr);
    log.error({ err, wallet: walletStr }, "Faucet request failed");
    return c.json({ error: "Faucet failed. Please try again.", detail: String(err) }, 500);
  }
});

// ─── Start server ─────────────────────────────────────────────────────────────

serve({ fetch: app.fetch, port: PORT }, () => {
  log.info({ port: PORT }, "DarkBook Faucet server started");
});

const shutdown = (): void => {
  log.info("Shutdown signal received");
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
